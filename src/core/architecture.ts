import { validateSecurity } from './security.js';
import { validatePresentation, evidenceLabels, changeLabels } from './presentation.js';
import { edgeKinds, type Diagram, type Resource } from './model.js';

/** 所属・通信成立を推測せず、明示した構成図の意味だけを検証する。 */
export function validateArchitecture(diagram: Diagram): void {
  validateSecurity(diagram);
  const resources = new Map(diagram.resources.map((resource) => [resource.id, resource]));
  for (const resource of diagram.resources) {
    validateResourceExpressions(resource);
    const attrs = resource.attributes;
    if (resource.type === 'overlay') {
      if (
        !Array.isArray(attrs.members) ||
        !attrs.members.length ||
        new Set(attrs.members).size !== attrs.members.length
      )
        throw new Error(`${resource.id}: overlay には重複しない空でない members が必要です。`);
      for (const id of attrs.members)
        if (!resources.has(id) || resources.get(id)?.type === 'overlay')
          throw new Error(`${resource.id}: overlay の members は実体・境界を参照してください。`);
      if (attrs.ports !== undefined) throw new Error('overlay に接続口は指定できません。');
    }
  }
  const connectionIds = new Set(diagram.connections.map((edge) => edge.id));
  if (
    connectionIds.size !== diagram.connections.length ||
    diagram.connections.some((edge) => !edge.id.trim())
  )
    throw new Error('接続 ID は空でない一意の文字列です。');
  for (const resource of diagram.resources) {
    const attrs = resource.attributes;
    for (const key of ['logicalService', 'anchor'])
      if (
        attrs[key] !== undefined &&
        (!resources.has(String(attrs[key])) ||
          resources.get(String(attrs[key]))?.type === 'overlay' ||
          resources.get(String(attrs[key]))?.type === 'note' ||
          resource.id === attrs[key])
      )
        throw new Error(`${resource.id}: ${key} は別の実体・境界を参照してください。`);
    if (attrs.anchorEdge !== undefined && !connectionIds.has(String(attrs.anchorEdge)))
      throw new Error(`${resource.id}: anchorEdge の接続が存在しません。`);
    if (
      resource.type === 'note' &&
      diagram.connections.some((edge) => edge.source === resource.id || edge.target === resource.id)
    )
      throw new Error('note は通信端点にできません。');
    const visited = new Set([resource.id]);
    let parent: unknown = attrs.logicalService;
    while (typeof parent === 'string') {
      if (visited.has(parent)) throw new Error('logicalService が循環しています。');
      visited.add(parent);
      parent = resources.get(parent)?.attributes.logicalService;
    }
  }
  const paths = new Map<string, Diagram['connections']>();
  for (const edge of diagram.connections) {
    if (
      resources.get(edge.source)?.type === 'overlay' ||
      resources.get(edge.target)?.type === 'overlay'
    )
      throw new Error('overlay は接続端点にできません。');
    const attrs = edge.attributes;
    for (const [key, values] of [
      ['evidence', Object.keys(evidenceLabels)],
      ['change', Object.keys(changeLabels)],
    ] as const)
      if (
        attrs[key] !== undefined &&
        (typeof attrs[key] !== 'string' || !values.includes(String(attrs[key])))
      )
        throw new Error(`接続の ${key} の値が不正です。`);
    if (attrs.encrypted !== undefined && typeof attrs.encrypted !== 'boolean')
      throw new Error('encrypted は boolean です。');
    if (
      attrs.authMethod !== undefined &&
      (typeof attrs.authMethod !== 'string' || !attrs.authMethod.trim())
    )
      throw new Error('authMethod は空でない文字列です。');
    for (const key of ['purpose', 'route', 'sourcePort', 'targetPort'])
      if (
        attrs[key] !== undefined &&
        (typeof attrs[key] !== 'string' || !String(attrs[key]).trim())
      )
        throw new Error(`${edge.id}: ${key} は空でない文字列です。`);
    for (const [key, id] of [
      ['sourcePort', edge.source],
      ['targetPort', edge.target],
    ]) {
      const port = attrs[key!];
      if (
        port !== undefined &&
        !(resources.get(id!)?.attributes.ports as string[] | undefined)?.includes(String(port))
      )
        throw new Error(`${edge.id}: ${id} に存在しない接続口 ${port} です。`);
    }
    if (
      attrs.routeDirection !== undefined &&
      (typeof attrs.routeDirection !== 'string' ||
        !['forward', 'return'].includes(attrs.routeDirection))
    )
      throw new Error('routeDirection は forward・return です。');
    if (attrs.route === undefined) {
      if (attrs.step !== undefined || attrs.routeDirection !== undefined)
        throw new Error('step・routeDirection には route が必要です。');
    } else {
      if (typeof attrs.step !== 'number' || !Number.isSafeInteger(attrs.step) || attrs.step < 1)
        throw new Error('route には正の整数 step が必要です。');
      const key = JSON.stringify([attrs.route, attrs.routeDirection ?? 'forward']);
      const path = paths.get(key) ?? [];
      path.push(edge);
      paths.set(key, path);
    }
  }
  for (const path of paths.values()) {
    path.sort((a, b) => Number(a.attributes.step) - Number(b.attributes.step));
    path.forEach((edge, index) => {
      if (edge.attributes.step !== index + 1)
        throw new Error(`${edge.attributes.route}: step は1から連続する一意の番号です。`);
      if (index && path[index - 1]!.target !== edge.source)
        throw new Error(`${edge.attributes.route}: 経路の接続端点が連続していません。`);
    });
  }
  for (const view of diagram.views) {
    for (const key of ['kinds', 'routes', 'purposes'] as const) {
      const values = view[key];
      if (
        values !== undefined &&
        (!Array.isArray(values) ||
          values.some((item) => typeof item !== 'string' || !item.trim()) ||
          new Set(values).size !== values.length)
      )
        throw new Error(`view ${view.id}: ${key} は重複しない文字列配列です。`);
    }
    if (view.kinds?.some((kind) => !(edgeKinds as readonly string[]).includes(kind)))
      throw new Error(`view ${view.id}: kinds に未知の接続種別があります。`);
    if (
      view.routes?.some(
        (route) => !diagram.connections.some((edge) => edge.attributes.route === route),
      )
    )
      throw new Error(`view ${view.id}: 存在しない経路です。`);
    if (
      view.purposes?.some(
        (purpose) => !diagram.connections.some((edge) => edge.attributes.purpose === purpose),
      )
    )
      throw new Error(`view ${view.id}: 存在しない用途です。`);
  }
}

