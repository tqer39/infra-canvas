import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDSL,
  serializeDSL,
  validateDiagram,
  buildDisplayGraph,
  layoutGraph,
  resourceContent,
} from '../src/core/index.js';

const samples = [
  'aws-web',
  'gcp-delivery',
  'azure-private-link',
  'cloudfront-websocket',
  'centralized-inspection',
  'eks-single-account-single-cluster',
  'eks-single-account-multi-cluster',
  'eks-multi-account-single-cluster',
  'eks-multi-account-multi-cluster',
];
const read = (name: string) => {
  const parsed = parseDSL(readFileSync(`examples/reference/${name}.infra`, 'utf8'));
  assert.deepEqual(parsed.diagnostics, []);
  return validateDiagram(parsed.diagram);
};
for (const name of samples)
  test(`公開構成図 ${name}: roundtrip・折りたたみ復元・配置`, async () => {
    const diagram = read(name);
    const restored = validateDiagram(parseDSL(serializeDSL(diagram)).diagram);
    assert.deepEqual(
      restored.resources.map((r) => r.attributes),
      diagram.resources.map((r) => r.attributes),
    );
    assert.deepEqual(
      restored.connections.map((e) => [e.source, e.target, e.kind, e.attributes]),
      diagram.connections.map((e) => [e.source, e.target, e.kind, e.attributes]),
    );
    const graph = buildDisplayGraph(diagram, { view: 'service' });
    assert.equal(graph.resources.length, diagram.resources.length);
    const folded = buildDisplayGraph(diagram, { view: 'overview' });
    assert.ok(folded.resources.length < graph.resources.length);
    for (const edge of graph.connections) assert.ok(edge.originalIds.length > 0);
    const layout = await layoutGraph(graph);
    for (const node of layout.nodes) {
      assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
      if (node.parentId) {
        const parent = layout.nodes.find((p) => p.id === node.parentId)!;
        assert.ok(
          node.x >= 0 &&
            node.y >= 0 &&
            node.x + node.width <= parent.width + 1 &&
            node.y + node.height <= parent.height + 1,
        );
      }
    }
    assert.equal(layout.edges!.length, graph.connections.length);
    const reopened = buildDisplayGraph(diagram, {
      view: 'overview',
      expanded: diagram.resources.map((r) => r.id),
    });
    assert.deepEqual(reopened.connections, graph.connections);
  });

test('Azure: App Service本体はVNetの外、送信と受信Endpointは別ノード', () => {
  const d = read('azure-private-link');
  assert.equal(d.resources.find((r) => r.id === 'app')!.parentId, 'azure');
  assert.equal(d.resources.find((r) => r.id === 'app_endpoint')!.parentId, 'endpoint_net');
  assert.ok(
    d.connections.some(
      (e) => e.source === 'app' && e.target === 'interface' && e.kind === 'traffic',
    ),
  );
});
test('CloudFront: 私有Subnet内の単一Taskと複数SubnetのALBを区別し、IGWを通信ホップにしない', () => {
  const d = read('cloudfront-websocket');
  assert.equal(d.resources.filter((r) => r.type === 'aws.ecs-task').length, 1);
  assert.deepEqual(d.resources.find((r) => r.id === 'alb')!.attributes.subnets, [
    'isolated_a',
    'isolated_b',
  ]);
  assert.ok(
    d.connections
      .filter((e) => e.source === 'igw' || e.target === 'igw')
      .every((e) => e.kind === 'association'),
  );
});
test('TGW: 検査前後の逆方向と経路表を保持', () => {
  const d = read('centralized-inspection');
  assert.ok(d.connections.some((e) => e.source === 'tgw' && e.target === 'firewall'));
  assert.ok(d.connections.some((e) => e.source === 'firewall' && e.target === 'tgw'));
  const content = resourceContent(d.resources.find((r) => r.id === 'inspection_routes')!);
  assert.equal(content?.kind, 'table');
  if (content?.kind === 'table')
    assert.deepEqual(content.rows[3], ['10.100.6.0/24', 'System B VPC']);
});
test('表・リスト: malformed DSLと外部JSONを拒否、HTML文字列はテキストで保持', async () => {
  for (const attrs of [
    'display=table columns=[Destination,Target] rows=[one]',
    'display=list items="x"',
    'display=table columns=[] rows=[]',
    'rows=[a]',
    'display=invalid',
  ]) {
    assert.ok(
      parseDSL(`diagram "x" { custom.node n ${attrs} }`).diagnostics.some(
        (d) => d.code === 'resource.content',
      ),
    );
  }
  const invalid = read('centralized-inspection');
  invalid.resources[0]!.attributes = { display: 'table', columns: ['a', 'b'], rows: ['one'] };
  assert.throws(() => validateDiagram(invalid));
  assert.ok(
    parseDSL('diagram "x" { group g display=list items=[x] }').diagnostics.some(
      (d) => d.code === 'resource.content',
    ),
  );
  const d = parseDSL(
    'diagram "x" { custom.node n display=list items=["<script>alert(1)</script>", "長い文字列の折り返しを配置に含めます長い文字列の折り返しを配置に含めます"] }',
  ).diagram!;
  const layout = await layoutGraph(buildDisplayGraph(d));
  assert.ok(layout.nodes[0]!.height > 150);
  assert.ok(serializeDSL(d).includes('<script>'));
});

