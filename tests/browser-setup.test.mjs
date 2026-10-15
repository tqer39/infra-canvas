import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('全ワーカー共有のHTML・PNG・PDFを開始時に一度だけ生成する', async (t) => {
  const commands = [];
  const stub = t.mock.method(childProcess, 'execFileSync', (_file, args) => {
    commands.push(args);
    return Buffer.from('');
  });
  syncBuiltinESMExports();
  const directory = mkdtempSync(join(tmpdir(), 'infra-browser-setup-'));
  const original = process.cwd();
  try {
    const { default: setup } = await import('./browser/global-setup.ts');
    process.chdir(directory);
    setup();
    const outputs = commands.map((args) => args[args.indexOf('--out') + 1]);
    assert.equal(new Set(outputs).size, outputs.length);
    for (const file of [
      'architecture.html',
      'expressions.html',
      'expressions-cli.png',
      'expressions-cli.pdf',
      'terraform-model.json',
    ]) {
      assert.equal(outputs.filter((output) => output === `artifacts/${file}`).length, 1, file);
    }
  } finally {
    process.chdir(original);
    stub.mock.restore();
    syncBuiltinESMExports();
    rmSync(directory, { recursive: true, force: true });
  }
});
