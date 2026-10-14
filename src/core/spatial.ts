import { absolutePlacements } from './geometry.js';
import { annotationHeight } from './presentation.js';
import type { DisplayGraph, LayoutResult, Placement } from './model.js';

/** 明示した境界の直属の子だけをAZ・リージョン列へ並べる。固定座標を優先する。 */
export function applyColumnLayout(
  graph: DisplayGraph,
  layout: LayoutResult,
  direction: 'RIGHT' | 'DOWN' = 'RIGHT',
): boolean {
  const resources = new Map(graph.resources.map((resource) => [resource.id, resource]));
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
  let changed = false;
  for (const parent of [...layout.nodes].reverse()) {
    const field = resources.get(parent.id)?.attributes.columnsBy;
    const children = layout.nodes.filter((node) => node.parentId === parent.id);
    if (
      (field !== 'az' && field !== 'region') ||
      !children.length ||
      children.some((node) => resources.get(node.id)?.attributes.fixed === true)
    )
      continue;
    const groups = new Map<string, Placement[]>();
    for (const child of children) {
      const resource = resources.get(child.id)!;
      const key = String(
        resource.attributes[field] ??
          (field === 'az' ? resource.attributes.availability_zone : undefined) ??
          '共有・未指定',
      );
      const members = groups.get(key) ?? [];
      members.push(child);
      groups.set(key, members);
    }
    const vertical = field === 'az' && direction === 'RIGHT';
    let offset = vertical ? (parent.contentTop ?? 56) : 24;
    for (const [key, members] of [...groups.entries()].sort(([a], [b]) =>
      a.localeCompare(b, 'en'),
    )) {
      if (vertical && key === '共有・未指定' && groups.size > 1) {
        const azNodes = children.filter((child) => !members.includes(child));
        const sharedX = Math.max(...azNodes.map((child) => child.x + child.width)) + 64;
        let y = parent.contentTop ?? 56;
        for (const child of members.sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
          child.x = sharedX;
          child.y = y;
          y += child.height + 44;
        }
        continue;
      }
      let inner = vertical ? 24 : (parent.contentTop ?? 56);
      const extent = Math.max(...members.map((node) => (vertical ? node.height : node.width)));
      for (const child of members.sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
        child.x = vertical ? inner : offset;
        child.y = vertical ? offset : inner;
        inner += (vertical ? child.width : child.height) + 44;
      }
      offset += extent + 64;
    }
    parent.width = Math.max(240, ...children.map((child) => child.x + child.width + 24));
    parent.height = Math.max(
      parent.contentTop ?? 56,
      ...children.map((child) => child.y + child.height + 24),
    );
    changed = true;
    let current = parent;
    while (current.parentId) {
      const ancestor = nodes.get(current.parentId)!;
      ancestor.width = Math.max(ancestor.width, current.x + current.width + 24);
      ancestor.height = Math.max(ancestor.height, current.y + current.height + 24);
      current = ancestor;
    }
  }
  return changed;
}

