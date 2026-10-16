import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';

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

test('通常CIと保守はpublicでも使い捨てのGitHub-hosted VMを使う', () => {
  assert.deepEqual(Object.keys(ci.jobs), ['verify', 'workflow-result']);
  assert.equal(verify.needs, undefined);
  assert.deepEqual(verify.strategy.matrix.shard, [1, 2, 3]);
  assert.equal(verify.strategy['fail-fast'], false);
  assert.equal(verify['continue-on-error'], undefined);
  for (const workflow of [ci, icons]) {
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.on.pull_request_target, undefined);
    for (const job of Object.values(workflow.jobs)) {
      assert.equal(job['runs-on'], 'ubuntu-24.04');
      assert.doesNotMatch(job.if ?? '', /repository\.private/);
      for (const step of job.steps) {
        if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
        if (step.uses?.startsWith('actions/checkout@'))
          assert.equal(step.with['persist-credentials'], false);
      }
    }
  }
  assert.equal(ci.on.pull_request, null);
  assert.equal(icons.on.pull_request, undefined);
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
      runs.filter(
        (run) => run === 'mise exec node -- node scripts/ci-policy.mjs changes >> "$GITHUB_OUTPUT"',
      ).length,
      3,
    );
    assert.equal(
      runs.filter((run) => run === 'mise run install').length,
      browser === 'true' ? 3 : 1,
    );
    for (const command of [
      'mise run build',
      'mise run browser:install-ci',
      'mise run test:browser -- --shard=${{ matrix.shard }}/3',
    ]) {
      assert.equal(
        runs.filter((run) => run === command).length,
        browser === 'true' ? 3 : 0,
        command,
      );
    }
  }
});

test('PRのmerge-baseを取得できる履歴とOS依存を準備し、通常CIには秘密情報を渡さない', () => {
  const checkout = verify.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with['fetch-depth'], 0);
  const prepare = verify.steps.find((step) => step.uses?.startsWith('jdx/mise-action@'));
  assert.equal(prepare.with.install_args, "${{ matrix.shard == 1 && 'node python' || 'node' }}");
  assert.doesNotMatch(JSON.stringify(ci), /secrets\.|self-hosted|RUNNER_NAME|CHECKOUT_TOKEN/);
  assert.ok(icons.jobs.update.steps.some((step) => step.run === 'mise run browser:install-ci'));
  assert.ok(
    icons.jobs.update.steps.some((step) => step.run === 'mise run test:browser -- --workers=1'),
  );
  const index = (fragment) => verify.steps.findIndex((step) => step.run?.includes(fragment));
  assert.ok(index('ci-policy.mjs changes') < index('mise run install'));
  assert.ok(index('mise run check:static') < index('mise run test:browser'));
});

test('アイコン保守は既定ブランチを使い、秘密の参照先をコードに固定しない', () => {
  const steps = icons.jobs.update.steps;
  assert.equal(
    steps.find((step) => step.uses?.startsWith('actions/checkout@')).with.ref,
    '${{ github.event.repository.default_branch }}',
  );
  const secrets = steps.find((step) => step.id === 'secrets');
  assert.equal(secrets.with['export-env'], false);
  assert.equal(secrets.env.APP_CLIENT_ID, '${{ secrets.ICON_UPDATER_CLIENT_ID_REFERENCE }}');
  assert.equal(secrets.env.APP_PRIVATE_KEY, '${{ secrets.ICON_UPDATER_PRIVATE_KEY_REFERENCE }}');
  assert.doesNotMatch(JSON.stringify(icons), /op:\/\//);
  assert.match(secrets.if, /steps\.diff\.outputs\.changed == 'true'/);
  assert.match(secrets.if, /inputs\.dry_run == false/);
  const app = steps.find((step) => step.id === 'app');
  assert.equal(app.with.repositories, '${{ github.event.repository.name }}');
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
