import { it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDSL, validateDiagram, buildDisplayGraph, layoutGraph } from '../src/core/index.js';
import { absolutePlacements } from '../src/core/geometry.js';

const source = `diagram "Generic source architecture" {
 group p "Configuration provider" sourceKind=static {
  external.service a "Secret store with a long descriptive name" sourceKind=static
 }
 group q "Build provider" sourceKind=static {
  group inner "Automation" sourceKind=static {
   external.service b "Build and release service" sourceKind=static
  }
 }
 group r "Runtime provider" sourceKind=static {
  external.service c "Application runtime" sourceKind=static
  external.service d "Persistent database" sourceKind=static
  external.service e "Asynchronous queue" sourceKind=static
 }
 group s "Notification provider" sourceKind=static {
  external.service f "Notification receiver" sourceKind=static
 }
 group isolated "Unconnected configuration" sourceKind=static {
  external.service other "Configuration only" sourceKind=static
 }
 a -> b id=supply label="Supply credentials" kind=auth
 b -> c id=deploy label="Deploy application" kind=deploy
 b -> f id=notify label="Report result" kind=dependency
 a -> c id=sync label="Synchronize secrets via automation" kind=dependency
 c -> d id=database label="Conditional database connection" kind=dependency
 c -> e id=queue label="Queue binding" kind=association
 c -> d id=replica label="Separate replication relation" kind=replication
 view service level=resource
}`;
it('階層をまたぐ線・並行接続・孤立グループを省略せず、境界内と全体を詰める', async () => {
  const diagram = validateDiagram(parseDSL(source).diagram);
  for (const direction of ['RIGHT', 'DOWN'] as const) {
    const graph = buildDisplayGraph(diagram, { view: 'service' });
    const sourceGraph = JSON.stringify(graph);
    const layout = await layoutGraph(graph, { direction });
    assert.equal(JSON.stringify(graph), sourceGraph, '名称・根拠・接続の元データは変更しない');
    assert.equal(layout.compact, true);
    assert.deepEqual(
      layout.edges!.map((e) => e.id).sort(),
      diagram.connections.map((e) => e.id).sort(),
    );
    assert.equal(layout.nodes.length, diagram.resources.length);
    const absolute = absolutePlacements(layout.nodes);
    for (const node of layout.nodes) {
      assert.equal(node.parentId, diagram.resources.find((r) => r.id === node.id)!.parentId);
      if (node.parentId) {
        const parent = layout.nodes.find((r) => r.id === node.parentId)!;
        assert.ok(node.x >= 0 && node.y >= parent.contentTop!);
        assert.ok(node.x + node.width <= parent.width && node.y + node.height <= parent.height);
      }
    }
    for (const edge of diagram.connections) {
      const route = layout.edges!.find((r) => r.id === edge.id)!;
      assert.ok(route.points.length >= 2);
      const start = absolute.get(edge.source)!,
        end = absolute.get(edge.target)!;
      assert.equal(route.points[0].x, start.x + start.width);
      assert.equal(route.points.at(-1)!.x, end.x);
    }
    const roots = layout.nodes.filter((n) => !n.parentId);
    assert.ok(Math.max(...roots.map((n) => n.x + n.width)) < 1900);
    assert.ok(Math.max(...roots.map((n) => n.y + n.height)) < 1800);
    const reversed = {
      ...graph,
      resources: [...graph.resources].reverse(),
      connections: [...graph.connections].reverse(),
    };
    const again = await layoutGraph(reversed, { direction });
    assert.deepEqual(again.nodes, layout.nodes);
    assert.deepEqual(again.edges, layout.edges);
  }
});
it('固定配置は保持し、サイクル・自己接続・親子接続にも全件の経路を作る', async () => {
  const diagram = validateDiagram(
    parseDSL(
      source.replace(
        'view service',
        'd -> c id=cycle\n c -> c id=self\n q -> b id=parent\n view service',
      ),
    ).diagram,
  );
  const graph = buildDisplayGraph(diagram, { view: 'service' });
  const layout = await layoutGraph(graph);
  assert.equal(layout.edges!.length, 10);
  assert.ok(
    layout.edges!.every(
      (e) =>
        e.points.length >= 2 && e.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    ),
  );
  const root = graph.resources.find((r) => r.id === 'p')!;
  Object.assign(root.attributes, { fixed: true, x: 123, y: 456 });
  const fixed = await layoutGraph(graph);
  assert.equal(fixed.compact, false);
  assert.equal(fixed.nodes.find((n) => n.id === root.id)!.x, 123);
  assert.equal(fixed.nodes.find((n) => n.id === root.id)!.y, 456);
});
