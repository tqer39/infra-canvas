import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parse } from 'yaml';
const { structuredClone } = globalThis;

const workflow = parse(readFileSync('.github/workflows/docker.yml', 'utf8'));
test('Docker検証と配布は専用VMだけを使い、両CPUの成功後にタグを配布する', () => {
  for (const job of Object.values(workflow.jobs)) {
    assert.deepEqual(job['runs-on'], ['self-hosted', 'Linux', 'infra-canvas-docker']);
    assert.match(job.if, /github\.event\.repository\.private/);
    for (const step of job.steps) {
      assert.doesNotMatch(step.run ?? '', /\bsudo\b|--privileged|browser:install-ci/);
      assert.doesNotMatch(step.uses ?? '', /setup-qemu/);
    }
  }
  assert.deepEqual(workflow.jobs.test.strategy.matrix.arch, ['amd64', 'arm64']);
  assert.equal(workflow.jobs.test.strategy['fail-fast'], false);
  assert.equal(workflow.jobs.test['continue-on-error'], undefined);
  assert.equal(workflow.jobs.publish.needs, 'test');
  assert.match(workflow.jobs.publish.if, /github\.event_name == 'push'/);
  assert.match(workflow.jobs.publish.if, /refs\/tags\/v/);
  assert.equal(workflow.jobs.publish.permissions.packages, 'write');
  assert.equal(workflow.permissions.packages, undefined);
});

test('既存VMにホスト共有・追加プロファイル・別用途の構成があれば導入を拒否する', () => {
  const source = readFileSync('scripts/ci/provision-docker-vm.sh', 'utf8');
  const guard = source.match(/python3 -c '([\s\S]+?)\n'/)[1];
  const valid = {
    type: 'virtual-machine',
    profiles: [],
    expanded_config: { 'limits.cpu': '4', 'limits.memory': '6GiB' },
    expanded_devices: {
      root: { pool: 'infra-canvas-docker' },
      eth0: { network: 'icdocker0' },
    },
  };
  const check = (value) =>
    spawnSync('python3', ['-c', guard], { input: JSON.stringify(value), encoding: 'utf8' });
  assert.equal(check(valid).status, 0);
  for (const mutate of [
    (v) => (v.type = 'container'),
    (v) => v.profiles.push('default'),
    (v) => (v.expanded_devices.host = { type: 'disk', source: '/', path: '/host' }),
    (v) => (v.expanded_devices.root.pool = 'other'),
    (v) => (v.expanded_devices.eth0.network = 'other'),
    (v) => (v.expanded_config['limits.memory'] = '28GiB'),
  ]) {
    const value = structuredClone(valid);
    mutate(value);
    assert.notEqual(check(value).status, 0);
  }
});

test('導入スクリプトのBash構文と引数不足の停止を検証する', () => {
  for (const path of [
    'scripts/ci/provision-docker-vm.sh',
    'scripts/ci/provision-docker-runner.sh',
  ]) {
    assert.equal(spawnSync('bash', ['-n', path]).status, 0);
    assert.equal(spawnSync('bash', [path]).status, 1);
  }
});