/** 注釈は通信ノードとして扱わず、図上のアンカーから引き出し線を付ける。 */
export function placeAnnotations(
  graph: DisplayGraph,
  layout: LayoutResult,
): NonNullable<LayoutResult['annotations']> {
  const nodes = absolutePlacements(layout.nodes);
  const routes = new Map(layout.edges?.map((edge) => [edge.id, edge]));
  const occupied = [...nodes.values()].map((node) => ({
    ...node,
    height: node.contentTop ?? node.height,
  }));
  for (const box of layout.overlays ?? [])
    occupied.push({
      ...box,
      x: box.labelX ?? box.x,
      y: box.labelY ?? box.y,
      width: box.labelWidth ?? 160,
      height: box.labelHeight ?? 32,
    });
  for (const edge of layout.edges ?? [])
    if (edge.label)
      occupied.push({
        id: edge.id,
        x: edge.label.x - 120,
        y: edge.label.y - 16,
        width: 240,
        height: 32,
      });
  const result: NonNullable<LayoutResult['annotations']> = [];
  let unanchoredY = Math.min(24, ...[...nodes.values()].map((node) => node.y));
  for (const note of [...(graph.notes ?? [])].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    const attrs = note.attributes;
    const node = typeof attrs.anchor === 'string' ? nodes.get(attrs.anchor) : undefined;
    const edge =
      typeof attrs.anchorEdge === 'string'
        ? graph.connections.find(
            (edge) =>
              edge.id === attrs.anchorEdge || edge.originalIds.includes(String(attrs.anchorEdge)),
          )
        : undefined;
    if (attrs.anchorEdge !== undefined && !edge) continue;
    const route = edge ? routes.get(edge.id) : undefined;
    const anchor = node
      ? { x: node.x + node.width, y: node.y + node.height / 2 }
      : (route?.label ?? route?.points[Math.floor(route.points.length / 2)]);
    const parent = note.parentId ? nodes.get(note.parentId) : undefined;
    const width = 320,
      height = 48 + annotationHeight(note, width);
    const x =
      attrs.fixed === true
        ? Number(attrs.x) + (parent?.x ?? 0)
        : anchor
          ? anchor.x + 40
          : Math.max(24, ...[...nodes.values()].map((node) => node.x + node.width)) + 64;
    let y =
      attrs.fixed === true ? Number(attrs.y) + (parent?.y ?? 0) : anchor ? anchor.y : unanchoredY;
    if (attrs.fixed !== true) {
      const collisions = () =>
        occupied.find(
          (box) =>
            x < box.x + box.width + 16 &&
            x + width + 16 > box.x &&
            y < box.y + box.height + 16 &&
            y + height + 16 > box.y,
        );
      let collision = collisions();
      while (collision) {
        y = collision.y + collision.height + 24;
        collision = collisions();
      }
    }
    const annotation = {
      id: note.id,
      label: note.label,
      text: String(attrs.description ?? ''),
      x,
      y,
      width,
      height,
      anchor,
    };
    result.push(annotation);
    occupied.push(annotation);
    unanchoredY = y + height + 24;
  }
  return result;
}

/** 所有境界の見出しやカードと囲みのラベルを重ねない。 */
export function placeOverlayLabels(layout: LayoutResult): void {
  const nodes = [...absolutePlacements(layout.nodes).values()];
  const occupied = nodes.map((node) => ({ ...node, height: node.contentTop ?? node.height }));
  const collides = (box: Placement): boolean =>
    occupied.some(
      (other) =>
        box.x < other.x + other.width + 8 &&
        box.x + box.width + 8 > other.x &&
        box.y < other.y + other.height + 8 &&
        box.y + box.height + 8 > other.y,
    );
  for (const overlay of layout.overlays ?? []) {
    const width = Math.min(
      360,
      Math.max(
        160,
        [...overlay.label].reduce((n, c) => n + (c.codePointAt(0)! > 255 ? 15 : 8), 0) + 32,
      ),
    );
    const height =
      32 *
      Math.max(
        1,
        Math.ceil(
          (width - 32 < 1
            ? 1
            : [...overlay.label].reduce((n, c) => n + (c.codePointAt(0)! > 255 ? 15 : 8), 0)) /
            (width - 32),
        ),
      );
    let label: Placement | undefined;
    for (const y of [overlay.y + 4, overlay.y - height - 12, overlay.y + overlay.height + 12]) {
      for (
        let x = overlay.x + 12;
        x + width <= overlay.x + Math.max(overlay.width, width) + 12;
        x += 16
      ) {
        const candidate = { id: overlay.id, x, y, width, height };
        if (!collides(candidate)) {
          label = candidate;
          break;
        }
      }
      if (label) break;
    }
    label ??= {
      id: overlay.id,
      x: overlay.x + 12,
      y: Math.min(overlay.y, ...occupied.map((box) => box.y)) - height - 16,
      width,
      height,
    };
    overlay.labelX = label.x;
    overlay.labelY = label.y;
    overlay.labelWidth = width;
    overlay.labelHeight = height;
    occupied.push(label);
  }
}
