import test from 'node:test';
import assert from 'node:assert/strict';
import { embedDiagram } from '../src/export.js';
import type { Diagram } from '../src/core/model.js';
test('HTML 埋め込みでは DSL の文字列を script 終端に変換しない', () => {
  const diagram: Diagram = {
    version: 1,
    title: '</script><script>window.pwned=true</script>$&',
    resources: [],
    connections: [],
    views: [],
    diagnostics: [],
  };
  const output = embedDiagram(
    '<script>window.__INFRA_CANVAS__=__INFRA_CANVAS_MODEL__;</script>',
    diagram,
  );
  assert.equal((output.match(/<script>/g) ?? []).length, 1);
  assert.ok(output.includes('\\u003c/script\\u003e'));
  assert.ok(output.includes('$\\u0026'));
});
