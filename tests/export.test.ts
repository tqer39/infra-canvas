import test from 'node:test';
import assert from 'node:assert/strict';
import { embedDiagram } from '../src/export.js';
import type { Diagram } from '../src/core/model.js';
for (const namespace of ['OMNODI', 'INFRA_CANVAS']) {
  test(`HTML 埋め込みは新旧テンプレートに対応し、script 終端をエスケープする (${namespace})`, () => {
    const diagram: Diagram = {
      version: 1,
      title: '</script><script>window.pwned=true</script>$&',
      resources: [],
      connections: [],
      views: [],
      diagnostics: [],
    };
    const output = embedDiagram(
      `<script>window.__${namespace}__=__${namespace}_MODEL__;</script>`,
      diagram,
    );
    assert.equal((output.match(/<script>/g) ?? []).length, 1);
    assert.ok(output.includes('\\u003c/script\\u003e'));
    assert.ok(output.includes('$\\u0026'));
    assert.ok(!output.includes(`__${namespace}_MODEL__`));
  });
}
