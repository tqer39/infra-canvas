import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDSL,
  serializeDSL,
  validateDiagram,
  buildDisplayGraph,
  layoutGraph,
} from '../src/core/index.js';

test('監視データの種類を往復し、折りたたみでもメトリクスとログを別接続で保持する', () => {
  const parsed = parseDSL(readFileSync('examples/observability.infra', 'utf8'));
  assert.ok(parsed.diagram, JSON.stringify(parsed.diagnostics));
  const diagram = validateDiagram(parsed.diagram);
  const restored = validateDiagram(parseDSL(serializeDSL(diagram)).diagram);
  assert.deepEqual(
    restored.connections.map((e) => e.attributes),
    diagram.connections.map((e) => e.attributes),
  );
  for (const collapsed of [[], ['cluster']]) {
    const graph = buildDisplayGraph(restored, { collapsed });
    assert.equal(graph.connections.length, 4);
    const exports = graph.connections.filter((e) => e.target === 'datadog');
    assert.deepEqual(
      exports.map((e) => e.attributes.signals),
      [['metrics'], ['logs']],
    );
    assert.equal(
      graph.connections.find((e) => e.target === 'collector')!.source,
      collapsed.length ? 'cluster' : 'api',
    );
    assert.ok(graph.connections.every((e) => e.originalIds.length === 1));
  }
  for (const value of ['[]', '[unknown]', 'logs', '[1]']) {
    assert.equal(
      parseDSL(`diagram "invalid" {\naws.ecs a\nsaas.datadog b\na -> b signals=${value}\n}`)
        .diagram,
      undefined,
    );
  }
  for (const value of [[], ['unknown'], 'logs', [1]]) {
    const json = structuredClone(diagram);
    json.connections[0]!.attributes.signals = value as string[];
    assert.throws(() => validateDiagram(json));
  }
});
test('監視データの長い接続ラベルの幅を配置に含める', async () => {
  const plain = parseDSL(
    'diagram "labels" {\naws.ecs api\nsaas.newrelic monitor\napi -> monitor protocol=https port=443\n}',
  ).diagram!;
  const telemetry = structuredClone(plain);
  telemetry.connections[0]!.attributes.signals = ['metrics', 'logs', 'traces'];
  const a = await layoutGraph(buildDisplayGraph(plain));
  const b = await layoutGraph(buildDisplayGraph(telemetry));
  const gap = (layout: typeof a) =>
    Math.abs(
      layout.nodes.find((n) => n.id === 'monitor')!.x - layout.nodes.find((n) => n.id === 'api')!.x,
    );
  assert.ok(gap(b) > gap(a));
});
