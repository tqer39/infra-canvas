import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseDSL, validateDiagram } from '../src/core/index.js';

test('同梱アイコンは記録した原本と一致し、外部資産や実行コードを含まない', () => {
  const manifest = JSON.parse(readFileSync('src/assets/manifest.json', 'utf8')) as {
    type: string;
    file: string;
    sha256: string;
    source?: string;
  }[];
  assert.equal(new Set(manifest.map((entry) => entry.type)).size, manifest.length);
  for (const entry of manifest) {
    const bytes = readFileSync(`src/assets/${entry.file}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.file);
    const svg = bytes.toString('utf8');
    assert.match(svg, /<svg\b/, entry.file);
    assert.doesNotMatch(
      svg,
      /<(?:script|foreignObject|image)\b|\bon\w+\s*=|(?:href\s*=\s*["'](?:https?:|\/\/))|url\(\s*["']?https?:/i,
      entry.file,
    );
    if (entry.type.startsWith('saas.')) assert.match(entry.source ?? '', /^https:\/\//);
  }
});

test('SaaS の実例は9サービスの有効な DSL で、すべて同梱アイコンに対応する', () => {
  const parsed = parseDSL(readFileSync('examples/saas.infra', 'utf8'));
  assert.ok(parsed.diagram, JSON.stringify(parsed.diagnostics));
  assert.deepEqual(validateDiagram(parsed.diagram).diagnostics, []);
  const manifest = JSON.parse(readFileSync('src/assets/manifest.json', 'utf8')) as {
    type: string;
  }[];
  assert.equal(parsed.diagram.resources.length, 9);
  assert.equal(new Set(parsed.diagram.resources.map((resource) => resource.type)).size, 9);
  for (const resource of parsed.diagram.resources)
    assert.ok(manifest.some((entry) => entry.type === resource.type));
});
