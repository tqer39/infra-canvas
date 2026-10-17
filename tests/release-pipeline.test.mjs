import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lint } from 'markdownlint/promise';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import {
  anonymousRegistry,
  compareVersions,
  context,
  finalize,
  githubClient,
  inspectImage,
  prepare,
  releaseBody,
  versionInfo,
} from '../scripts/release/pipeline.mjs';

const { Response } = globalThis;
const sha = 'a'.repeat(40);
const ctx = context({ RELEASE_VERSION: '0.2.0', GITHUB_REPOSITORY: 'owner/app', GITHUB_SHA: sha });
const digest = `sha256:${'b'.repeat(64)}`;
const oldDigest = `sha256:${'c'.repeat(64)}`;
const notes = '# Infra Canvas v0.2.0\n\n構成図の編集を改善しました。';
function harness(options = {}) {
  const state = {
    tag: options.tag,
    release: options.release,
    latest: options.latest,
    writes: [],
    promoted: [],
    releases: 0,
  };
  const read = (path) => {
    if (path === 'package.json')
      return JSON.stringify({ version: options.packageVersion ?? ctx.version });
    if (path === 'package-lock.json')
      return JSON.stringify({ version: ctx.version, packages: { '': { version: ctx.version } } });
    return notes;
  };
  const api = async (path, req = {}) => {
    if (req.method) state.writes.push({ path, ...req });
    if (path.startsWith('actions/'))
      return {
        workflow_runs: options.runs ?? [
          {
            head_sha: sha,
            head_branch: 'main',
            event: 'push',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      };
    if (path.startsWith('git/ref/'))
      return state.tag ? { object: { type: 'commit', sha: state.tag } } : null;
    if (path === 'git/refs') {
      state.tag = req.body.sha;
      return {};
    }
    if (path.startsWith('releases/tags/')) return state.release ?? null;
    if (path === 'releases' || /^releases\/\d+$/.test(path)) {
      state.releases++;
      if (options.failRelease && state.releases === 1) throw new Error('Release API unavailable');
      state.release = {
        id: 1,
        ...req.body,
        html_url: 'https://github.com/owner/app/releases/tag/v0.2.0',
      };
      return state.release;
    }
    throw new Error(`unexpected API ${path}`);
  };
  const registry = {
    manifest: async (ref) => {
      if (ref === 'latest')
        return state.latest ? { digest: state.latest.digest, value: index } : null;
      if (ref === ctx.version || ref === digest) return { digest, value: index };
      if (ref === oldDigest) return { digest: oldDigest, value: index };
      return { digest: ref, value: { config: { digest: ref } } };
    },
    blob: async (ref) => {
      const architecture = ref === `sha256:${'1'.repeat(64)}` ? 'amd64' : 'arm64';
      const metadata = state.readingLatest ? state.latest : { version: ctx.version, sha };
      return {
        value: {
          architecture,
          os: 'linux',
          config: {
            Labels: {
              'org.opencontainers.image.version': metadata.version,
              'org.opencontainers.image.revision': metadata.sha,
            },
          },
        },
      };
    },
  };
  const manifest = registry.manifest;
  registry.manifest = async (ref, optional) => {
    if (ref === 'latest') state.readingLatest = true;
    else if (ref === ctx.version || ref === digest) state.readingLatest = false;
    return manifest(ref, optional);
  };
  const promote = async (source, target) => {
    state.promoted.push({ source, target });
    state.latest = { version: ctx.version, sha, digest };
  };
  return { state, api, read, registry, promote };
}
const index = {
  manifests: ['amd64', 'arm64'].map((architecture, i) => ({
    platform: { os: 'linux', architecture },
    digest: `sha256:${String(i + 1).repeat(64)}`,
  })),
};

test('SemVer・入力を検証し、数値とプレリリースの順序を正しく比較する', () => {
  for (const version of ['0.2.0', '1.0.0-rc.1', '1.0.0-beta-feature.2'])
    assert.equal(versionInfo(version).tag, `v${version}`);
  for (const version of ['v0.2.0', '01.2.0', '1.0.0-01', '1.0.0+meta', 'x\nsha=evil', '../main'])
    assert.throws(() => versionInfo(version));
  const ordered = [
    '1.0.0-alpha',
    '1.0.0-alpha.2',
    '1.0.0-alpha.10',
    '1.0.0-beta-feature',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.10',
    '1.1.0',
    '10.0.0',
  ];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++)
      assert.equal(Math.sign(compareVersions(ordered[i], ordered[j])), Math.sign(i - j));
  }
});

