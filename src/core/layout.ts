import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api.js';
import { validateResourceHierarchy } from './validate.js';
import { isBoundary } from './model.js';
import type { Connection, DisplayGraph, EdgeRoute, LayoutResult, Placement, Resource } from './model.js';

export interface LayoutOptions { direction?: 'RIGHT' | 'DOWN' }
export const layoutVersion = 'infra-canvas-layout-2';

const kindLabels = { traffic: '通信', dependency: '依存', auth: '認証', deploy: 'デプロイ', association: '関連' };
export const connectionLabel = (edge: Connection): string => [edge.attributes.label ?? kindLabels[edge.kind], edge.attributes.protocol, edge.attributes.port].filter(value => value !== undefined).join(' · ');
const textWidth = (text: string, latin = 7, wide = 12): number => [...text].reduce((sum, char) => sum + (char.codePointAt(0)! > 255 ? wide : latin), 0);

/** 配置入力を ID 順に正規化し、ELK の seed とアルゴリズムを固定する。 */
export async function layoutGraph(graph: DisplayGraph, options: LayoutOptions = {}): Promise<LayoutResult> {
  validateResourceHierarchy(graph.resources);
  const resourceIds = new Set(graph.resources.map(resource => resource.id));
  for (const edge of graph.connections) if (!resourceIds.has(edge.source) || !resourceIds.has(edge.target)) throw new Error(`配置対象に存在しない接続端点: ${edge.id}`);
  const started = performance.now();
  const byId = new Map(graph.resources.map(resource => [resource.id, resource]));
  const children = new Map<string | undefined, Resource[]>();
  for (const resource of graph.resources) {
    const parent = resource.parentId && byId.has(resource.parentId) ? resource.parentId : undefined;
    const siblings = children.get(parent) ?? []; siblings.push(resource); children.set(parent, siblings);
  }
  const makeChildren = (parentId: string | undefined): ElkNode[] => (children.get(parentId) ?? []).slice().sort((a, b) => a.id.localeCompare(b.id, 'en')).map(resource => {
    const nested = makeChildren(resource.id);
    const labelWidth = textWidth(resource.label, 8, 14);
    const node: ElkNode = { id: resource.id, width: Math.max(180, Math.min(labelWidth + 60, 480)), height: isBoundary(resource) ? 80 : 86 };
    if (nested.length) { node.children = nested; node.layoutOptions = { 'elk.padding': '[top=56,left=24,bottom=24,right=24]' }; }
    return node;
  });
  let rootId = '__infra_root__';
  while (byId.has(rootId)) rootId += '_';
  const input: ElkNode = {
    id: rootId, children: makeChildren(undefined),
    edges: graph.connections.slice().sort((a, b) => a.id.localeCompare(b.id, 'en')).map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target], labels: [{ text: connectionLabel(edge), width: textWidth(connectionLabel(edge)) + 14, height: 22 }], layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } })),
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': options.direction ?? 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL', 'elk.edgeLabels.inline': 'false',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.randomSeed': '1',
      'elk.spacing.nodeNode': '44', 'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.spacing.edgeNode': '24', 'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
  };
  const elk = new ELK();
  const result = await elk.layout(input);
  const nodes: Placement[] = [];
  const offsets = new Map<string, { x: number; y: number }>([[rootId, { x: 0, y: 0 }]]);
  const allEdges: { edge: ElkExtendedEdge; owner: string }[] = [];
  const collect = (parent: ElkNode, parentId?: string): void => {
    const origin = offsets.get(parent.id)!;
    for (const edge of parent.edges ?? []) allEdges.push({ edge, owner: parent.id });
    for (const node of parent.children ?? []) {
      nodes.push({ id: node.id, x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 180, height: node.height ?? 86, ...(parentId ? { parentId } : {}) });
      offsets.set(node.id, { x: origin.x + (node.x ?? 0), y: origin.y + (node.y ?? 0) });
      collect(node, node.id);
    }
  };
  collect(result);
  const edges: EdgeRoute[] = allEdges.map(({ edge, owner }) => {
    const origin = offsets.get(edge.container ?? owner) ?? { x: 0, y: 0 };
    const absolute = (point: { x: number; y: number }): { x: number; y: number } => ({ x: point.x + origin.x, y: point.y + origin.y });
    const points = (edge.sections ?? []).flatMap(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]).map(absolute);
    const label = edge.labels?.[0];
    return { id: edge.id, points, ...(label && label.x !== undefined && label.y !== undefined ? { label: absolute({ x: label.x + (label.width ?? 0) / 2, y: label.y + (label.height ?? 0) / 2 }) } : {}) };
  });
  return { nodes, edges, durationMs: performance.now() - started, version: layoutVersion };
}
