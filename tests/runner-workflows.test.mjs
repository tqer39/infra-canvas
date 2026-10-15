import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const icons = parse(readFileSync('.github/workflows/update-icons.yml', 'utf8'));

test('無料枠を消費する hosted runner を残さず、通常CIと保守の実行先を分ける', () => {
  for (const job of Object.values(ci.jobs)) {
    assert.deepEqual(job['runs-on'], ['self-hosted', 'Linux', 'infra-canvas-ci']);
  }
  assert.deepEqual(icons.jobs.update['runs-on'], [
    'self-hosted',
    'Linux',
    'infra-canvas-maintenance',
  ]);
  for (const name of ['changes', 'checks', 'workflow-result']) {
    assert.match(ci.jobs[name].if, /github\.event\.repository\.private/);
  }
  assert.match(icons.jobs.update.if, /github\.event\.repository\.private/);
  assert.equal(ci.jobs.browser.needs, 'changes');
});

test('同一ホスト上のブラウザー2シャードと保守ジョブは別ポートを使う', () => {
  const browser = ci.jobs.browser;
  assert.deepEqual(browser.strategy.matrix.shard, [1, 2]);
  const ports = browser.strategy.matrix.shard.map((shard) =>
    browser.env.INFRA_TEST_PORT.replace('${{ matrix.shard }}', String(shard)),
  );
  ports.push(icons.jobs.update.env.INFRA_TEST_PORT);
  assert.equal(new Set(ports).size, 3);
  for (const port of ports) assert.ok(Number(port) >= 1024 && Number(port) <= 65535);
  assert.match(
    browser.steps.find((step) => step.run?.includes('test:browser')).run,
    /--shard=\$\{\{ matrix\.shard \}\}\/2/,
  );
});

test('runnerにsudoを要求せず、Nodeを使用する全ジョブで実行環境を準備する', () => {
  for (const job of [...Object.values(ci.jobs), icons.jobs.update]) {
    assert.ok(job.steps.some((step) => step.uses?.startsWith('jdx/mise-action@')));
    for (const step of job.steps) {
      assert.doesNotMatch(step.run ?? '', /\bsudo\b|browser:install-ci/);
    }
  }
  for (const job of [ci.jobs.browser, icons.jobs.update]) {
    assert.ok(job.steps.some((step) => step.run === 'mise run browser:install'));
  }
  assert.match(ci.jobs['workflow-result'].if, /always\(\)/);
  assert.deepEqual(ci.jobs['workflow-result'].needs, ['changes', 'checks', 'browser']);
});
