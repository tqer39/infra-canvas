import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDSL,
  serializeDSL,
  validateDiagram,
  buildDisplayGraph,
  layoutGraph,
  absolutePlacements,
} from '../src/core/index.js';
import type { Diagram } from '../src/core/index.js';

const source = readFileSync('examples/architecture.infra', 'utf8');
const parsed = (): Diagram => {
  const result = parseDSL(source);
  assert.deepEqual(result.diagnostics, []);
  return result.diagram!;
};
it('保存ビューが用途・種別・経路を交差で絞り込み、入力を変えずDSL/JSON往復する', () => {
  const diagram = parsed();
  const original = JSON.stringify(diagram);
  const data = buildDisplayGraph(diagram, { view: 'data' });
  assert.equal(data.connections.length, 1);
  assert.equal(data.connections[0]!.kind, 'replication');
  const path = buildDisplayGraph(diagram, { view: 'web_path' });
  assert.equal(path.connections.length, 6);
  assert.equal(buildDisplayGraph(diagram, { view: 'web_path', kinds: [] }).connections.length, 0);
  assert.equal(
    buildDisplayGraph(diagram, { purposes: ['data'], kinds: ['traffic'] }).connections.length,
    0,
  );
  assert.equal(JSON.stringify(diagram), original);
  const restored = validateDiagram(parseDSL(serializeDSL(diagram)).diagram);
  assert.deepEqual(restored.views, diagram.views);
  assert.deepEqual(
    restored.connections.map((edge) => edge.attributes),
    diagram.connections.map((edge) => edge.attributes),
  );
});
it('経路の方向・順序と接続口を折りたたみでも保持し、展開で端点を復元する', () => {
  const diagram = parsed();
  const collapsed = buildDisplayGraph(diagram, { collapsed: ['prod'], routes: ['web'] });
  assert.equal(collapsed.connections.length, 2);
  assert.equal(collapsed.connections[0]!.attributes.targetPort, undefined);
  assert.equal(collapsed.connections[1]!.attributes.sourcePort, undefined);
  assert.equal(collapsed.connections[1]!.attributes.routeDirection, 'return');
  const expanded = buildDisplayGraph(diagram, { routes: ['web'] });
  assert.equal(expanded.connections.length, 6);
  assert.equal(expanded.connections[1]!.attributes.targetPort, 'frontend');
});
it('複数の囲みが実体を複製せず階層を跨ぎ、折りたたみ後の代表ノードを囲む', async () => {
  const diagram = parsed();
  const graph = buildDisplayGraph(diagram);
  assert.equal(
    graph.resources.some((resource) => resource.type === 'overlay'),
    false,
  );
  assert.equal(graph.overlays?.length, 2);
  const layout = await layoutGraph(graph);
  const nodes = absolutePlacements(layout.nodes);
  for (const overlay of layout.overlays!) {
    for (const id of overlay.members) {
      const node = nodes.get(id)!;
      assert.ok(overlay.x <= node.x && overlay.y <= node.y);
      assert.ok(overlay.x + overlay.width >= node.x + node.width);
      assert.ok(overlay.y + overlay.height >= node.y + node.height);
    }
  }
  const folded = await layoutGraph(buildDisplayGraph(diagram, { collapsed: ['prod'] }));
  assert.deepEqual(folded.overlays![0]!.members, ['prod']);
});
for (const [name, modify] of [
  ['飛び番号', (s: string) => s.replace('step=2 purpose', 'step=4 purpose')],
  ['番号重複', (s: string) => s.replace('step=2 purpose', 'step=1 purpose')],
  ['不連続', (s: string) => s.replace('alb -> api_a route', 'user -> api_a route')],
  ['不明な接続口', (s: string) => s.replace('targetPort=frontend', 'targetPort=missing')],
  ['未知の方向', (s: string) => s.replace('routeDirection=return', 'routeDirection=invalid')],
  ['不明な経路ビュー', (s: string) => s.replace('routes=[web]', 'routes=[missing]')],
  ['重複接続口', (s: string) => s.replace('ports=[frontend,backend]', 'ports=[frontend,frontend]')],
  ['囲み自身の参照', (s: string) => s.replace('members=[api_a,api_c]', 'members=[application]')],
  ['囲みの端点', (s: string) => s.replace('user -> alb route', 'application -> alb route')],
  ['不正な役割', (s: string) => s.replace('redundancyRole=primary', 'redundancyRole=unknown')],
] as const)
  it(`構成図の不正入力をDSLで拒否: ${name}`, () => {
    assert.ok(parseDSL(modify(source)).diagnostics.length > 0);
  });
