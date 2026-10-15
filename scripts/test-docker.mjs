import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request } from 'node:http';
import { text } from 'node:stream/consumers';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const exec = promisify(execFile);
const { fetch, AbortSignal } = globalThis;
const image = process.argv[2] ?? 'infra-canvas:local';
const platform = process.argv[3] ?? `linux/${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
const docker = async (...args) =>
  (await exec('docker', args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
// fetchがHostヘッダーを上書きする環境でも、実際のHTTPヘッダーを検証する。
const requestStatus = (url, options) =>
  new Promise((resolve, reject) => {
    const req = request(url, options, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP応答がタイムアウトしました。')));
    req.end();
  });
const container = await docker(
  'run',
  '--detach',
  '--rm',
  '--platform',
  platform,
  '--publish',
  '127.0.0.1::5180',
  image,
);
let browser;
try {
  const binding = await docker('port', container, '5180/tcp');
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const url = `http://${binding}`;
  await expect(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<title>Infra Canvas<\/title>/);
  }).toPass({ timeout: 60000 });
  assert.notEqual(await docker('exec', container, 'id', '-u'), '0');
  const status = await fetch(`${url}/api/llm/status`);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).storageError, undefined);
  // 待ち受けを広げても、別 Origin / Host から認証情報・LLM操作を利用できない。
  for (const headers of [{ Origin: 'http://example.com' }, { Host: 'example.com:5180' }]) {
    assert.equal(await requestStatus(`${url}/api/llm/status`, { headers }), 403);
    assert.equal(await requestStatus(`${url}/api/repository`, { method: 'POST', headers }), 403);
  }
  assert.equal((await fetch(`${url}/missing`)).status, 404);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // アイコンやJS/CSSがCDNなしでも読み込めることを確認する。
  await page.route('**/*', (route) =>
    route.request().url().startsWith(`${url}/`) ? route.continue() : route.abort(),
  );
  await page.goto(url);
  await page.locator('[data-id="api"] .resource-label').click();
  const form = page.getByRole('form', { name: 'リソース情報の編集' });
  await form.getByLabel('名前', { exact: true }).fill('Docker検証API');
  await form.getByLabel('名前', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'DSL 入力', exact: true })).toHaveValue(
    /Docker検証API/,
  );
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DSL を保存', exact: true }).click();
  const download = await downloaded;
  assert.equal(await download.failure(), null);
  assert.match(await text(await download.createReadStream()), /Docker検証API/);
  await page.locator('input[type=file]').setInputFiles('examples/gcp-web.infra');
  await expect(page.getByRole('textbox', { name: 'DSL 入力', exact: true })).toHaveValue(
    /Cloud Run/,
  );
  assert.deepEqual(errors, []);
  await expect(async () => {
    assert.equal(
      await docker('inspect', '--format', '{{.State.Health.Status}}', container),
      'healthy',
    );
  }).toPass({ timeout: 60000, intervals: [1000] });
  console.log(`${platform}: HTTP・API保護・非root・図の編集・DSL保存/読み込み・healthcheck成功`);
} finally {
  await browser?.close();
  await docker('stop', '--time', '5', container);
}

// CMDの上書き・読み取り専用マウントと、不正な待ち受け指定を検証する。
assert.match(
  await docker(
    'run',
    '--rm',
    '--platform',
    platform,
    '--mount',
    `type=bind,source=${resolve('examples')},target=/data,readonly`,
    image,
    'validate',
    '/data/gcp-web.infra',
  ),
  /DSL は有効です/,
);
await assert.rejects(
  docker(
    'run',
    '--rm',
    '--platform',
    platform,
    image,
    'preview',
    'examples/aws.infra',
    '--host',
    'example.com',
  ),
  (error) => error.code === 1,
);

// --hostを省略した通常のCLIは、コンテナー内でもループバック限定を保つ。
const local = await docker(
  'run',
  '--detach',
  '--rm',
  '--platform',
  platform,
  '--publish',
  '127.0.0.1::5180',
  image,
  'preview',
  'examples/aws.infra',
  '--port',
  '5180',
);
try {
  await expect(async () => {
    assert.equal(await docker('inspect', '--format', '{{.State.Health.Status}}', local), 'healthy');
  }).toPass({ timeout: 60000, intervals: [1000] });
  const binding = await docker('port', local, '5180/tcp');
  await assert.rejects(fetch(`http://${binding}`, { signal: AbortSignal.timeout(2000) }));
  console.log(`${platform}: CLI既定のループバック限定・不正host拒否・読み取り専用マウント成功`);
} finally {
  await docker('stop', '--time', '5', local);
}
