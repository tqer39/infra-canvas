import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDSL } from '../src/core/parser';
import { buildDisplayGraph, resolveDisplaySettings } from '../src/core/display';
import { createHistory, historyReducer } from '../src/viewer/history';

test('詳しさとSGは保存済みビューを変更せず独立に上書きできる', () => {
  const diagram = parseDSL(`diagram "表示設定" {
    account a {
      subnet s { aws.ec2 app securityGroups=[sg1] }
      sg sg1
    }
    view service level=resource
    view security level=resource overlay=sg
  }`).diagram!;
  assert.deepEqual(resolveDisplaySettings(diagram, { view: 'service' }), {
    level: 'resource',
    showSG: false,
  });
  const before = structuredClone(diagram);
  const collapsed = buildDisplayGraph(diagram, { view: 'service', level: 'service', showSG: true });
  assert.ok(collapsed.resources.some((resource) => resource.id === 'sg1'));
  assert.ok(!collapsed.resources.some((resource) => resource.id === 'app'));
  const hiddenSG = buildDisplayGraph(diagram, {
    view: 'security',
    level: 'resource',
    showSG: false,
  });
  assert.ok(hiddenSG.resources.some((resource) => resource.id === 'app'));
  assert.ok(!hiddenSG.resources.some((resource) => resource.id === 'sg1'));
  assert.deepEqual(diagram, before);
  const savedWithoutSG = { ...diagram, views: [{ id: 'security', level: 'resource' as const }] };
  assert.equal(resolveDisplaySettings(savedWithoutSG, { view: 'security' }).showSG, false);
});

test('詳しさとSGの変更をUndo/Redoで復元できる', () => {
  const start = createHistory({
    source: '',
    view: 'service',
    edgeShape: 'orthogonal',
    collapsed: [],
    expanded: [],
  });
  const detailed = historyReducer(start, {
    type: 'commit',
    update: (current) => ({ ...current, displayLevel: 'subnet' }),
  });
  const withSG = historyReducer(detailed, {
    type: 'commit',
    update: (current) => ({ ...current, showSG: true }),
  });
  const undone = historyReducer(withSG, { type: 'undo' });
  assert.equal(undone.present.displayLevel, 'subnet');
  assert.equal(undone.present.showSG, undefined);
  assert.deepEqual(historyReducer(undone, { type: 'redo' }), withSG);
  assert.deepEqual(historyReducer(undone, { type: 'undo' }).present, start.present);
});
