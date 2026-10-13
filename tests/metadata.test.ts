import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDSL,
  validateDiagram,
  serializeDSL,
  buildDisplayGraph,
  layoutGraph,
  resourceMetadata,
} from '../src/core/index.js';

test('識別情報は明示属性だけを表示し、先頭ゼロと未知のリージョンも保持', () => {
  const r = {
    id: 'ap-northeast-1a',
    type: 'subnet',
    label: '東京',
    attributes: {
      account: '012345678901',
      region: 'future-region',
      az: 'manual-zone',
      availability_zone: 'imported-zone',
      azId: 'explicit-id',
      availability_zone_id: 'imported-id',
      cidr_block: '10.0.0.0/24',
    },
  };
  assert.deepEqual(resourceMetadata(r), [
    { label: 'アカウントID', value: '012345678901' },
    { label: 'リージョン', value: 'future-region' },
    { label: 'AZ', value: 'manual-zone' },
    { label: 'AZ ID', value: 'explicit-id' },
    { label: 'CIDR', value: '10.0.0.0/24' },
  ]);
  assert.deepEqual(resourceMetadata({ ...r, attributes: {} }), []);
  const imported = resourceMetadata({
    ...r,
    attributes: { availability_zone: 'ap-northeast-1a', availability_zone_id: 'apne1-az1' },
  });
  assert.deepEqual(imported, [
    { label: 'AZ', value: 'ap-northeast-1a' },
    { label: 'AZ ID', value: 'apne1-az1' },
  ]);
});
test('識別情報をDSL往復し、展開中の境界ヘッダーと折りたたみカードの領域を確保', async () => {
  const d = validateDiagram(parseDSL(readFileSync('examples/identity.infra', 'utf8')).diagram);
  const restored = validateDiagram(parseDSL(serializeDSL(d)).diagram);
  assert.deepEqual(restored.resources.map(resourceMetadata), d.resources.map(resourceMetadata));
  for (const collapsed of [[], ['prod', 'google', 'azure'], ['private_a']]) {
    const graph = buildDisplayGraph(d, { view: 'service', collapsed });
    const a = await layoutGraph(graph);
    const b = await layoutGraph(graph);
    assert.deepEqual(a.nodes, b.nodes);
    for (const node of a.nodes) {
      if (node.parentId) {
        const parent = a.nodes.find((p) => p.id === node.parentId)!;
        assert.ok(
          node.y >=
            56 + resourceMetadata(graph.resources.find((r) => r.id === parent.id)!).length * 20,
        );
        assert.ok(
          node.x + node.width <= parent.width + 1 && node.y + node.height <= parent.height + 1,
        );
      }
    }
  }
});
