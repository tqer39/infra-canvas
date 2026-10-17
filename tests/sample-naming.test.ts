import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

test('サンプル・画面・文書に参考資料の公開企業名を命名として持ち込まない', () => {
  const publisherNames = /サーバー?ワークス|クラスメソッド|serverworks|classmethod|developersio/i;
  const files = ['README.md'];
  for (const directory of ['examples', 'src', 'docs', 'scripts']) {
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.(infra|ts|tsx|mjs|py|md|json|tf)$/.test(entry.name))
        files.push(join(entry.parentPath, entry.name));
    }
  }
  for (const file of files) {
    assert.doesNotMatch(file, publisherNames, `ファイル名: ${file}`);
    // 出典の追跡に必要なURLはそのまま保持する。
    const content = readFileSync(file, 'utf8').replace(/https?:\/\/[^\s)"'<>]+/g, '');
    assert.doesNotMatch(content, publisherNames, `名称・説明: ${file}`);
  }
});
