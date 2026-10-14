import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistory,
  historyLimit,
  historyReducer,
  type ViewerState,
} from '../src/viewer/history';
import { parseDSL } from '../src/core/parser';

const initial: ViewerState = {
  source: 'initial',
  view: 'service',
  edgeShape: 'orthogonal',
  collapsed: [],
  expanded: [],
};

test('Undo/Redo は図、DSL、境界、詳細範囲をまとめて復元し、過去の状態を変更しない', () => {
  const diagram = parseDSL('diagram "変更後" { aws.ec2 app }').diagram;
  assert.ok(diagram);
  const start = createHistory(initial);
  const changed = historyReducer(start, {
    type: 'commit',
    update: (current) => ({
      ...current,
      diagram,
      source: 'changed',
      collapsed: ['account'],
      expanded: ['vpc'],
      scope: 'vpc',
    }),
  });
  assert.deepEqual(start, createHistory(initial));
  const undone = historyReducer(changed, { type: 'undo' });
  assert.equal(undone.present, initial);
  const redone = historyReducer(undone, { type: 'redo' });
  assert.deepEqual(redone, changed);
});

test('履歴の端では状態を変えず、同じ操作では Redo を失わない', () => {
  const start = createHistory(initial);
  assert.equal(historyReducer(start, { type: 'undo' }), start);
  assert.equal(historyReducer(start, { type: 'redo' }), start);
  const changed = historyReducer(start, {
    type: 'commit',
    update: (current) => ({ ...current, view: 'network' }),
  });
  const undone = historyReducer(changed, { type: 'undo' });
  assert.equal(
    historyReducer(undone, {
      type: 'commit',
      update: (current) => ({ ...current, collapsed: [] }),
    }),
    undone,
  );
  const branched = historyReducer(undone, {
    type: 'commit',
    update: (current) => ({ ...current, edgeShape: 'bezier' }),
  });
  assert.equal(branched.future.length, 0);
  assert.equal(historyReducer(branched, { type: 'redo' }), branched);
});

test('同じ図と境界集合の再反映は履歴を増やさない', () => {
  const diagram = parseDSL('diagram "図" { aws.ec2 app }').diagram;
  assert.ok(diagram);
  const start = createHistory({ ...initial, diagram, expanded: ['a', 'b'] });
  assert.equal(
    historyReducer(start, {
      type: 'commit',
      update: (current) => ({
        ...current,
        diagram: {
          ...structuredClone(diagram),
          resources: diagram.resources.map((resource) => ({
            ...resource,
            location: { line: 99, column: 1 },
          })),
        },
        expanded: ['b', 'a'],
      }),
    }),
    start,
  );
});

test('履歴は100操作に制限し、その範囲をすべて Undo/Redo できる', () => {
  let history = createHistory(initial);
  for (let i = 0; i < historyLimit + 5; i++) {
    history = historyReducer(history, {
      type: 'commit',
      update: (current) => ({ ...current, source: String(i) }),
    });
  }
  assert.equal(history.past.length, historyLimit);
  for (let i = 0; i < historyLimit; i++) history = historyReducer(history, { type: 'undo' });
  assert.equal(history.present.source, '4');
  assert.equal(history.future.length, historyLimit);
  for (let i = 0; i < historyLimit; i++) history = historyReducer(history, { type: 'redo' });
  assert.equal(history.present.source, String(historyLimit + 4));
  assert.equal(history.past.length, historyLimit);
});
