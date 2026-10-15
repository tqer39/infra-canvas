import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { runnerPort, workflowSucceeded } from '../scripts/ci-policy.mjs';

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

test('同一ホスト上のCI3台と保守ジョブは別ポートを使い、別PRでも競合しない', () => {
  const browser = ci.jobs.browser;
  assert.deepEqual(browser.strategy.matrix.shard, [1, 2]);
  const ports = [1, 2, 3].map((slot) => runnerPort(`infra-canvas-ci-${slot}`));
  ports.push(runnerPort('infra-canvas-maintenance'));
  assert.equal(new Set(ports).size, 4);
  assert.equal(
    Number(icons.jobs.update.env.INFRA_TEST_PORT),
    runnerPort('infra-canvas-maintenance'),
  );
  assert.ok(
    browser.steps.some((step) => step.run === 'node scripts/ci-policy.mjs port >> "$GITHUB_ENV"'),
  );
  for (const port of ports) assert.ok(Number(port) >= 1024 && Number(port) <= 65535);
  assert.match(
    browser.steps.find((step) => step.run?.includes('test:browser')).run,
    /--shard=\$\{\{ matrix\.shard \}\}\/2/,
  );
});

test('runnerにsudoを要求せず、Nodeを使用する全ジョブで実行環境を準備する', () => {
  for (const job of [...Object.values(ci.jobs), icons.jobs.update]) {
    if (job !== ci.jobs['workflow-result']) {
      assert.ok(job.steps.some((step) => step.uses?.startsWith('jdx/mise-action@')));
    }
    for (const step of job.steps.filter((step) => step.uses?.startsWith('jdx/mise-action@'))) {
      assert.equal(step.with.cache, false);
    }
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

test('依存準備なしの集約シェルは失敗・中止・未判定を成功扱いにしない', () => {
  const job = ci.jobs['workflow-result'];
  assert.equal(job.steps.length, 1);
  const step = job.steps[0];
  assert.equal(step.shell, 'bash');
  const cases = [
    ['success', 'success', 'success', 'true'],
    ['success', 'success', 'skipped', 'false'],
    ['failure', 'success', 'success', 'true'],
    ['success', 'failure', 'success', 'true'],
    ['cancelled', 'success', 'skipped', 'false'],
    ['success', 'cancelled', 'success', 'true'],
    ['skipped', 'success', 'skipped', 'false'],
    ['success', 'skipped', 'success', 'true'],
    ['success', 'success', 'failure', 'true'],
    ['success', 'success', 'cancelled', 'true'],
    ['success', 'success', 'skipped', 'true'],
    ['success', 'success', 'success', 'false'],
    ['success', 'success', 'skipped', ''],
    ['', '', '', ''],
  ];
  for (const [changes, checks, browser, browserRequired] of cases) {
    const result = spawnSync('bash', ['-e', '-c', step.run], {
      env: {
        ...process.env,
        CHANGES_RESULT: changes,
        CHECKS_RESULT: checks,
        BROWSER_RESULT: browser,
        BROWSER_REQUIRED: browserRequired,
      },
    });
    assert.equal(
      result.status,
      workflowSucceeded({ changes, checks, browser, browserRequired }) ? 0 : 1,
    );
  }
});
