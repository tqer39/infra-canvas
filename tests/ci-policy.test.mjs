import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { changedFiles, needsBrowser, runnerPort } from '../scripts/ci-policy.mjs';

test('ポートCLIはrunner名に対応した値を出力し、未知のrunnerでは設定を出力しない', () => {
  for (const name of [
    'infra-canvas-ci-1',
    'infra-canvas-ci-2',
    'infra-canvas-ci-3',
    'infra-canvas-maintenance',
  ]) {
    const result = spawnSync(process.execPath, ['scripts/ci-policy.mjs', 'port'], {
      env: { ...process.env, RUNNER_NAME: name },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `INFRA_TEST_PORT=${runnerPort(name)}\n`);
  }
  for (const name of ['', 'unregistered-runner', 'infra-canvas-ci-4', '__proto__']) {
    const result = spawnSync(process.execPath, ['scripts/ci-policy.mjs', 'port'], {
      env: { ...process.env, RUNNER_NAME: name },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
});

test('文書・Renovate・AIルール・単体検証・アイコン取得処理だけならブラウザーを省略する', () => {
  for (const file of [
    'README.md',
    'docs/dsl.md',
    'renovate.json5',
    'rulesync.jsonc',
    'AGENTS.md',
    '.rulesync/rules/overview.md',
    '.claude/rules/overview.md',
    '.devin/rules/overview.md',
    '.github/copilot-instructions.md',
    '.github/workflows/update-icons.yml',
    'scripts/update-icons.py',
    'scripts/publish-icon-update.sh',
    'tests/update-icons.test.py',
    'tests/core.test.ts',
    'tests/ci-policy.test.mjs',
    '.oxfmtrc.json',
  ]) {
    assert.equal(needsBrowser([file]), false, file);
  }
});

test('描画・CLI・サンプル・依存・実行環境・CI条件の変更はブラウザーを実行する', () => {
  for (const file of [
    'src/viewer/main.tsx',
    'src/core/parser.ts',
    'src/cli.ts',
    'src/assets/aws.svg',
    'src/assets/manifest.json',
    'examples/terraform/fixture-plan.json',
    'examples/reference/aws-web.infra',
    'package.json',
    'package-lock.json',
    'mise.toml',
    'vite.config.ts',
    'tsconfig.build.json',
    'playwright.config.ts',
    'tests/browser/global-setup.ts',
    'tests/browser/viewer.spec.ts',
    'scripts/build.mjs',
    'scripts/ci-policy.mjs',
    '.github/workflows/ci.yml',
    'index.html',
  ]) {
    assert.equal(needsBrowser([file]), true, file);
  }
});

test('未知のファイルと実装を含む混合変更は省略しない', () => {
  assert.equal(needsBrowser(['scripts/new-build.mjs']), true);
  assert.equal(needsBrowser(['README.md', 'renovate.json5', 'src/core/model.ts']), true);
  assert.equal(needsBrowser([]), false);
});

test('初回pushは全検証し、不正なSHAや未対応イベントは判定を失敗させる', () => {
  assert.equal(changedFiles('0'.repeat(40), 'a'.repeat(40), 'push'), null);
  assert.throws(() => changedFiles('--help', 'a'.repeat(40), 'push'));
  assert.throws(() => changedFiles('0'.repeat(40), undefined, 'push'));
  assert.throws(() => changedFiles('a'.repeat(40), 'b'.repeat(40), 'workflow_dispatch'));
});

test('実際のGit差分でPRのmerge-base、複数コミット、削除・改名・特殊なファイル名を扱う', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'infra-canvas-ci-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim();
  const write = (file, value) => writeFileSync(join(directory, file), value);
  git('init', '-b', 'main');
  git('config', 'user.name', 'CI fixture');
  git('config', 'user.email', 'fixture@example.test');
  mkdirSync(join(directory, 'src'));
  mkdirSync(join(directory, 'docs'));
  write('src/app.js', 'initial');
  git('add', '.');
  git('commit', '-m', 'initial');
  const initial = git('rev-parse', 'HEAD');
  git('switch', '-c', 'topic');
  write('docs/space\nand tab\t.md', 'document');
  git('add', '.');
  git('commit', '-m', 'docs');
  const docsHead = git('rev-parse', 'HEAD');
  git('switch', 'main');
  write('src/app.js', 'upstream change');
  git('add', '.');
  git('commit', '-m', 'upstream');
  const upstream = git('rev-parse', 'HEAD');
  const run = (base, head, event) =>
    spawnSync(process.execPath, [resolve('scripts/ci-policy.mjs'), 'changes'], {
      cwd: directory,
      env: { ...process.env, BASE_SHA: base, HEAD_SHA: head, EVENT_NAME: event },
      encoding: 'utf8',
    });
  const docsOnly = run(upstream, docsHead, 'pull_request');
  assert.equal(docsOnly.status, 0, docsOnly.stderr);
  assert.equal(docsOnly.stdout, 'browser=false\n');
  git('switch', 'topic');
  renameSync(join(directory, 'src/app.js'), join(directory, 'docs/app.js'));
  git('add', '.');
  git('commit', '-m', 'move source into docs');
  const movedHead = git('rev-parse', 'HEAD');
  for (const event of ['pull_request', 'push']) {
    const result = run(initial, movedHead, event);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'browser=true\n');
  }
  const missing = run('f'.repeat(40), movedHead, 'push');
  assert.notEqual(missing.status, 0);
  assert.equal(missing.stdout, '');
});
