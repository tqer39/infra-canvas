import type { Attribute, Diagram, Resource } from './model.js';

const encode = (value: Attribute): string => JSON.stringify(value);
const validId = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const identifier = (id: string): string => {
  if (!validId.test(id)) throw new Error(`DSL ID として使用できません: ${id}`);
  return id;
};

/** 実行可能なコードを生成せず、文字列を JSON escape で引用する。 */
export function serializeDSL(diagram: Diagram): string {
  const lines = [`diagram ${JSON.stringify(diagram.title)} version=1 {`];
  const children = new Map<string | undefined, Resource[]>();
  const ids = new Set<string>();
  for (const resource of diagram.resources) {
    identifier(resource.id);
    identifier(resource.type);
    if (ids.has(resource.id)) throw new Error(`ID が重複しています: ${resource.id}`);
    ids.add(resource.id);
    const siblings = children.get(resource.parentId) ?? [];
    siblings.push(resource);
    children.set(resource.parentId, siblings);
  }
  for (const resource of diagram.resources)
    if (resource.parentId && !ids.has(resource.parentId))
      throw new Error(`親が存在しません: ${resource.parentId}`);
  const visited = new Set<string>();
  const emit = (parentId: string | undefined, depth: number): void => {
    for (const resource of children.get(parentId) ?? []) {
      if (visited.has(resource.id)) throw new Error(`所属が循環しています: ${resource.id}`);
      visited.add(resource.id);
      const attributes = { ...resource.attributes };
      if (resource.provenance && resource.provenance.kind !== 'design') {
        attributes.sourceKind = resource.provenance.kind;
        for (const key of ['repository', 'commit', 'root', 'address', 'file', 'line'] as const)
          if (resource.provenance[key] !== undefined) attributes[key] = resource.provenance[key]!;
      }
      if (resource.unresolved?.length) attributes.unresolved = resource.unresolved;
      const rendered = Object.entries(attributes)
        .map(([key, value]) => `${identifier(key)}=${encode(value)}`)
        .join(' ');
      const line = `${'  '.repeat(depth)}${resource.type} ${resource.id} ${JSON.stringify(resource.label)}${rendered ? ` ${rendered}` : ''}`;
      if (children.has(resource.id)) {
        lines.push(`${line} {`);
        emit(resource.id, depth + 1);
        lines.push(`${'  '.repeat(depth)}}`);
      } else lines.push(line);
    }
  };
  emit(undefined, 1);
  if (visited.size !== diagram.resources.length) throw new Error('所属関係が循環しています。');
  for (const connection of diagram.connections) {
    identifier(connection.source);
    identifier(connection.target);
    const attributes = { id: connection.id, ...connection.attributes, kind: connection.kind };
    lines.push(
      `  ${connection.source} -> ${connection.target} ${Object.entries(attributes)
        .map(([key, value]) => `${identifier(key)}=${encode(value)}`)
        .join(' ')}`,
    );
  }
  for (const view of diagram.views)
    lines.push(
      `  view ${identifier(view.id)}${view.label ? ` label=${encode(view.label)}` : ''} level=${view.level}${view.overlay ? ` overlay=${encode(view.overlay)}` : ''}${view.direction ? ` direction=${view.direction}` : ''}${[
        'kinds',
        'routes',
        'purposes',
      ]
        .map((key) => {
          const value = view[key as 'kinds' | 'routes' | 'purposes'];
          return value === undefined ? '' : ` ${key}=${encode(value)}`;
        })
        .join('')}`,
    );
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
