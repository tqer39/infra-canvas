import type { Connection, DisplayGraph, EdgeRoute, LayoutResult, Placement } from './model.js';

type Point = { x: number; y: number };
export function absolutePlacements(nodes: Placement[]): Map<string, Placement> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result = new Map<string, Placement>();
  const resolve = (node: Placement): Placement => {
    const found = result.get(node.id);
    if (found) return found;
    const parent = node.parentId ? resolve(byId.get(node.parentId)!) : undefined;
    const absolute = { ...node, x: node.x + (parent?.x ?? 0), y: node.y + (parent?.y ?? 0) };
    result.set(node.id, absolute);
    return absolute;
  };
  nodes.forEach(resolve);
  return result;
}

const intersects = (a: Point, b: Point, rect: Placement): boolean =>
  a.x === b.x
    ? a.x > rect.x &&
      a.x < rect.x + rect.width &&
      Math.max(a.y, b.y) > rect.y &&
      Math.min(a.y, b.y) < rect.y + rect.height
    : a.y > rect.y &&
      a.y < rect.y + rect.height &&
      Math.max(a.x, b.x) > rect.x &&
      Math.min(a.x, b.x) < rect.x + rect.width;

/** 移動後の直角経路。障害物の外周座標を使い、最短距離で探索する。 */
function orthogonal(start: Point, end: Point, obstacles: Placement[]): Point[] {
  const xs = [
    ...new Set([
      start.x,
      end.x,
      ...obstacles.flatMap((rect) => [rect.x - 12, rect.x + rect.width + 12]),
    ]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      start.y,
      end.y,
      ...obstacles.flatMap((rect) => [rect.y - 12, rect.y + rect.height + 12]),
    ]),
  ].sort((a, b) => a - b);
  const startId = ys.indexOf(start.y) * xs.length + xs.indexOf(start.x);
  const endId = ys.indexOf(end.y) * xs.length + xs.indexOf(end.x);
  const point = (id: number): Point => ({
    x: xs[id % xs.length]!,
    y: ys[Math.floor(id / xs.length)]!,
  });
  const costs = new Map<number, number>([[startId, 0]]);
  const previous = new Map<number, number>();
  const queue: { id: number; score: number }[] = [{ id: startId, score: 0 }];
  const done = new Set<number>();
  while (queue.length) {
    queue.sort((a, b) => b.score - a.score);
    const { id } = queue.pop()!;
    if (done.has(id)) continue;
    if (id === endId) {
      const route = [point(id)];
      let current = id;
      while (previous.has(current)) {
        current = previous.get(current)!;
        route.unshift(point(current));
      }
      return route.filter(
        (p, index) =>
          index === 0 ||
          index === route.length - 1 ||
          !(
            (route[index - 1]!.x === p.x && route[index + 1]!.x === p.x) ||
            (route[index - 1]!.y === p.y && route[index + 1]!.y === p.y)
          ),
      );
    }
    done.add(id);
    const x = id % xs.length,
      y = Math.floor(id / xs.length);
    const neighbors = [
      x > 0 ? id - 1 : -1,
      x + 1 < xs.length ? id + 1 : -1,
      y > 0 ? id - xs.length : -1,
      y + 1 < ys.length ? id + xs.length : -1,
    ];
    const a = point(id);
    for (const next of neighbors) {
      if (next < 0 || done.has(next)) continue;
      const b = point(next);
      if (obstacles.some((rect) => intersects(a, b, rect))) continue;
      const cost = costs.get(id)! + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost);
      previous.set(next, id);
      queue.push({ id: next, score: cost + Math.abs(b.x - end.x) + Math.abs(b.y - end.y) });
    }
  }
  throw new Error('固定配置の接続経路を確保できません。重なったノードを移動してください。');
}

export function portFraction(graph: DisplayGraph, id: string, port: unknown): number {
  const ports = graph.resources.find((resource) => resource.id === id)?.attributes.ports as
    | string[]
    | undefined;
  return typeof port === 'string' && ports?.includes(port)
    ? (ports.indexOf(port) + 1) / (ports.length + 1)
    : 0.5;
}

