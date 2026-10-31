import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parse } from 'smol-toml';

test('4対象への生成と再生成でCLAUDE.mdを出力せず、非ルートのルールも維持する', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'omnodi-rulesync-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, '.rulesync');
  const output = join(directory, 'output');
  mkdirSync(join(source, 'rules'), { recursive: true });
  mkdirSync(output);
  writeFileSync(join(source, 'rules/overview.md'), readFileSync('.rulesync/rules/overview.md'));
  writeFileSync(
    join(source, 'rules/regression.md'),
    '---\nroot: false\ntargets: ["*"]\ndescription: 非ルートの回帰確認\nglobs: ["**/*"]\n---\n\n# 非ルートの回帰確認\n\n非ルートのルールも生成する。\n',
  );
  const config = readFileSync('rulesync.jsonc', 'utf8');
  const tasks = parse(readFileSync('mise.toml', 'utf8')).tasks;
  const version = tasks['rules:generate'].tools['npm:rulesync'];
  assert.equal(tasks['rules:check'].tools['npm:rulesync'], version);
  // 設定は JSONC のため、末尾カンマだけを除いて対象を検証する。
  const parsed = JSON.parse(config.replace(/,\s*([}\]])/g, '$1'));
  assert.deepEqual(Object.keys(parsed.targets).sort(), [
    'claudecode',
    'codexcli',
    'copilot',
    'devin',
  ]);
  assert.equal(existsSync('CLAUDE.md'), false);
  assert.equal(existsSync('GEMINI.md'), false);
  assert.equal(existsSync('.cursor/rules/overview.mdc'), false);
  const generate = (...extra) =>
    execFileSync(
      'mise',
      [
        'exec',
        `npm:rulesync@${version}`,
        '--',
        'rulesync',
        'generate',
        '--config',
        resolve('rulesync.jsonc'),
        '--input-roots',
        source,
        '--output-roots',
        output,
        ...extra,
      ],
      { stdio: 'pipe' },
    );
  for (let run = 0; run < 2; run++) {
    generate();
    assert.equal(existsSync(join(output, 'CLAUDE.md')), false);
    assert.equal(existsSync(join(output, 'CLAUDE.local.md')), false);
    assert.equal(existsSync(join(output, 'GEMINI.md')), false);
    assert.equal(existsSync(join(output, '.cursor')), false);
    for (const file of ['AGENTS.md', '.github/copilot-instructions.md']) {
      assert.match(readFileSync(join(output, file), 'utf8'), /Omnodi 開発ガイド/);
    }
    for (const file of [
      'AGENTS.md',
      '.claude/rules/regression.md',
      '.devin/rules/regression.md',
      '.github/instructions/regression.instructions.md',
    ]) {
      assert.match(readFileSync(join(output, file), 'utf8'), /非ルートのルールも生成する/);
    }
  }
  generate('--check');
});
