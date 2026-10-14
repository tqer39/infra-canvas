import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseDSL,
  validateDiagram,
  serializeDSL,
  buildDisplayGraph,
  layoutGraph,
} from '../src/core/index.js';

const samples = ['gcp-web', 'gcp-analytics', 'azure-web', 'azure-functions'];
const read = (name: string) => {
  const parsed = parseDSL(readFileSync(`examples/${name}.infra`, 'utf8'));
  assert.deepEqual(parsed.diagnostics, [], name);
  return validateDiagram(parsed.diagram);
};

for (const name of samples) {
  test(`${name}: DSL往復・全ビュー配置・折りたたみ復元`, async () => {
    const diagram = read(name);
    const restored = validateDiagram(parseDSL(serializeDSL(diagram)).diagram);
    assert.deepEqual(
      restored.resources.map(({ id, type, parentId, attributes }) => ({
        id,
        type,
        parentId,
        attributes,
      })),
      diagram.resources.map(({ id, type, parentId, attributes }) => ({
        id,
        type,
        parentId,
        attributes,
      })),
    );
    assert.deepEqual(
      restored.connections.map(({ source, target, kind, attributes }) => ({
        source,
        target,
        kind,
        attributes,
      })),
      diagram.connections.map(({ source, target, kind, attributes }) => ({
        source,
        target,
        kind,
        attributes,
      })),
    );
    for (const view of diagram.views) {
      const graph = buildDisplayGraph(diagram, { view: view.id });
      const layout = await layoutGraph(graph);
      assert.equal(layout.nodes.length, graph.resources.length);
      assert.equal(layout.edges!.length, graph.connections.length);
      for (const node of layout.nodes) {
        assert.ok([node.x, node.y, node.width, node.height].every(Number.isFinite));
        if (node.parentId) {
          const parent = layout.nodes.find((candidate) => candidate.id === node.parentId)!;
          assert.ok(node.x >= 0 && node.y >= 0);
          assert.ok(node.x + node.width <= parent.width + 1);
          assert.ok(node.y + node.height <= parent.height + 1);
        }
      }
    }
    const folded = buildDisplayGraph(diagram, { view: 'overview' });
    const full = buildDisplayGraph(diagram, { view: 'service' });
    assert.ok(folded.resources.length < full.resources.length);
    const reopened = buildDisplayGraph(diagram, {
      view: 'overview',
      expanded: diagram.resources.map(({ id }) => id),
    });
    assert.deepEqual(reopened.connections, full.connections);
  });
}

test('Azure Functions: トリガーとデータ読み取りを区別し、ホスト用Storageを保持', () => {
  const diagram = read('azure-functions');
  assert.ok(
    diagram.connections.some(
      (edge) =>
        edge.source === 'incoming' && edge.target === 'resize' && edge.kind === 'association',
    ),
  );
  assert.ok(
    diagram.connections.some(
      (edge) => edge.source === 'resize' && edge.target === 'incoming' && edge.kind === 'traffic',
    ),
  );
  assert.ok(
    diagram.connections.some(
      (edge) => edge.source === 'resize' && edge.target === 'host' && edge.kind === 'dependency',
    ),
  );
});
