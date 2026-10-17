import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/docker.yml', 'utf8'));
test('publicのPRでも両CPUのDocker検証を独立したGitHub-hosted VMで実行する', () => {
  const job = workflow.jobs.test;
  assert.equal(workflow.on.pull_request, null);
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.equal(job.if, undefined);
  assert.equal(job['runs-on'], '${{ matrix.runner }}');
  assert.deepEqual(job.strategy.matrix.include, [
    { arch: 'amd64', runner: 'ubuntu-24.04' },
    { arch: 'arm64', runner: 'ubuntu-24.04-arm' },
  ]);
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job['continue-on-error'], undefined);
  for (const current of Object.values(workflow.jobs)) {
    for (const step of current.steps) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (step.uses?.startsWith('actions/checkout@'))
        assert.equal(step.with['persist-credentials'], false);
    }
  }
  assert.deepEqual(workflow.permissions, { contents: 'read' });
});

test('Docker CI は公開を行わず、Release ワークフローに公開を集約する', () => {
  assert.deepEqual(Object.keys(workflow.jobs), ['test']);
  assert.equal(workflow.on.push.tags, undefined);
  assert.deepEqual(workflow.on.push.branches, ['main']);
});
