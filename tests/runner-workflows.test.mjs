import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
import { runnerPort } from '../scripts/ci-policy.mjs';

const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const icons = parse(readFileSync('.github/workflows/update-icons.yml', 'utf8'));
const verify = ci.jobs.verify;

// このワークフローが使う数値比較・文字列比較・論理和はJSでも同じ真偽になる。
function enabled(step, shard, browser) {
  if (!step.if) return true;
  const expression = step.if.slice(3, -2).trim();
  return runInNewContext(
    expression,
    {
      matrix: { shard },
      steps: { changes: { outputs: { browser } } },
    },
    { timeout: 50 },
  );
}

test('3シャードを依存待ちなしで起動し、通常CIと保守の実行先を分ける', () => {
  assert.deepEqual(Object.keys(ci.jobs), ['verify', 'workflow-result']);
  assert.equal(verify.needs, undefined);
  assert.deepEqual(verify.strategy.matrix.shard, [1, 2, 3]);
  assert.equal(verify.strategy['fail-fast'], false);
  assert.equal(verify['continue-on-error'], undefined);
  for (const job of Object.values(ci.jobs)) {
    assert.deepEqual(job['runs-on'], ['self-hosted', 'Linux', 'infra-canvas-ci']);
    assert.match(job.if, /github\.event\.repository\.private/);
  }
  assert.deepEqual(icons.jobs.update['runs-on'], [
    'self-hosted',
    'Linux',
    'infra-canvas-maintenance',
  ]);
  assert.match(icons.jobs.update.if, /github\.event\.repository\.private/);
});

test('静的検証は常に1回、ブラウザーは必要時に3シャードすべてを実行する', () => {
  for (const browser of ['true', 'false']) {
    const runs = verify.strategy.matrix.shard.flatMap((shard) =>
      verify.steps
        .filter((step) => step.run && enabled(step, shard, browser))
        .map((step) => step.run),
    );
    assert.equal(runs.filter((run) => run === 'mise run check:static').length, 1);
    assert.equal(
      runs.filter((run) => run === 'node scripts/ci-policy.mjs changes >> "$GITHUB_OUTPUT"').length,
      3,
    );
    assert.equal(
      runs.filter((run) => run === 'mise run install').length,
      browser === 'true' ? 3 : 1,
    );
    for (const command of [
      'mise run build',
      'mise run browser:install',
      'mise run test:browser -- --shard=${{ matrix.shard }}/3',
    ]) {
      assert.equal(
        runs.filter((run) => run === command).length,
        browser === 'true' ? 3 : 0,
        command,
      );
    }
  }
  const checkout = verify.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], 0);
  assert.equal(checkout.with['persist-credentials'], false);
});

test('3 runner と保守のポートを分け、準備と変更判定を依存導入より先に行う', () => {
  const ports = [1, 2, 3].map((slot) => runnerPort(`infra-canvas-ci-${slot}`));
  ports.push(Number(icons.jobs.update.env.INFRA_TEST_PORT));
  assert.equal(new Set(ports).size, 4);
  assert.equal(
    Number(icons.jobs.update.env.INFRA_TEST_PORT),
    runnerPort('infra-canvas-maintenance'),
  );
  const index = (fragment) => verify.steps.findIndex((step) => step.run?.includes(fragment));
  const mise = verify.steps.findIndex((step) => step.uses?.startsWith('jdx/mise-action@'));
  assert.ok(mise < index('ci-policy.mjs changes'));
  assert.ok(index('ci-policy.mjs changes') < index('mise run install'));
  assert.ok(index('mise run check:static') < index('mise run test:browser'));
  assert.ok(index('ci-policy.mjs port') < index('mise run test:browser'));
});

test('常設runnerにsudoやリモートキャッシュ復元を要求しない', () => {
  for (const job of [verify, icons.jobs.update]) {
    const mise = job.steps.find((step) => step.uses?.startsWith('jdx/mise-action@'));
    assert.ok(mise);
    assert.equal(mise.with.cache, false);
    for (const step of job.steps)
      assert.doesNotMatch(step.run ?? '', /\bsudo\b|browser:install-ci/);
  }
  assert.ok(
    icons.jobs.update.steps.some((step) => step.run === 'mise run test:browser -- --workers=1'),
  );
});

test('集約はmatrix全体の成功だけを許可し、失敗・中止・スキップを拒否する', () => {
  const job = ci.jobs['workflow-result'];
  assert.equal(job.needs, 'verify');
  assert.match(job.if, /always\(\)/);
  assert.equal(job.steps.length, 1);
  const step = job.steps[0];
  assert.equal(step.env.VERIFY_RESULT, '${{ needs.verify.result }}');
  assert.equal(step.shell, 'bash');
  for (const status of ['success', 'failure', 'cancelled', 'skipped', '', 'unknown']) {
    const result = spawnSync('bash', ['-e', '-c', step.run], {
      env: { ...process.env, VERIFY_RESULT: status },
    });
    assert.equal(result.status, status === 'success' ? 0 : 1, status);
  }
});
