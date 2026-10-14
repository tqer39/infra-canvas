import { it } from 'node:test';
import assert from 'node:assert/strict';
import { curvedRoutePath, nearestPathPoint } from '../src/core/geometry.js';

it('一直線に配置した端点でも、曲線の中央は直線から離れる', () => {
  const path = curvedRoutePath(
    [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
    ],
    [],
  );
  const near = nearestPathPoint(path, { x: 200, y: 48 })!;
  assert.ok(Math.abs(near.x - 200) < 3);
  assert.ok(near.y > 40);
});
it('直線の間にカードがある場合も曲線をカードの外側へ迂回させる', () => {
  const path = curvedRoutePath(
    [
      { x: 0, y: 100 },
      { x: 400, y: 100 },
    ],
    [{ x: 140, y: 60, width: 120, height: 80 }],
  );
  const near = nearestPathPoint(path, { x: 200, y: 100 })!;
  assert.ok(near.y > 141 || near.y < 59);
});
it('同じ端点の並行通信を異なる曲線として表す', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
  ];
  const a = nearestPathPoint(curvedRoutePath(points, [], -32), { x: 200, y: -24 })!;
  const b = nearestPathPoint(curvedRoutePath(points, [], 32), { x: 200, y: 24 })!;
  assert.ok(a.y < 0 && b.y > 0);
});

it('縦に離れた近い端点でも、横方向へ過剰に膨らませない', () => {
  const path = curvedRoutePath(
    [
      { x: 0, y: 600 },
      { x: 40, y: 600 },
      { x: 40, y: 0 },
      { x: 66, y: 0 },
    ],
    [],
  );
  const farthest = nearestPathPoint(path, { x: 200, y: 500 })!;
  assert.ok(farthest.x <= 66);
});