export function applyFixedLayout(
  graph: DisplayGraph,
  layout: LayoutResult,
  forceReroute = false,
): LayoutResult {
  const resources = new Map(graph.resources.map((resource) => [resource.id, resource]));
  const nodes = layout.nodes.map((node) => {
    const attrs = resources.get(node.id)!.attributes;
    return attrs.fixed === true ? { ...node, x: Number(attrs.x), y: Number(attrs.y) } : { ...node };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (
      node.parentId &&
      resources.get(node.id)?.attributes.fixed === true &&
      node.y < (byId.get(node.parentId)?.contentTop ?? 56)
    )
      throw new Error(
        `${node.id}: 固定位置が親境界のヘッダーと重なっています。y を大きくしてください。`,
      );
  }
  // 新しい未固定ノードを既存の固定ノードから離す。固定した実体は動かさない。
  const placed = nodes.filter((node) => resources.get(node.id)?.attributes.fixed === true);
  for (const node of nodes.filter(
    (node) => placed.length > 0 && resources.get(node.id)?.attributes.fixed !== true,
  )) {
    const siblings = placed.filter((other) => other.parentId === node.parentId);
    let collision = siblings.find(
      (other) =>
        node.x < other.x + other.width + 24 &&
        node.x + node.width + 24 > other.x &&
        node.y < other.y + other.height + 24 &&
        node.y + node.height + 24 > other.y,
    );
    while (collision) {
      node.x = collision.x + collision.width + 44;
      collision = siblings.find(
        (other) =>
          node.x < other.x + other.width + 24 &&
          node.x + node.width + 24 > other.x &&
          node.y < other.y + other.height + 24 &&
          node.y + node.height + 24 > other.y,
      );
    }
    placed.push(node);
  }
  // 子から親へ必要寸法を伝播する。上端は元のヘッダーを保持する。
  for (const node of [...nodes].reverse()) {
    if (!node.parentId) continue;
    const parent = byId.get(node.parentId)!;
    parent.width = Math.max(parent.width, node.x + node.width + 24);
    parent.height = Math.max(parent.height, node.y + node.height + 24);
  }
  const rectangles = absolutePlacements(nodes);
  const before = absolutePlacements(layout.nodes);
  const changed =
    forceReroute ||
    graph.connections.some(
      (edge) =>
        edge.attributes.sourcePort !== undefined || edge.attributes.targetPort !== undefined,
    ) ||
    nodes.some((node) => {
      const a = before.get(node.id)!,
        b = rectangles.get(node.id)!;
      return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;
    });
  const ancestor = (id: string, child: string): boolean => {
    let parent = byId.get(child)?.parentId;
    while (parent) {
      if (parent === id) return true;
      parent = byId.get(parent)?.parentId;
    }
    return false;
  };
  const routes = new Map(layout.edges?.map((edge) => [edge.id, edge]));
  const edges: EdgeRoute[] = graph.connections.map((edge: Connection) => {
    if (!changed)
      return { ...routes.get(edge.id)!, points: [...(routes.get(edge.id)?.points ?? [])] };
    const source = rectangles.get(edge.source)!,
      target = rectangles.get(edge.target)!;
    const start = {
      x: source.x + source.width,
      y: source.y + source.height * portFraction(graph, edge.source, edge.attributes.sourcePort),
    };
    const end = {
      x: target.x,
      y: target.y + target.height * portFraction(graph, edge.target, edge.attributes.targetPort),
    };
    const obstacles = [...rectangles.values()].filter(
      (rect) =>
        rect.id !== source.id &&
        rect.id !== target.id &&
        !ancestor(rect.id, source.id) &&
        !ancestor(rect.id, target.id),
    );
    // 出入りの短い区間以外では端点自身も障害物として扱う。
    const a = { x: start.x + 16, y: start.y },
      b = { x: end.x - 16, y: end.y };
    const endpoints = [source, target].filter(
      (rect) => !ancestor(rect.id, source.id) && !ancestor(rect.id, target.id),
    );
    const parallel = graph.connections
      .filter(
        (other) =>
          other.source === edge.source &&
          other.target === edge.target &&
          other.attributes.sourcePort === edge.attributes.sourcePort &&
          other.attributes.targetPort === edge.attributes.targetPort,
      )
      .sort((a, b) => a.id.localeCompare(b.id, 'en'));
    const index = parallel.findIndex((other) => other.id === edge.id);
    const routingObstacles = [...obstacles, ...endpoints];
    let middle: Point[];
    if (parallel.length > 1) {
      const lane =
        Math.min(start.y, end.y, ...routingObstacles.map((rect) => rect.y)) - 32 * (index + 1);
      const waypoint = { x: a.x, y: lane };
      const far = { x: b.x, y: lane };
      middle = [
        ...orthogonal(a, waypoint, routingObstacles),
        far,
        ...orthogonal(far, b, routingObstacles).slice(1),
      ];
    } else middle = orthogonal(a, b, routingObstacles);
    const points = [start, ...middle, end];
    const segment = points
      .slice(1)
      .map((p, index) => ({
        a: points[index]!,
        b: p,
        length: Math.abs(p.x - points[index]!.x) + Math.abs(p.y - points[index]!.y),
      }))
      .sort((a, b) => b.length - a.length)[0]!;
    return {
      id: edge.id,
      points,
      label: { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 },
    };
  });
  const overlays = graph.overlays?.map((resource) => {
    const members = resource.attributes.members as string[];
    const boxes = members.map((id) => rectangles.get(id)!).filter(Boolean);
    const x = Math.min(...boxes.map((box) => box.x)) - 18,
      y = Math.min(...boxes.map((box) => box.y)) - 38;
    return {
      id: resource.id,
      label: resource.label,
      members,
      x,
      y,
      width: Math.max(...boxes.map((box) => box.x + box.width)) - x + 18,
      height: Math.max(...boxes.map((box) => box.y + box.height)) - y + 18,
    };
  });
  return { ...layout, nodes, edges, overlays };
}

/** 接続しない直角線の交差には小さな橋を描き、合流と区別する。 */
export function bridgePath(points: Point[], otherRoutes: Point[][]): string {
  if (!points.length) return '';
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!,
      b = points[index]!;
    const horizontal = a.y === b.y;
    const start = horizontal ? a.x : a.y,
      end = horizontal ? b.x : b.y;
    const direction = Math.sign(end - start);
    const crossings = new Set<number>();
    for (const route of otherRoutes)
      for (let j = 1; j < route.length; j++) {
        const c = route[j - 1]!,
          d = route[j]!;
        if (
          horizontal &&
          c.x === d.x &&
          a.y > Math.min(c.y, d.y) &&
          a.y < Math.max(c.y, d.y) &&
          c.x > Math.min(start, end) + 8 &&
          c.x < Math.max(start, end) - 8
        )
          crossings.add(c.x);
        if (
          !horizontal &&
          c.y === d.y &&
          a.x > Math.min(c.x, d.x) &&
          a.x < Math.max(c.x, d.x) &&
          c.y > Math.min(start, end) + 8 &&
          c.y < Math.max(start, end) - 8
        )
          crossings.add(c.y);
      }
    let last = start;
    for (const crossing of [...crossings].sort((x, y) => direction * (x - y))) {
      if (Math.abs(crossing - last) < 14) continue;
      path += horizontal
        ? ` L ${crossing - direction * 5} ${a.y} Q ${crossing} ${a.y - 9} ${crossing + direction * 5} ${a.y}`
        : ` L ${a.x} ${crossing - direction * 5} Q ${a.x + 9} ${crossing} ${a.x} ${crossing + direction * 5}`;
      last = crossing;
    }
    path += ` L ${b.x} ${b.y}`;
  }
  return path;
}

