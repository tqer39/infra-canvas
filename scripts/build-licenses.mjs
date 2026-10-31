import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// バンドルに含まれた依存だけから原文の著作権・許諾表示を収集する。
export async function bundleLicenseNotices(metafile) {
  const roots = new Set(
    Object.keys(metafile.inputs)
      .map((input) => input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1])
      .filter(Boolean),
  );
  const sections = [
    await readFile('LICENSE', 'utf8'),
    await readFile('THIRD_PARTY_NOTICES.md', 'utf8'),
    await readFile('src/assets/SIMPLE-ICONS-LICENSE.txt', 'utf8'),
    await readFile('src/assets/SIMPLE-ICONS-DISCLAIMER.txt', 'utf8'),
    await readFile('src/assets/flags/LICENSE.txt', 'utf8'),
    'ELK.js is distributed under EPL-2.0. Its Source Code is available under EPL-2.0 at https://github.com/kieler/elkjs (see the tag matching the version below), with the underlying ELK sources at https://github.com/eclipse/elk. Omnodi does not modify these upstream sources.',
  ];
  for (const root of [...roots].sort()) {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const files = (await readdir(root))
      .filter((name) =>
        /^(?:licen[sc]e|copying|notice)(?:\..*)?$|^third[-_]?party.*(?:notice|licen[sc]e)/i.test(
          name,
        ),
      )
      .sort();
    if (!files.length) throw new Error(`依存の許諾文が見つかりません: ${pkg.name}`);
    sections.push(
      `${pkg.name}@${pkg.version} (${pkg.license ?? 'see license text'})`,
      ...(await Promise.all(files.map((file) => readFile(path.join(root, file), 'utf8')))),
    );
  }
  return sections.join('\n\n');
}

export function licenseNoticeHTML(notices) {
  const escaped = notices.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<pre hidden id="omnodi-license-notices">${escaped}</pre>`;
}