test('EKS の4パターンはクラスターの所有アカウントと Namespace の所属を保持する', () => {
  const names = [
    'eks-single-account-single-cluster',
    'eks-single-account-multi-cluster',
    'eks-multi-account-single-cluster',
    'eks-multi-account-multi-cluster',
  ];
  for (const [index, name] of names.entries()) {
    const d = read(name);
    const clusters = d.resources.filter((r) => r.type === 'aws.eks');
    assert.equal(clusters.length, [1, 2, 1, 2][index]);
    for (const ns of d.resources.filter((r) => r.type === 'k8s.namespace'))
      assert.ok(clusters.some((c) => c.id === ns.parentId));
    const owner = (id: string): string | undefined => {
      let r = d.resources.find((r) => r.id === id);
      while (r && r.type !== 'account') r = d.resources.find((parent) => parent.id === r!.parentId);
      return r?.id;
    };
    if (name === 'eks-multi-account-single-cluster') {
      assert.equal(owner('shared_a_pod'), 'platform');
      assert.equal(owner('primary'), 'platform');
      assert.equal(owner('target_a'), 'workload_a');
      assert.ok(
        d.connections.some(
          (e) => e.source === 'primary' && e.target === 'target_a' && e.kind === 'auth',
        ),
      );
      assert.ok(
        d.connections.filter((e) => e.source === 'share').every((e) => e.kind === 'association'),
      );
    }
    const graph = buildDisplayGraph(d, { collapsed: clusters.map((c) => c.id) });
    assert.ok(!graph.resources.some((r) => r.type === 'k8s.pod'));
    assert.ok(graph.connections.some((e) => clusters.some((c) => c.id === e.source)));
    assert.equal(d.resources.filter((r) => r.type === 'k8s.pod').length, 2);
  }
});

test('Nginx・Envoy 設定は改行や変数を変更せず往復し、不正な型と形式を拒否する', () => {
  const d = validateDiagram(parseDSL(readFileSync('examples/proxies.infra', 'utf8')).diagram);
  const next = validateDiagram(parseDSL(serializeDSL(d)).diagram);
  assert.deepEqual(
    next.resources.map((r) => r.attributes),
    d.resources.map((r) => r.attributes),
  );
  assert.match(String(next.resources[1]!.attributes.config), /\$host/);
  for (const attrs of ['config=[x]', 'configFormat=unknown config="x"', 'configFormat=nginx']) {
    assert.ok(!parseDSL(`diagram "x" { software.nginx n ${attrs} }`).diagram);
  }
  d.resources[1]!.attributes.configFormat = 'unknown';
  assert.throws(() => validateDiagram(d));
});
