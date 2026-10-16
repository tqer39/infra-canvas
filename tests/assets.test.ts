import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getResourceIconType } from '../src/assets/resource-icons.js';
import { parseDSL, validateDiagram } from '../src/core/index.js';

test('Fly.io はブランド画像を配布せず、月次取得されない独自の汎用記号を使う', () => {
  const manifest = JSON.parse(readFileSync('src/assets/manifest.json', 'utf8'));
  const entry = manifest.find((item: { type: string }) => item.type === 'saas.fly');
  assert.ok(entry);
  assert.equal(entry.provider, 'Infra Canvas');
  assert.equal(entry.downloadURL, undefined);
  assert.equal(entry.archivePath, undefined);
  assert.equal(entry.homepage, 'https://fly.io');
  const svg = readFileSync(`src/assets/${entry.file}`, 'utf8');
  assert.match(svg, /<rect\b/);
  assert.doesNotMatch(svg, /brandmark|fly\.io/i);
});

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
    if (entry.file.endsWith('.png')) {
      assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
      assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
      assert.equal(bytes.toString('ascii', bytes.length - 8, bytes.length - 4), 'IEND');
      continue;
    }
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

test('Simple Icons の55種はブランドカラーを適用し、原本の形状を保持する', () => {
  const manifest = JSON.parse(readFileSync('src/assets/manifest.json', 'utf8')) as {
    type: string;
    file: string;
    provider?: string;
    brandColor?: string;
    originalSha256?: string;
  }[];
  const colored = manifest.filter((icon) => icon.provider === 'Simple Icons');
  assert.equal(colored.length, 55);
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

test('LLMカタログと全サービスカタログは有効で、同梱資産の型を漏れなく表示する', () => {
  const manifest = JSON.parse(readFileSync('src/assets/manifest.json', 'utf8')) as {
    type: string;
  }[];
  const catalogs = ['service-catalog', 'llm-catalog'].map((name) => {
    const parsed = parseDSL(readFileSync(`examples/${name}.infra`, 'utf8'));
    assert.ok(parsed.diagram, JSON.stringify(parsed.diagnostics));
    assert.deepEqual(validateDiagram(parsed.diagram).diagnostics, []);
    const types = parsed.diagram.resources.map((resource) => resource.type);
    assert.equal(new Set(types).size, types.length);
    for (const type of types)
      assert.ok(
        manifest.some((entry) => entry.type === type),
        type,
      );
    return types;
  });
  assert.deepEqual(
    [...catalogs[0]].sort(),
    manifest
      .filter((entry) => entry.type.startsWith('saas.'))
      .map((entry) => entry.type)
      .sort(),
  );
  assert.equal(catalogs[1].length, 17);
  for (const type of catalogs[1]) assert.ok(catalogs[0].includes(type), type);
});

test('表示アイコンの指定は種別・境界より優先し、DSLで保持する', () => {
  const parsed = parseDSL(`diagram "icons" {
    external.service settings "設定" icon="saas.github"
    vpc network "境界" icon="gcp.compute"
    aws.ecs automatic "自動" icon=""
  }`);
  assert.ok(parsed.diagram, JSON.stringify(parsed.diagnostics));
  assert.deepEqual(validateDiagram(parsed.diagram).diagnostics, []);
  const resources = new Map(parsed.diagram.resources.map((resource) => [resource.id, resource]));
  assert.equal(getResourceIconType(resources.get('settings')!, resources), 'saas.github');
  assert.equal(getResourceIconType(resources.get('network')!, resources), 'gcp.compute');
  assert.equal(getResourceIconType(resources.get('automatic')!, resources), 'aws.ecs');
});

test('AWS境界アイコンは明示的な公開区分と所属を使い、他クラウドや未知の区分を推測しない', () => {
  const parsed = parseDSL(`diagram "境界アイコン" {
    vpc vpc "VPC" {
      subnet public_net "名前には区分なし" public
      subnet private_net "名前には区分なし" private
      subnet unknown_net "Public と書いても未確定" unknown
    }
    project google "Google" {
      network gcp "Network" {
        subnet google_net "Private AWS という名前" private
      }
    }
    subscription azure "Azure" {
      subnet azure_net "Public" public
    }
    subnet orphan "Private" private
    subnet imported "Public" provider="aws.secondary" subnetVisibility="public"
    subnet unknown_imported "Private" provider="aws" subnetVisibility="unknown"
    subnet explicit_google "Public" public provider="google"
  }`);
  assert.ok(parsed.diagram, JSON.stringify(parsed.diagnostics));
  const resources = new Map(parsed.diagram.resources.map((resource) => [resource.id, resource]));
  const icon = (id: string) => getResourceIconType(resources.get(id)!, resources);
  assert.equal(icon('vpc'), 'aws.vpc');
  assert.equal(icon('public_net'), 'aws.subnet-public');
  assert.equal(icon('private_net'), 'aws.subnet-private');
  assert.equal(icon('imported'), 'aws.subnet-public');
  for (const id of [
    'unknown_net',
    'google_net',
    'azure_net',
    'orphan',
    'unknown_imported',
    'explicit_google',
  ])
    assert.equal(icon(id), 'subnet', id);
});
test('AWSのアカウントとリージョンに公式境界アイコンを使い、他クラウドへ流用しない', () => {
  const d = parseDSL(`diagram "regions" {
account aws "AWS アカウント" {
 region tokyo "東京" region="ap-northeast-1"
 region planned "未確定リージョン"
}
region standalone "Virginia" region="us-east-1"
project google "Google" {
 region gcp "東京" region="asia-northeast1"
}
subscription azure "Azure" {
 region azure_region "東京" region="japaneast"
}
region unknown "AWS 東京"
region explicit_google "東京" region="ap-northeast-1" provider=google
}`).diagram!;
  const byId = new Map(d.resources.map((r) => [r.id, r]));
  const icon = (id: string) => getResourceIconType(byId.get(id)!, byId);
  assert.equal(icon('aws'), 'aws.account');
  for (const id of ['tokyo', 'planned', 'standalone']) assert.equal(icon(id), 'aws.region');
  for (const id of ['gcp', 'azure_region', 'unknown', 'explicit_google'])
    assert.equal(icon(id), 'region');
});
