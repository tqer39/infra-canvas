import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDSL,
  validateDiagram,
  serializeDSL,
  buildDisplayGraph,
  layoutGraph,
  absolutePlacements,
  exportSVG,
  printDocument,
  resourceMetadata,
  isBoundary,
} from '../src/core/index.js';
import type { Diagram } from '../src/core/index.js';
const source = readFileSync('examples/expressions.infra', 'utf8');
function parsed(): Diagram {
  const result = parseDSL(source);
  assert.deepEqual(result.diagnostics, []);
  return result.diagram!;
}
it('P2/P3の属性・任意境界・安定した接続ID・注釈をDSL/JSONで往復する', () => {
  const diagram = parsed(),
    again = validateDiagram(parseDSL(serializeDSL(diagram)).diagram);
  assert.deepEqual(
    again.resources.map((resource) => resource.attributes),
    diagram.resources.map((resource) => resource.attributes),
  );
  assert.deepEqual(
    again.connections.map((edge) => [edge.id, edge.attributes]),
    diagram.connections.map((edge) => [edge.id, edge.attributes]),
  );
  assert.equal(isBoundary(again.resources.find((resource) => resource.id === 'office')!), true);
  assert.ok(
    resourceMetadata(again.resources.find((resource) => resource.id === 'api')!).some(
      (item) => item.value === '×2–6',
    ),
  );
  assert.ok(
    resourceMetadata(again.resources.find((resource) => resource.id === 'api_a')!).some(
      (item) => item.value === '観測',
    ),
  );
});
it('AZ・リージョンの列を揃え、論理サービスと配置実体の所属を保つ', async () => {
  const diagram = parsed(),
    graph = buildDisplayGraph(diagram),
    layout = await layoutGraph(graph);
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.equal(nodes.get('tokyo')!.y, nodes.get('osaka')!.y);
  assert.ok(nodes.get('tokyo')!.x < nodes.get('osaka')!.x);
  assert.equal(nodes.get('az_a')!.x, nodes.get('az_c')!.x);
  assert.ok(nodes.get('az_a')!.y + nodes.get('az_a')!.height < nodes.get('az_c')!.y);
  const down = await layoutGraph(graph, { direction: 'DOWN' });
  const downNodes = new Map(down.nodes.map((node) => [node.id, node]));
  assert.equal(downNodes.get('az_a')!.y, downNodes.get('az_c')!.y);
  assert.ok(downNodes.get('az_a')!.x + downNodes.get('az_a')!.width < downNodes.get('az_c')!.x);
  assert.equal(diagram.resources.find((resource) => resource.id === 'api_a')!.parentId, 'az_a');
  assert.equal(
    graph.connections.filter((edge) => edge.source === 'api' && edge.kind === 'association').length,
    2,
  );
  const collapsed = buildDisplayGraph(diagram, { collapsed: ['tokyo'] });
  assert.ok(collapsed.connections.some((edge) => edge.source === 'api' && edge.target === 'tokyo'));
});
it('固定位置は列整列より優先する', async () => {
  const diagram = parsed();
  const tokyo = diagram.resources.find((resource) => resource.id === 'tokyo')!;
  tokyo.attributes = { ...tokyo.attributes, x: 24, y: 56, fixed: true };
  const layout = await layoutGraph(buildDisplayGraph(diagram));
  assert.equal(layout.nodes.find((node) => node.id === 'tokyo')!.x, 24);
  assert.equal(layout.nodes.find((node) => node.id === 'tokyo')!.y, 56);
});
it('注釈を端点にせず、実体・線のアンカーを描画し、隠した線の注釈を省略', async () => {
  const graph = buildDisplayGraph(parsed());
  assert.equal(
    graph.resources.some((resource) => resource.type === 'note'),
    false,
  );
  const layout = await layoutGraph(graph);
  assert.equal(layout.annotations?.length, 2);
  assert.ok(layout.annotations!.every((note) => note.anchor));
  const hidden = await layoutGraph(buildDisplayGraph(parsed(), { kinds: ['replication'] }));
  assert.equal(
    hidden.annotations?.some((note) => note.id === 'encryption'),
    false,
  );
});
it('囲みラベルは所有境界の見出し・カード・他のラベルと重ならない', async () => {
  const diagram = parseDSL(readFileSync('examples/architecture.infra', 'utf8')).diagram!;
  for (const collapsed of [[], ['prod'], ['az_a']]) {
    const layout = await layoutGraph(buildDisplayGraph(diagram, { collapsed }));
    const obstacles = [...absolutePlacements(layout.nodes).values()].map((node) => ({
      ...node,
      height: node.contentTop ?? node.height,
    }));
    for (const overlay of layout.overlays!) {
      const box = {
        x: overlay.labelX!,
        y: overlay.labelY!,
        width: overlay.labelWidth!,
        height: overlay.labelHeight!,
      };
      for (const other of obstacles)
        assert.ok(
          box.x + box.width <= other.x ||
            box.x >= other.x + other.width ||
            box.y + box.height <= other.y ||
            box.y >= other.y + other.height,
          `${overlay.id} overlaps ${'id' in other ? other.id : 'label'}`,
        );
      obstacles.push({ ...overlay, ...box });
    }
  }
});
for (const [name, modify] of [
  ['未知の公開区分', (s: string) => s.replace('exposure=public', 'exposure=secret')],
  ['未知の根拠', (s: string) => s.replace('evidence=observed', 'evidence=live')],
  ['未知の変更状態', (s: string) => s.replace('change=add', 'change=deploy')],
  ['台数の逆転', (s: string) => s.replace('countMin=2 countMax=6', 'countMin=6 countMax=2')],
  ['負の台数', (s: string) => s.replace('count=2', 'count=-1')],
  [
    '台数の併用',
    (s: string) => s.replace('countMin=2 countMax=6', 'count=2 countMin=2 countMax=6'),
  ],
  ['片側の範囲', (s: string) => s.replace('countMin=2 countMax=6', 'countMin=2')],
  ['不明な注釈先', (s: string) => s.replace('anchor=api_c', 'anchor=missing')],
  ['不明な線', (s: string) => s.replace('anchorEdge=internet_api', 'anchorEdge=missing')],
  [
    '重複接続ID',
    (s: string) =>
      s.replace('api_a -> database encrypted', 'api_a -> database id=internet_api encrypted'),
  ],
  ['暗号化の型', (s: string) => s.replace('encrypted=true', 'encrypted="true"')],
  [
    '論理サービスの循環',
    (s: string) => s.replace('countMin=2 countMax=6', 'logicalService=api_a countMin=2 countMax=6'),
  ],
  ['注釈への通信', (s: string) => s.replace('api_a -> jobs', 'rollout -> jobs')],
  ['境界の型', (s: string) => s.replace('boundary=true', 'boundary="yes"')],
] as const)
  it(`P2/P3の不正入力を拒否: ${name}`, () =>
    assert.ok(parseDSL(modify(source)).diagnostics.length));
