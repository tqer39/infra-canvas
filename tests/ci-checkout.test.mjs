import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';

const checkout = parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs.verify.steps[0];

test('対象SHAを履歴ごと取得し、古い生成物を除去して認証情報を残さない', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'infra-ci-checkout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const source = join(root, 'source');
  const bin = join(root, 'bin');
  const temporary = join(root, '_work/_temp');
  const workspace = join(root, '_work/infra-canvas/infra-canvas');
  for (const path of [source, bin, temporary, workspace]) mkdirSync(path, { recursive: true });
  const gitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const git = (...args) =>
    execFileSync(gitPath, args, {
      cwd: source,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'CI fixture');
  git('config', 'user.email', 'ci@example.test');
  writeFileSync(join(source, 'fixture.txt'), 'base');
  git('add', '.');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(source, 'fixture.txt'), 'head');
  git('commit', '-am', 'head');
  const head = git('rev-parse', 'HEAD');
  git('clone', '--bare', source, origin);
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/sh
if [ "$1" = remote ] && [ "$2" = add ]; then
  exec "$REAL_GIT" remote add origin "$FIXTURE_ORIGIN"
fi
if [ "$1" = -c ] && [ "$3" = fetch ]; then
  [ "$GIT_CONFIG_KEY_0" = http.https://github.com/.extraheader ] || exit 90
  [ "$GIT_CONFIG_VALUE_0" = "$EXPECTED_AUTH" ] || exit 91
fi
if [ "$1" = checkout ]; then
  [ -z "\u0024{GIT_CONFIG_COUNT:-}" ] || exit 92
fi
exec "$REAL_GIT" "$@"
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    REAL_GIT: gitPath,
    FIXTURE_ORIGIN: origin,
    EXPECTED_AUTH: `AUTHORIZATION: basic ${Buffer.from('x-access-token:fixture-token').toString('base64')}`,
    CHECKOUT_TOKEN: 'fixture-token',
    RUNNER_TEMP: temporary,
    GITHUB_WORKSPACE: workspace,
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'tqer39/infra-canvas',
    GITHUB_SHA: head,
    BASE_SHA: base,
    HEAD_SHA: head,
    GITHUB_PATH: join(root, 'github-path'),
  };
  writeFileSync(join(workspace, 'stale.txt'), 'stale build');
  const result = spawnSync('bash', ['-e', '-c', checkout.run], {
    env,
    cwd: workspace,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(workspace, 'fixture.txt'), 'utf8'), 'head');
  assert.throws(() => readFileSync(join(workspace, 'stale.txt')));
  assert.equal(
    execFileSync(gitPath, ['-C', workspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    head,
  );
  assert.equal(
    execFileSync(gitPath, ['-C', workspace, 'show', `${base}:fixture.txt`], { encoding: 'utf8' }),
    'base',
  );
  assert.doesNotMatch(
    readFileSync(join(workspace, '.git/config'), 'utf8'),
    /extraheader|fixture-token/,
  );
  for (const override of [
    { GITHUB_WORKSPACE: root },
    { CHECKOUT_TOKEN: '' },
    { GITHUB_SERVER_URL: 'https://untrusted.example' },
    { GITHUB_REPOSITORY: 'other/repo' },
    { GITHUB_SHA: '--help' },
    { GITHUB_SHA: '0'.repeat(40) },
    { BASE_SHA: '' },
  ]) {
    writeFileSync(join(workspace, 'keep.txt'), 'keep');
    const rejected = spawnSync('bash', ['-e', '-c', checkout.run], {
      env: { ...env, ...override },
      cwd: workspace,
    });
    assert.notEqual(rejected.status, 0, JSON.stringify(override));
    assert.equal(readFileSync(join(workspace, 'keep.txt'), 'utf8'), 'keep');
  }
});
