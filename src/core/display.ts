import { isBoundary } from './model.js';
import type { Connection, Diagram, DisplayGraph, DisplayOptions } from './model.js';

/** 表示モデルは原図を変更せず、折りたたみ解除で元の端点・方向・意味を復元する。 */
export function buildDisplayGraph(diagram: Diagram, options: DisplayOptions = {}): DisplayGraph {
  const byId = new Map(diagram.resources.map(resource => [resource.id, resource]));
  const view = diagram.views.find(item => item.id === options.view);
  const level = view?.level ?? ({ overview: 'overview', services: 'service', service: 'service', network: 'subnet', security: 'resource' } as Record<string, string>)[options.view ?? ''] ?? 'resource';
  const showSG = view?.overlay === 'sg' || options.view === 'security';
  const collapsed = new Set((options.collapsed ?? []).filter(id => byId.has(id) && isBoundary(byId.get(id)!)));
  const expanded = new Set(options.expanded ?? []);
  if (level === 'overview') for (const resource of diagram.resources) if (['account', 'project', 'subscription'].includes(resource.type) && !expanded.has(resource.id)) collapsed.add(resource.id);
  if (level === 'service') for (const resource of diagram.resources) if (resource.type === 'subnet' && !expanded.has(resource.id)) collapsed.add(resource.id);
  const representative: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const resource of diagram.resources) {
    let current = resource, chosen = resource.id;
    const seen = new Set([resource.id]);
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id); if (collapsed.has(parent.id)) chosen = parent.id; current = parent;
    }
    representative[resource.id] = chosen;
  }
  const visible = diagram.resources.filter(resource => representative[resource.id] === resource.id && (resource.type !== 'sg' || showSG));
  const visibleIds = new Set(visible.map(resource => resource.id));
  const connections = new Map<string, Connection & { originalIds: string[] }>();
  const include = (edge: Connection): void => {
    const source = representative[edge.source], target = representative[edge.target];
    if (!source || !target || !visibleIds.has(source) || !visibleIds.has(target)) return;
    if (source === target && (edge.source !== edge.target || source !== edge.source)) return;
    const attributesKey = JSON.stringify(Object.entries(edge.attributes).sort(([a], [b]) => a.localeCompare(b)));
    const key = JSON.stringify([source, target, edge.kind, attributesKey]);
    const previous = connections.get(key);
    if (previous) previous.originalIds.push(edge.id);
    else connections.set(key, { ...edge, source, target, originalIds: [edge.id] });
  };
  for (const edge of diagram.connections) include(edge);
  for (const resource of diagram.resources) {
    if (showSG && resource.type === 'sg' && Array.isArray(resource.attributes.members)) for (const member of resource.attributes.members) include({ id: `sg:${resource.id}:${member}`, source: resource.id, target: member, kind: 'association', attributes: { label: 'SG 所属（通信成立を示さない）' } });
    if (showSG && Array.isArray(resource.attributes.securityGroups)) for (const group of resource.attributes.securityGroups) include({ id: `sg:${group}:${resource.id}`, source: group, target: resource.id, kind: 'association', attributes: { label: 'SG 所属（通信成立を示さない）' } });
    if ((level === 'subnet' || showSG) && Array.isArray(resource.attributes.subnets)) for (const subnet of resource.attributes.subnets) include({ id: `subnet:${resource.id}:${subnet}`, source: resource.id, target: subnet, kind: 'association', attributes: { label: 'Subnet 配置設定' } });
  }
  return { resources: visible.map(resource => ({ ...resource, attributes: { ...resource.attributes } })), connections: [...connections.values()], representative, collapsed: [...collapsed] };
}
