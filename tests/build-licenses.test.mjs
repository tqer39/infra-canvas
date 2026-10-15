import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { bundleLicenseNotices, licenseNoticeHTML } from '../scripts/build-licenses.mjs';

test('実際に同梱する依存の許諾原文とELKのソース案内を配布物へ含める', async () => {
  const notices = await bundleLicenseNotices({
    inputs: {
      'node_modules/react/index.js': {},
      'node_modules/react/cjs/react.production.js': {},
      'node_modules/elkjs/lib/elk.bundled.js': {},
      'node_modules/typescript/lib/typescript.js': {},
      'src/viewer/main.tsx': {},
    },
  });
  assert.match(notices, /MIT License/);
  assert.match(notices, /Copyright \(c\) Meta Platforms/);
  assert.match(notices, /Eclipse Public License/);
  assert.match(notices, /https:\/\/github.com\/kieler\/elkjs/);
  assert.equal((notices.match(/react@/g) ?? []).length, 1);
  assert.ok(
    notices.includes(await readFile('node_modules/typescript/ThirdPartyNoticeText.txt', 'utf8')),
  );
});

test('許諾文にHTML終端・スクリプトが含まれても文字情報として埋め込む', () => {
  const html = licenseNoticeHTML('</pre><script>alert(1)</script>&');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;\/pre&gt;&lt;script&gt;/);
  assert.match(html, /&amp;/);
});