test('準備を再実行しても同じタグは一度だけ作り、別 SHA のタグは上書きしない', async () => {
  const h = harness();
  await prepare(ctx, h);
  await prepare(ctx, h);
  assert.equal(h.state.writes.length, 1);
  assert.equal(h.state.tag, sha);
  const conflict = harness({ tag: 'd'.repeat(40) });
  await assert.rejects(prepare(ctx, conflict), /同名タグ/);
  assert.equal(conflict.state.writes.length, 0);
});

test('版不一致・CI未実行/失敗/進行中/別SHA/別ブランチはタグ作成前に停止する', async () => {
  await assert.rejects(prepare(ctx, harness({ packageVersion: '0.1.0' })), /package.json/);
  for (const runs of [
    [],
    [{ status: 'completed', conclusion: 'failure' }],
    [{ status: 'in_progress', conclusion: null }],
    [{ head_sha: 'd'.repeat(40), status: 'completed', conclusion: 'success' }],
  ]) {
    const h = harness({ runs });
    await assert.rejects(prepare(ctx, h), /main CI/);
    assert.equal(h.state.writes.length, 0);
  }
});

test('注釈付きタグも commit まで解決して一致を確認する', async () => {
  const h = harness();
  const api = async (path, req) =>
    path.startsWith('git/ref/')
      ? { object: { type: 'tag', sha: 'e'.repeat(40) } }
      : path.startsWith('git/tags/')
        ? { object: { type: 'commit', sha } }
        : h.api(path, req);
  await prepare(ctx, { ...h, api });
  assert.equal(h.state.writes.length, 0);
});

test('既存イメージは両 CPU の版と SHA を照合し、一方の欠落・不一致は拒否する', async () => {
  const h = harness();
  assert.equal((await inspectImage(h.registry, ctx.version, ctx)).digest, digest);
  for (const expected of [
    { ...ctx, sha: 'd'.repeat(40) },
    { ...ctx, version: '0.3.0' },
  ])
    await assert.rejects(inspectImage(h.registry, ctx.version, expected));
  const partial = {
    ...h.registry,
    manifest: async () => ({ digest, value: { manifests: [index.manifests[0]] } }),
  };
  await assert.rejects(inspectImage(partial, ctx.version, ctx), /両 CPU/);
  const original = h.registry.blob;
  h.registry.blob = async (ref) => {
    const r = await original(ref);
    if (r.value.architecture === 'arm64')
      r.value.config.Labels['org.opencontainers.image.revision'] = 'f'.repeat(40);
    return r;
  };
  await assert.rejects(inspectImage(h.registry, ctx.version, ctx), /CPU 間/);
});

test('匿名 OCI クライアントは GH 認証を送らず、実データの digest を検証する', async () => {
  const payload = JSON.stringify(index);
  const actual = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
  const calls = [];
  const fetchImpl = async (url, req) => {
    calls.push({ url, req });
    return url.includes('/token?')
      ? Response.json({ token: 'anonymous-token' })
      : new Response(payload, { headers: { 'docker-content-digest': actual } });
  };
  const registry = anonymousRegistry(ctx.repo, fetchImpl);
  assert.equal((await registry.manifest(actual)).digest, actual);
  assert.equal(calls[0].req.headers, undefined);
  assert.equal(calls[1].req.headers.Authorization, 'Bearer anonymous-token');
  await assert.rejects(registry.manifest(digest), /指定 digest/);
});