/** ラベル矩形の重なりを避ける。経路上の候補を優先し、必要なら引き出し線を使う。 */
export function separateLabels(
  edges: EdgeRoute[],
  dimensions: Map<string, { width: number; height: number }>,
  nodes: Placement[],
): void {
  const occupied: Placement[] = [];
  const rectangles = [...absolutePlacements(nodes).values()];
  for (const edge of edges) {
    if (!edge.label) continue;
    const size = dimensions.get(edge.id)!;
    const origin = edge.label;
    const candidates = [
      origin,
      ...edge.points.slice(1).flatMap((b, index) => {
        const a = edge.points[index]!;
        return [0.25, 0.5, 0.75].map((t) => ({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
        }));
      }),
    ];
    const overlaps = (point: Point): boolean => {
      const box = {
        x: point.x - size.width / 2 - 4,
        y: point.y - size.height / 2 - 4,
        width: size.width + 8,
        height: size.height + 8,
      };
      return [
        ...occupied,
        ...rectangles.filter((rect) => !nodes.some((node) => node.parentId === rect.id)),
      ].some(
        (rect) =>
          box.x < rect.x + rect.width &&
          box.x + box.width > rect.x &&
          box.y < rect.y + rect.height &&
          box.y + box.height > rect.y,
      );
    };
    let chosen = candidates.find((p) => !overlaps(p));
    if (!chosen) {
      for (let distance = 32; !chosen && distance <= 4096; distance += 32)
        chosen = [
          { x: origin.x, y: origin.y - distance },
          { x: origin.x, y: origin.y + distance },
        ].find((p) => !overlaps(p));
    }
    chosen ??= {
      x: origin.x,
      y:
        Math.min(origin.y, ...occupied.map((rect) => rect.y), ...rectangles.map((rect) => rect.y)) -
        size.height -
        16,
    };
    if (chosen.x !== origin.x || chosen.y !== origin.y) edge.labelAnchor = origin;
    edge.label = chosen;
    occupied.push({
      id: edge.id,
      x: chosen.x - size.width / 2,
      y: chosen.y - size.height / 2,
      ...size,
    });
  }
}