it('外部JSONも根拠・境界・注釈・台数・通信方式を検証する', () => {
  for (const change of [
    (d: Diagram) => {
      d.resources[0]!.attributes.evidence = ['observed'];
    },
    (d: Diagram) => {
      d.resources[0]!.attributes.count = 1.5;
    },
    (d: Diagram) => {
      d.resources[0]!.attributes.columnsBy = 'az';
    },
    (d: Diagram) => {
      d.connections[0]!.attributes.encrypted = 'true';
    },
    (d: Diagram) => {
      d.resources.find((r) => r.id === 'rollout')!.attributes.anchorEdge = 'internet_api';
    },
  ]) {
    const d = parsed();
    change(d);
    assert.throws(() => validateDiagram(d));
  }
});
it('SVGに凡例と全表現を含め、タグと文字列を実行可能なHTMLにしない', async () => {
  const diagram = parsed();
  diagram.title = '<script>alert("x")</script>';
  const svg = await exportSVG(diagram);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('台数'));
  assert.ok(svg.includes('追加予定'));
  assert.ok(svg.includes('data-note-id="rollout"'));
  assert.ok(svg.includes('data-resource-id="office"'));
  assert.ok(svg.includes('暗号化'));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.equal(svg.includes('<script>'), false);
  assert.equal(svg.includes('foreignObject'), false);
  assert.equal(svg.includes('http://127.'), false);
});
it('印刷は用紙・向き・縮尺を検証し、分割のページ数とviewBoxを保つ', async () => {
  const svg = await exportSVG(parsed());
  const fit = printDocument(svg, { paper: 'A3', orientation: 'portrait' });
  assert.equal((fit.match(/class="sheet"/g) ?? []).length, 1);
  assert.ok(fit.includes('size:A3 portrait'));
  const tiled = printDocument(svg, { pages: 'tile', scale: 1 });
  assert.ok((tiled.match(/class="sheet"/g) ?? []).length > 1);
  assert.ok(tiled.includes('break-after:page'));
  assert.throws(() => printDocument(svg, { scale: 0 }));
  assert.throws(() => printDocument(svg, { paper: 'Letter' as never }));
});

it('明示したAWSアカウントのアイコンを保持し、providerや名前から別クラウドを誤認しない', async () => {
  const { getResourceIconType } = await import('../src/assets/resource-icons.js');
  const { resourceTypeLabel } = await import('../src/core/presentation.js');
  const d = parseDSL(
    'diagram "icons" {\n account prod "本番" icon=aws.organization-account\n account generic "AWSと名付けた汎用境界"\n account explicit provider=aws\n}',
  ).diagram!;
  validateDiagram(d);
  const resources = new Map(d.resources.map((r) => [r.id, r]));
  assert.equal(getResourceIconType(resources.get('prod')!, resources), 'aws.organization-account');
  assert.equal(resourceTypeLabel(resources.get('prod')!), 'AWS アカウント');
  assert.equal(getResourceIconType(resources.get('generic')!, resources), 'account');
  assert.equal(
    getResourceIconType(resources.get('explicit')!, resources),
    'aws.organization-account',
  );
  assert.equal(
    parseDSL(serializeDSL(d)).diagram!.resources[0]!.attributes.icon,
    'aws.organization-account',
  );
  assert.ok(
    parseDSL('diagram "bad" {\n account x icon="https://example.com/image.svg"\n}').diagnostics
      .length,
  );
});

it('保存ビューの表示名をDSLとJSONの往復で保持し空の名前は拒否する', () => {
  const diagram = parseDSL(
    'diagram "views" { view app label="アプリ通信" level=resource }',
  ).diagram!;
  assert.equal(diagram.views[0]!.label, 'アプリ通信');
  assert.equal(
    validateDiagram(parseDSL(serializeDSL(diagram)).diagram).views[0]!.label,
    'アプリ通信',
  );
  assert.ok(parseDSL('diagram "views" { view app label="" level=resource }').diagnostics.length);
  assert.throws(() => validateDiagram({ ...diagram, views: [{ ...diagram.views[0], label: '' }] }));
});