/** 配置APIにも適用し、不正な固定座標・接続口から計算を始めない。 */
export function validateResourceExpressions(resource: Resource): void {
  validatePresentation(resource);
  const attrs = resource.attributes;
  if (
    attrs.ports !== undefined &&
    (!Array.isArray(attrs.ports) ||
      attrs.ports.some((port) => !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(port)) ||
      new Set(attrs.ports).size !== attrs.ports.length)
  )
    throw new Error(`${resource.id}: ports は重複しない接続口 ID の配列にしてください。`);
  if (
    attrs.redundancyRole !== undefined &&
    (typeof attrs.redundancyRole !== 'string' ||
      !['primary', 'replica', 'active', 'standby'].includes(attrs.redundancyRole))
  )
    throw new Error(`${resource.id}: redundancyRole は primary・replica・active・standby です。`);
  if (attrs.fixed !== undefined && typeof attrs.fixed !== 'boolean')
    throw new Error(`${resource.id}: fixed は boolean です。`);
  for (const key of ['x', 'y'])
    if (
      attrs[key] !== undefined &&
      (typeof attrs[key] !== 'number' ||
        !Number.isFinite(attrs[key]) ||
        (resource.parentId && Number(attrs[key]) < 24))
    )
      throw new Error(`${resource.id}: ${key} は有限座標、親境界内では24以上にしてください。`);
  if (attrs.fixed === true && (typeof attrs.x !== 'number' || typeof attrs.y !== 'number'))
    throw new Error(`${resource.id}: fixed=true には x と y が必要です。`);
}