test('404だけを未公開と扱い、認証失敗・レート制限・障害は再ビルド判断に流さない', async () => {
  for (const status of [401, 403, 429, 500]) {
    const registry = anonymousRegistry(ctx.repo, async (url) =>
      url.includes('/token?') ? Response.json({ token: 'anon' }) : new Response(null, { status }),
    );
    await assert.rejects(registry.manifest(ctx.version, true), /HTTP/);
  }
  const registry = anonymousRegistry(ctx.repo, async (url) =>
    url.includes('/token?')
      ? Response.json({ token: 'anon' })
      : new Response(null, { status: 404 }),
  );
  assert.equal(await registry.manifest(ctx.version, true), null);
  const api = githubClient(ctx.repo, 'test-token', async () => new Response(null, { status: 500 }));
  await assert.rejects(api('git/ref/tags/v0.2.0', { optional: true }), /HTTP 500/);
});

test('公開の途中で失敗しても、再実行はイメージを昇格し直さず Release を完成する', async () => {
  const h = harness({
    tag: sha,
    latest: { version: '0.1.0', sha: 'f'.repeat(40), digest: oldDigest },
    failRelease: true,
  });
  await assert.rejects(finalize(ctx, digest, h), /Release API unavailable/);
  assert.equal(h.state.promoted.length, 1);
  await finalize(ctx, digest, h);
  await finalize(ctx, digest, h);
  assert.equal(h.state.promoted.length, 1);
  assert.equal(h.state.releases, 2);
  assert.match(h.state.release.body, /構成図の編集/);
  assert.match(h.state.release.body, /linux\/arm64・linux\/amd64/);
  assert.match(h.state.release.body, /owner\/app:0\.2\.0/);
});

test('検証後の digest 改変・latest 降格・既存 Release の衝突では公開しない', async () => {
  const scenarios = [
    { h: harness({ tag: sha }), d: oldDigest, pattern: /検証後/ },
    {
      h: harness({ tag: sha, latest: { version: '0.3.0', sha, digest: oldDigest } }),
      d: digest,
      pattern: /ダウングレード/,
    },
    {
      h: harness({ tag: sha, latest: { version: ctx.version, sha, digest: oldDigest } }),
      d: digest,
      pattern: /別 digest/,
    },
    {
      h: harness({ tag: sha, release: { body: 'manual release' } }),
      d: digest,
      pattern: /既存 Release/,
    },
  ];
  for (const { h, d, pattern } of scenarios) {
    await assert.rejects(finalize(ctx, d, h), pattern);
    assert.equal(h.state.promoted.length, 0);
    assert.equal(h.state.releases, 0);
  }
});

test('プレリリースは latest を変更せず、日本語ノート付き prerelease を公開する', async () => {
  const pre = { ...ctx, ...versionInfo('0.2.0-rc.1') };
  const h = harness({ tag: sha });
  const blob = h.registry.blob;
  h.registry.blob = async (ref) => {
    const r = await blob(ref);
    r.value.config.Labels['org.opencontainers.image.version'] = pre.version;
    return r;
  };
  const manifest = h.registry.manifest;
  h.registry.manifest = (ref, optional) =>
    manifest(ref === pre.version ? ctx.version : ref, optional);
  await finalize(pre, digest, h);
  assert.equal(h.state.promoted.length, 0);
  assert.equal(h.state.release.prerelease, true);
  assert.equal(h.state.release.make_latest, 'false');
});

test('既存の同一 draft は更新して公開し、公開済みノートの手編集は保持する', async () => {
  const body = releaseBody(ctx, digest, notes);
  const h = harness({ tag: sha, release: { id: 7, body, prerelease: false, draft: true } });
  await finalize(ctx, digest, h);
  assert.ok(h.state.writes.some((r) => r.path === 'releases/7' && r.method === 'PATCH'));
  h.state.release.body += '\n利用者向け追記';
  await finalize(ctx, digest, h);
  assert.match(h.state.release.body, /利用者向け追記/);
  assert.equal(h.state.releases, 1);
});