it('外部JSONでも接続口・経路・囲み・ビューの意味を検証する', () => {
  for (const mutate of [
    (diagram: Diagram) => {
      diagram.connections[0]!.attributes.targetPort = 'missing';
    },
    (diagram: Diagram) => {
      diagram.connections[0]!.attributes.step = 3;
    },
    (diagram: Diagram) => {
      diagram.resources.find((resource) => resource.type === 'overlay')!.attributes.members = [];
    },
    (diagram: Diagram) => {
      diagram.views[0]!.kinds = ['unknown' as never];
    },
    (diagram: Diagram) => {
      diagram.resources[0]!.attributes.fixed = true;
    },
  ]) {
    const diagram = parsed();
    mutate(diagram);
    assert.throws(() => validateDiagram(diagram));
  }
});
it('固定座標の往復・親寸法の拡張・移動後の経路端点と障害物回避', async () => {
  const diagram = parseDSL(`diagram "pins" {
    group outer {
      external.node a x=24 y=100 fixed=true ports=[one,two]
      external.node b x=600 y=100 fixed=true
      external.node obstacle x=300 y=80 fixed=true
    }
    a -> b sourcePort=two
  }`).diagram!;
  validateDiagram(diagram);
  const graph = buildDisplayGraph(diagram);
  const layout = await layoutGraph(graph);
  const rectangles = absolutePlacements(layout.nodes);
  const a = rectangles.get('a')!,
    b = rectangles.get('b')!,
    obstacle = rectangles.get('obstacle')!;
  const route = layout.edges![0]!;
  assert.deepEqual(route.points[0], { x: a.x + a.width, y: a.y + (a.height * 2) / 3 });
  assert.deepEqual(route.points.at(-1), { x: b.x, y: b.y + b.height / 2 });
  for (let i = 1; i < route.points.length; i++) {
    const from = route.points[i - 1]!,
      to = route.points[i]!;
    assert.ok(from.x === to.x || from.y === to.y);
    const crossing =
      from.x === to.x
        ? from.x > obstacle.x &&
          from.x < obstacle.x + obstacle.width &&
          Math.max(from.y, to.y) > obstacle.y &&
          Math.min(from.y, to.y) < obstacle.y + obstacle.height
        : from.y > obstacle.y &&
          from.y < obstacle.y + obstacle.height &&
          Math.max(from.x, to.x) > obstacle.x &&
          Math.min(from.x, to.x) < obstacle.x + obstacle.width;
    assert.equal(crossing, false);
  }
  const restored = parseDSL(serializeDSL(diagram)).diagram!;
  const again = await layoutGraph(buildDisplayGraph(restored));
  assert.deepEqual(again.nodes, layout.nodes);
  assert.deepEqual(again.edges, layout.edges);
  const parent = layout.nodes.find((node) => node.id === 'outer')!;
  const child = layout.nodes.find((node) => node.id === 'b')!;
  assert.ok(parent.width >= child.x + child.width + 24);
});

it('固定済みのノードに追加しても位置を維持し、新しいノードは重ならない', async () => {
  const diagram = parseDSL(`diagram "stable" {
    external.node a x=24 y=24 fixed=true
    external.node b x=300 y=24 fixed=true
    external.node added
    a -> b
  }`).diagram!;
  const layout = await layoutGraph(buildDisplayGraph(diagram));
  const a = layout.nodes.find((node) => node.id === 'a')!,
    b = layout.nodes.find((node) => node.id === 'b')!,
    added = layout.nodes.find((node) => node.id === 'added')!;
  assert.deepEqual([a.x, a.y, b.x, b.y], [24, 24, 300, 24]);
  for (const fixed of [a, b])
    assert.ok(
      added.x >= fixed.x + fixed.width ||
        added.x + added.width <= fixed.x ||
        added.y >= fixed.y + fixed.height ||
        added.y + added.height <= fixed.y,
    );
});
it('固定配置でも同じ接続口の複数線を分離し、長いラベルを重ねない', async () => {
  const diagram = parseDSL(`diagram "parallel" {
    external.node a x=24 y=100 fixed=true ports=[nic]
    external.node b x=600 y=100 fixed=true ports=[nic]
    a -> b sourcePort=nic targetPort=nic label="通信経路を区別するための長いラベルその1"
    a -> b sourcePort=nic targetPort=nic label="通信経路を区別するための長いラベルその2"
  }`).diagram!;
  const layout = await layoutGraph(buildDisplayGraph(diagram));
  const [one, two] = layout.edges!;
  assert.notDeepEqual(one!.points, two!.points);
  assert.ok(
    Math.abs(one!.label!.y - two!.label!.y) >= 30 || Math.abs(one!.label!.x - two!.label!.x) >= 300,
  );
});
it('境界のヘッダー内への固定配置を拒否する', async () => {
  const diagram = parseDSL(`diagram "header" {
    group parent {
      external.node child x=24 y=24 fixed=true
    }
  }`).diagram!;
  await assert.rejects(layoutGraph(buildDisplayGraph(diagram)), /ヘッダー/);
});
it('直角線の交差だけを橋で示し、端点での合流を橋にしない', async () => {
  const { bridgePath } = await import('../src/core/geometry.js');
  const line = [
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ];
  assert.match(
    bridgePath(line, [
      [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
    ]),
    / Q /,
  );
  assert.doesNotMatch(
    bridgePath(line, [
      [
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ],
    ]),
    / Q /,
  );
});

it('配置APIでも不正な座標を計算前に拒否する', async () => {
  const graph = buildDisplayGraph(parsed());
  graph.resources[0]!.attributes.fixed = true;
  await assert.rejects(layoutGraph(graph), /x と y/);
  graph.resources[0]!.attributes.x = NaN;
  graph.resources[0]!.attributes.y = 0;
  await assert.rejects(layoutGraph(graph), /有限/);
});
