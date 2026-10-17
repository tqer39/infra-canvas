import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

test('全ワークフローの Docker ビルドで記録アップロードを無効化し、summary は保持する', () => {
  const covered = new Set();
  for (const name of readdirSync('.github/workflows').filter((name) => /\.ya?ml$/.test(name))) {
    const workflow = parse(readFileSync(`.github/workflows/${name}`, 'utf8'));
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses?.startsWith('docker/build-push-action@')) continue;
        const env = { ...workflow.env, ...job.env, ...step.env };
        assert.equal(
          env.DOCKER_BUILD_RECORD_UPLOAD,
          'false',
          `${name}/${jobName}: 記録を自動公開しない`,
        );
        assert.notEqual(
          env.DOCKER_BUILD_SUMMARY,
          'false',
          `${name}/${jobName}: 診断用 summary を維持する`,
        );
        covered.add(name);
      }
    }
  }
  assert.ok(covered.has('docker.yml'), 'PR/main の検証ビルドを確認する');
  assert.ok(covered.has('release.yml'), 'Release の公開ビルドも確認する');
});