const workflow = parse(readFileSync('.github/workflows/release.yml', 'utf8'));
test('公開 DAG は main の手動実行のみ、両 CPU 成功後だけ finalize を許可する', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.jobs.prepare.if, "${{ github.ref == 'refs/heads/main' }}");
  assert.deepEqual(workflow.jobs.verify.needs, ['prepare', 'publish']);
  assert.deepEqual(workflow.jobs.finalize.needs, ['prepare', 'publish', 'verify']);
  assert.equal(workflow.jobs.finalize.if, undefined);
  assert.equal(workflow.jobs.verify.strategy['fail-fast'], false);
  assert.deepEqual(workflow.jobs.verify.strategy.matrix.include, [
    { arch: 'amd64', runner: 'ubuntu-24.04' },
    { arch: 'arm64', runner: 'ubuntu-24.04-arm' },
  ]);
  assert.equal(workflow.concurrency.group, 'release-publish');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job['continue-on-error'], undefined);
    for (const step of job.steps) {
      assert.equal(step['continue-on-error'], undefined);
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/checkout@')) {
        assert.equal(step.with['persist-credentials'], false);
        assert.ok(step.with.ref.includes('sha'));
      }
    }
  }
});

test('匿名検証は書込権限と login を持たず、publish は latest を付けない', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs.verify.permissions, undefined);
  assert.ok(!workflow.jobs.verify.steps.some((s) => s.uses?.includes('login-action')));
  const verify = workflow.jobs.verify.steps.find((s) => s.env?.PLATFORM);
  assert.equal(verify.env.GH_TOKEN, undefined);
  assert.match(verify.run, /DOCKER_CONFIG="\$\(mktemp -d\)"/);
  assert.match(verify.run, /docker pull --platform "\$PLATFORM" "\$IMAGE@\$IMAGE_DIGEST"/);
  assert.match(verify.run, /mise run test:docker/);
  assert.equal(verify.run.match(/mise run release:verify/g).length, 2);
  const build = workflow.jobs.publish.steps.find((s) => s.id === 'build');
  assert.equal(build.if, "steps.plan.outputs.exists != 'true'");
  assert.ok(!build.with.tags.includes('latest'));
  assert.equal(workflow.jobs.publish.permissions.contents, 'read');
  assert.equal(workflow.jobs.finalize.permissions.contents, 'write');
  assert.equal(workflow.jobs.finalize.permissions.packages, 'write');
});

test('公開済みの古い実行を再実行しても、新しい latest を巻き戻さない', async () => {
  const h = harness({
    tag: sha,
    latest: { version: '0.3.0', sha, digest: oldDigest },
    release: { id: 1, body: releaseBody(ctx, digest, notes), prerelease: false, draft: false },
  });
  await finalize(ctx, digest, h);
  assert.equal(h.state.promoted.length, 0);
  assert.equal(h.state.releases, 0);
  assert.equal(h.state.latest.version, '0.3.0');
});

test('生成した日本語 Release ノートは Markdown として有効で版を固定する', async () => {
  const body = releaseBody(ctx, digest, notes);
  const result = await lint({ strings: { notes: body }, config: { default: true, MD013: false } });
  assert.deepEqual(Object.values(result).flat(), []);
  assert.ok(body.includes(`${ctx.image}:${ctx.version}`));
  assert.ok(body.includes(digest));
});

test('標準入力から import しても公開用 CLI を実行しない', () => {
  const moduleUrl = new URL('../scripts/release/pipeline.mjs', import.meta.url).href;
  const result = execFileSync(process.execPath, ['--input-type=module', '-'], {
    input: `const m = await import(${JSON.stringify(moduleUrl)}); console.log(m.versionInfo('0.2.0').tag);`,
    encoding: 'utf8',
  });
  assert.equal(result.trim(), 'v0.2.0');
});
