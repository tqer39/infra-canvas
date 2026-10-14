import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { DisplayGraph, Placement } from './model.js';

/** ソースの種類で選択し、サービス名・ID・リポジトリURLには依存しない。 */
export function compactRepositoryLayout(graph: DisplayGraph): boolean {
  return (
    graph.resources.some(
      (r) => r.provenance?.kind === 'static' || r.attributes.sourceKind === 'static',
    ) &&
    !graph.resources.some(
      (r) => r.attributes.fixed === true || r.attributes.columnsBy !== undefined,
    )
  );
}

/** 階層をまたぐ線は共通の親の直下へ投影して配置する。実際の線は別途全件を引き直す。 */
export function projectCompoundEdges(input: ElkNode, graph: DisplayGraph): void {
  const nodes = new Map<string, ElkNode>();
  const parents = new Map<string, string>();
  const collect = (node: ElkNode): void => {
    nodes.set(node.id, node);
    node.edges = [];
    node.layoutOptions = {
      ...input.layoutOptions,
      ...node.layoutOptions,
      'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
    };
    for (const child of node.children ?? []) {
      parents.set(child.id, node.id);
      collect(child);
    }
  };
  collect(input);
  const path = (id: string): string[] => {
    const chain = [id];
    while (parents.has(chain.at(-1)!)) chain.push(parents.get(chain.at(-1)!)!);
    return chain.reverse();
  };
  const pairs = new Set<string>();
  for (const edge of [...graph.connections].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    const a = path(edge.source),
      b = path(edge.target);
    let depth = 0;
    while (a[depth] === b[depth] && depth < Math.min(a.length, b.length)) depth++;
    // 自己接続や親子接続は階層の順位を決めないが、描画時には必ず残す。
    if (depth === 0 || depth === Math.min(a.length, b.length)) continue;
    const parent = a[depth - 1],
      source = a[depth],
      target = b[depth];
    const key = JSON.stringify([parent, source, target]);
    if (pairs.has(key)) continue;
    pairs.add(key);
    nodes.get(parent)!.edges!.push({ id: edge.id, sources: [source], targets: [target] });
  }
}

/** 階層内の相対配置を保ちながら、外側のグループを棚状に詰める。 */
export function packRepositoryRoots(nodes: Placement[], direction: 'RIGHT' | 'DOWN'): void {
  const roots = nodes.filter((n) => !n.parentId);
  if (roots.length < 2) return;
  const gap = 120;
  const ordered = [...roots].sort((a, b) =>
    direction === 'DOWN' ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y,
  );
  const area = roots.reduce((sum, n) => sum + (n.width + gap) * (n.height + gap), 0);
  const widest = Math.max(...roots.map((n) => n.width));
  const widths = [
    widest,
    Math.max(widest, Math.sqrt(area * 1.3)),
    Math.max(widest, Math.sqrt(area * 1.8)),
  ];
  const candidates = widths.map((limit) => {
    let x = 24,
      y = 24,
      rowHeight = 0,
      width = 0;
    const positions = ordered.map((node) => {
      if (x > 24 && x + node.width > limit + 24) {
        x = 24;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      const position = { node, x, y };
      x += node.width + gap;
      rowHeight = Math.max(rowHeight, node.height);
      width = Math.max(width, x - gap);
      return position;
    });
    const height = y + rowHeight + 24;
    return { positions, score: Math.max(width / 1200, height / 1000) };
  });
  const best = candidates.sort((a, b) => a.score - b.score)[0];
  for (const { node, x, y } of best.positions) {
    node.x = x;
    node.y = y;
  }
}