/** カードを避けた経路を維持して、各曲がり角だけを丸める。 */
export function roundedRoutePath(points: Point[], radius = 10): string {
  if (points.length < 2) return '';
  const first = points[0]!;
  let path = `M ${first.x},${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!,
      b = points[i]!,
      c = points[i + 1]!;
    const before = Math.hypot(b.x - a.x, b.y - a.y);
    const after = Math.hypot(c.x - b.x, c.y - b.y);
    if (!before || !after) continue;
    const r = Math.min(radius, before / 2, after / 2);
    const start = { x: b.x + ((a.x - b.x) * r) / before, y: b.y + ((a.y - b.y) * r) / before };
    const end = { x: b.x + ((c.x - b.x) * r) / after, y: b.y + ((c.y - b.y) * r) / after };
    path += ` L ${start.x},${start.y} C ${b.x},${b.y} ${b.x},${b.y} ${end.x},${end.y}`;
  }
  const last = points[points.length - 1]!;
  return path + ` C ${last.x},${last.y} ${last.x},${last.y} ${last.x},${last.y}`;
}

type Rectangle = { x: number; y: number; width: number; height: number };
/** このモジュールで生成したM/L/C経路を、描画距離約2pxごとに検査する。 */
function pathSamples(path: string): Point[] {
  const tokens = path.match(/[MLC]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? [];
  let index = 0,
    current = { x: 0, y: 0 };
  const samples: Point[] = [];
  const point = (): Point => ({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') {
      current = point();
      samples.push(current);
      continue;
    }
    const a = current;
    const b = point();
    const c = command === 'C' ? point() : b;
    const d = command === 'C' ? point() : b;
    const count = Math.max(
      1,
      Math.ceil(
        (Math.hypot(b.x - a.x, b.y - a.y) +
          Math.hypot(c.x - b.x, c.y - b.y) +
          Math.hypot(d.x - c.x, d.y - c.y)) /
          2,
      ),
    );
    for (let n = 1; n <= count; n++) {
      const t = n / count,
        u = 1 - t;
      samples.push(
        command === 'C'
          ? {
              x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
              y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
            }
          : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      );
    }
    current = d;
  }
  return samples;
}

/** まずベジェ曲線を使い、カードを横切る場合は曲がり方・迂回経路を変える。 */
export function curvedRoutePath(points: Point[], obstacles: Rectangle[], offset = 0): string {
  if (points.length < 2) return '';
  const start = points[0]!,
    end = points[points.length - 1]!;
  const direction = (a: Point, b: Point): Point => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  };
  const source = direction(start, points[1]!);
  const target = direction(points[points.length - 2]!, end);
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const controlDistance = (direction: Point): number =>
    Math.max(
      40,
      (Math.abs((end.x - start.x) * direction.x) + Math.abs((end.y - start.y) * direction.y)) / 2,
    );
  const sourceDistance = controlDistance(source),
    targetDistance = controlDistance(target);
  const aligned = start.x === end.x || start.y === end.y;
  const initial = offset || (aligned ? 64 : 0);
  const clear = (path: string): boolean =>
    !pathSamples(path).some((p) =>
      obstacles.some(
        (rect) =>
          p.x > rect.x - 1 &&
          p.x < rect.x + rect.width + 1 &&
          p.y > rect.y - 1 &&
          p.y < rect.y + rect.height + 1,
      ),
    );
  for (const bow of [
    initial,
    initial + 96,
    initial - 96,
    initial + 192,
    initial - 192,
    initial + 320,
    initial - 320,
  ]) {
    const dx = horizontal ? 0 : bow,
      dy = horizontal ? bow : 0;
    const path = `M ${start.x},${start.y} C ${start.x + source.x * sourceDistance + dx},${start.y + source.y * sourceDistance + dy} ${end.x - target.x * targetDistance + dx},${end.y - target.y * targetDistance + dy} ${end.x},${end.y}`;
    if (clear(path)) return path;
  }
  for (const radius of [64, 32, 16, 8]) {
    const path = roundedRoutePath(points, radius);
    if (clear(path)) return path;
  }
  return roundedRoutePath(points, 0);
}

export function nearestPathPoint(path: string, point: Point): Point | undefined {
  let nearest: Point | undefined,
    distance = Infinity;
  for (const sample of pathSamples(path)) {
    const next = Math.hypot(sample.x - point.x, sample.y - point.y);
    if (next < distance) {
      nearest = sample;
      distance = next;
    }
  }
  return nearest;
}
