import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseDSL, validateDiagram } from '../src/core/index.js';

test('同梱アイコンは記録したハッシュと一致し、外部資産や実行コードを含まない', () => {
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

test('Simple Icons の37種はブランドカラーを適用し、原本の形状を保持する', () => {
  const manifest = JSON.parse(readFileSync('src/assets/manifest.json', 'utf8')) as {
    type: string;
    file: string;
    provider?: string;
    brandColor?: string;
    originalSha256?: string;
  }[];
  const colored = manifest.filter((icon) => icon.provider === 'Simple Icons');
  assert.equal(colored.length, 37);
  for (const icon of colored) {
    assert.match(icon.brandColor ?? '', /^#[0-9A-F]{6}$/);
    const svg = readFileSync(`src/assets/${icon.file}`, 'utf8');
    assert.ok(svg.startsWith(`<svg fill="${icon.brandColor}" `), icon.type);
    const original = svg.replace(`<svg fill="${icon.brandColor}" `, '<svg ');
    assert.equal(
      createHash('sha256').update(original).digest('hex'),
      icon.originalSha256,
      icon.type,
    );
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
