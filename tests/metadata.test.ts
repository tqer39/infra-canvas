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
test('ECSのリソース定義をDSL/JSONで検証して単位付き表示を往復する', async () => {
  const d = validateDiagram(parseDSL(readFileSync('examples/ecs-beanstalk.infra', 'utf8')).diagram);
  const restored = validateDiagram(parseDSL(serializeDSL(d)).diagram);
  assert.deepEqual(restored.resources.map(resourceMetadata), d.resources.map(resourceMetadata));
  const definition = d.resources.find((r) => r.id === 'definition')!;
  assert.deepEqual(resourceMetadata(definition), [
    { label: '互換性', value: 'FARGATE' },
    { label: 'CPU', value: '512 units (0.5 vCPU)' },
    { label: 'メモリ', value: '1024 MiB (1 GiB)' },
  ]);
  assert.equal(d.resources.find((r) => r.id === 'service')!.parentId, 'cluster');
  assert.deepEqual(
    resourceMetadata({
      ...definition,
      attributes: { cpu: 1024, 'meta.cpu': '512', 'meta.memory': '2048' },
    }),
    [
      { label: 'CPU', value: '1024 units (1 vCPU)' },
      { label: 'メモリ', value: '2048 MiB (2 GiB)' },
    ],
  );
  for (const attrs of [
    'cpu=-1',
    'cpu=0.5',
    'memory=0',
    'desiredCount=-1',
    'launchType=TYPO',
    'capacityProviders=[""]',
  ]) {
    assert.equal(
      parseDSL(`diagram "invalid" {\naws.ecs-service api ${attrs}\n}`).diagram,
      undefined,
    );
  }
  for (const attrs of [{ cpu: -1 }, { memory: 0 }, { desiredCount: 0.5 }, { launchType: 'TYPO' }]) {
    assert.throws(() =>
      validateDiagram({
        ...d,
        resources: [{ ...definition, parentId: undefined, attributes: attrs }],
        connections: [],
      }),
    );
  }
  const zero = parseDSL(
    'diagram "zero" {\naws.ecs-container c cpu=0\naws.ecs-service s desiredCount=0\n}',
  ).diagram;
  assert.ok(zero);
  for (const collapsed of [[], ['cluster', 'definition']]) {
    const graph = buildDisplayGraph(d, { collapsed });
    const layout = await layoutGraph(graph);
    for (const node of layout.nodes.filter((n) => n.parentId)) {
      const parent = layout.nodes.find((p) => p.id === node.parentId)!;
      assert.ok(
        node.y >=
          56 + resourceMetadata(graph.resources.find((r) => r.id === parent.id)!).length * 20,
      );
    }
  }
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
