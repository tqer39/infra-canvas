import { resourceContent } from './content.js';
import { validateConfiguration } from './configuration.js';
import { validateComputeAttributes } from './resource-metadata.js';
import { isBoundary, isTelemetrySignals, edgeKinds as supportedEdgeKinds } from './model.js';
import type { Diagram, Resource } from './model.js';

const idPattern = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)),
  );
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const positiveInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && idPattern.test(value);
const attributes = (value: unknown): boolean =>
  record(value) &&
  Object.values(value).every(
    (item) =>
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item)) ||
      strings(item),
  );
const location = (value: unknown): boolean =>
  record(value) &&
  positiveInteger(value.line) &&
  positiveInteger(value.column) &&
  (value.file === undefined || typeof value.file === 'string');
const kinds: ReadonlySet<string> = new Set(supportedEdgeKinds);

/** 外部 JSON とライブラリ利用者の入力を、推測や修正をせず共通モデルとして検証する。 */
export function validateDiagram(value: unknown): Diagram {
  if (
    !record(value) ||
    value.version !== 1 ||
    typeof value.title !== 'string' ||
    !Array.isArray(value.resources) ||
    !Array.isArray(value.connections) ||
    !Array.isArray(value.views) ||
    !Array.isArray(value.diagnostics)
  )
    throw new Error('Infra Canvas Diagram JSON の形式が必要です。');
  const diagram = value as unknown as Diagram;
  const ids = new Set<string>();
  for (const resource of diagram.resources) {
    if (
      !record(resource) ||
      !identifier(resource.id) ||
      !identifier(resource.type) ||
      typeof resource.label !== 'string' ||
      !attributes(resource.attributes) ||
      (resource.parentId !== undefined && !identifier(resource.parentId)) ||
      (resource.location !== undefined && !location(resource.location)) ||
      (resource.unresolved !== undefined && !strings(resource.unresolved))
    )
      throw new Error('リソースの ID・種別・ラベル・有限値属性・ソース位置を確認してください。');
    resourceContent(resource);
    validateComputeAttributes(resource);
    validateConfiguration(resource);
    if (ids.has(resource.id)) throw new Error(`ID が重複しています: ${resource.id}`);
    ids.add(resource.id);
    if (resource.provenance !== undefined) {
      const provenance = resource.provenance;
      if (
        !record(provenance) ||
        !['design', 'plan', 'state', 'static'].includes(provenance.kind) ||
        ['repository', 'commit', 'root', 'address', 'file'].some(
          (key) => provenance[key] !== undefined && typeof provenance[key] !== 'string',
        ) ||
        (provenance.line !== undefined && !positiveInteger(provenance.line))
      )
        throw new Error(`取り込み元の種別・ソース情報を確認してください: ${resource.id}`);
    }
  }
  const byId = new Map(diagram.resources.map((resource) => [resource.id, resource]));
  validateResourceHierarchy(diagram.resources);
  for (const resource of diagram.resources) {
    for (const key of ['subnets', 'members', 'securityGroups', 'dependsOn']) {
      const refs = resource.attributes[key];
      if (refs === undefined) continue;
      if (!strings(refs))
        throw new Error(`${resource.id} の ${key} は ID 配列で指定してください。`);
      for (const id of refs) {
        const target = byId.get(id);
        if (!target) throw new Error(`存在しない参照: ${resource.id}.${key} -> ${id}`);
        if (key === 'subnets' && target.type !== 'subnet')
          throw new Error(`subnet を参照してください: ${id}`);
        if (key === 'securityGroups' && target.type !== 'sg')
          throw new Error(`sg を参照してください: ${id}`);
      }
    }
  }
  const edgeIds = new Set<string>();
  for (const edge of diagram.connections) {
    if (
      !record(edge) ||
      typeof edge.id !== 'string' ||
      !edge.id ||
      edgeIds.has(edge.id) ||
      !ids.has(edge.source) ||
      !ids.has(edge.target) ||
      !kinds.has(edge.kind) ||
      !attributes(edge.attributes) ||
      (edge.location !== undefined && !location(edge.location))
    )
      throw new Error('接続の ID・端点・kind・有限値属性・ソース位置を確認してください。');
    for (const key of ['label', 'protocol', 'description'])
      if (edge.attributes[key] !== undefined && typeof edge.attributes[key] !== 'string')
        throw new Error(`接続の ${key} は文字列で指定してください。`);
    if (edge.attributes.signals !== undefined && !isTelemetrySignals(edge.attributes.signals))
      throw new Error('接続の signals は metrics・logs・traces の空でない配列で指定してください。');
    const port = edge.attributes.port;
    if (
      port !== undefined &&
      (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535)
    )
      throw new Error('接続の port は 0 から 65535 の整数で指定してください。');
    edgeIds.add(edge.id);
  }
  for (const view of diagram.views) {
    if (
      !record(view) ||
      !identifier(view.id) ||
      ids.has(view.id) ||
      !['overview', 'service', 'subnet', 'resource'].includes(view.level) ||
      (view.overlay !== undefined && view.overlay !== 'sg') ||
      (view.direction !== undefined && !['RIGHT', 'DOWN'].includes(view.direction))
    )
      throw new Error('表示設定の一意な ID・level・overlay・direction を確認してください。');
    ids.add(view.id);
  }
  for (const diagnostic of diagram.diagnostics)
    if (
      !record(diagnostic) ||
      !location(diagnostic) ||
      typeof diagnostic.code !== 'string' ||
      !diagnostic.code ||
      typeof diagnostic.message !== 'string' ||
      !['error', 'warning'].includes(diagnostic.severity)
    )
      throw new Error('診断の code・severity・ソース位置を確認してください。');
  return diagram;
}

/** 配置計算前にも適用し、循環による無限再帰と存在しない親を防ぐ。 */
export function validateResourceHierarchy(resources: Resource[]): void {
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  if (byId.size !== resources.length) throw new Error('リソース ID が重複しています。');
  for (const resource of resources) {
    const visited = new Set([resource.id]);
    let parentId = resource.parentId;
    while (parentId !== undefined) {
      const parent = byId.get(parentId);
      if (!parent) throw new Error(`存在しない親 ID: ${parentId}`);
      if (visited.has(parentId)) throw new Error(`入れ子が循環しています: ${resource.id}`);
      if (!isBoundary(parent))
        throw new Error(`親は入れ子境界にしてください。SG は members で関連付けます: ${parentId}`);
      visited.add(parentId);
      parentId = parent.parentId;
    }
  }
}
