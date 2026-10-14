import { isBoundary, type Resource, type Attributes } from './model.js';

export const evidenceLabels: Record<string, string> = {
  design: '設計',
  observed: '観測',
  inferred: '推定',
  unknown: '未確定',
};
export const changeLabels: Record<string, string> = {
  unchanged: '変更なし',
  add: '追加予定',
  modify: '変更予定',
  remove: '削除予定',
};
export const exposureLabels: Record<string, string> = {
  public: '公開',
  private: '非公開',
  restricted: '制限付き',
  unknown: '公開区分不明',
};
export const appearanceTypes = [
  'default',
  'database',
  'queue',
  'storage',
  'rack',
  'site',
  'namespace',
] as const;

export function resourceTypeLabel(resource: Resource): string {
  if (resource.type === 'sg') return 'セキュリティグループ';
  return resource.type === 'account' &&
    (String(resource.attributes.icon ?? '').startsWith('aws.') ||
      /^aws(\.|$)/.test(String(resource.attributes.provider ?? '')))
    ? 'AWS アカウント'
    : resource.type;
}

export function exposure(resource: Resource): string | undefined {
  const value =
    resource.attributes.exposure ??
    resource.attributes.subnetVisibility ??
    resource.attributes.subnetType;
  return typeof value === 'string' ? value : undefined;
}
export function countLabel(attributes: Attributes): string | undefined {
  if (typeof attributes.count === 'number') return `×${attributes.count}`;
  if (typeof attributes.countMin === 'number')
    return `×${attributes.countMin}–${attributes.countMax}`;
  return undefined;
}
export function expressionMetadata(resource: Resource): { label: string; value: string }[] {
  const attrs = resource.attributes;
  const result: { label: string; value: string }[] = [];
  const visible = exposure(resource);
  if (visible && exposureLabels[visible])
    result.push({ label: '公開範囲', value: exposureLabels[visible]! });
  for (const [key, label] of [
    ['trustZone', '信頼ゾーン'],
    ['logicalService', '論理サービス'],
  ] as const)
    if (typeof attrs[key] === 'string') result.push({ label, value: attrs[key] });
  if (typeof attrs.evidence === 'string')
    result.push({ label: '根拠', value: evidenceLabels[attrs.evidence]! });
  if (typeof attrs.change === 'string')
    result.push({ label: '変更', value: changeLabels[attrs.change]! });
  const count = countLabel(attrs);
  if (count) result.push({ label: '台数', value: count });
  if (resource.provenance && resource.provenance.kind !== 'design')
    result.push({
      label: '出典',
      value: { plan: 'Terraform plan', state: 'Terraform state', static: '静的読み取り' }[
        resource.provenance.kind
      ],
    });
  return result;
}
export function resourceAppearance(resource: Resource): {
  borderColor?: string;
  background?: string;
  borderStyle?: string;
  opacity?: number;
} {
  const attrs = resource.attributes;
  const level = exposure(resource);
  const appearance =
    level === 'public'
      ? { borderColor: '#19779b', background: '#eaf7fc' }
      : level === 'private'
        ? { borderColor: '#39846b', background: '#edf8f2' }
        : level === 'restricted' || attrs.trustZone
          ? { borderColor: '#9466a9', background: '#f5effa' }
          : {};
  if (attrs.change === 'add')
    return { ...appearance, borderColor: '#258454', borderStyle: 'dashed' };
  if (attrs.change === 'modify')
    return { ...appearance, borderColor: '#b27616', borderStyle: 'dashed' };
  if (attrs.change === 'remove')
    return { ...appearance, borderColor: '#ad4848', borderStyle: 'dashed', opacity: 0.65 };
  return appearance;
}
export function annotationHeight(resource: Resource, width: number): number {
  if (resource.type !== 'note') return 0;
  const text = String(resource.attributes.description ?? '');
  const capacity = Math.max(1, Math.floor((width - 32) / 7));
  return (
    18 *
      text
        .split('\n')
        .reduce(
          (sum, line) =>
            sum +
            Math.max(
              1,
              Math.ceil(
                [...line].reduce((n, c) => n + (c.codePointAt(0)! > 255 ? 2 : 1), 0) / capacity,
              ),
            ),
          0,
        ) +
    24
  );
}
export function validatePresentation(resource: Resource): void {
  const attrs = resource.attributes;
  if (
    attrs.icon !== undefined &&
    attrs.icon !== '' &&
    (typeof attrs.icon !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(attrs.icon))
  )
    throw new Error('icon は同梱アイコンの種別IDを指定してください。');
  for (const [key, values] of [
    ['exposure', Object.keys(exposureLabels)],
    ['evidence', Object.keys(evidenceLabels)],
    ['change', Object.keys(changeLabels)],
    ['appearance', [...appearanceTypes]],
    ['columnsBy', ['az', 'region']],
  ] as const)
    if (
      attrs[key] !== undefined &&
      (typeof attrs[key] !== 'string' ||
        !(values as readonly string[]).includes(String(attrs[key])))
    )
      throw new Error(`${resource.id}: ${key} の値が不正です。`);
  for (const key of ['trustZone', 'logicalService', 'anchor', 'anchorEdge'])
    if (attrs[key] !== undefined && (typeof attrs[key] !== 'string' || !String(attrs[key]).trim()))
      throw new Error(`${resource.id}: ${key} は空でない文字列です。`);
  for (const key of ['count', 'countMin', 'countMax'])
    if (
      attrs[key] !== undefined &&
      (typeof attrs[key] !== 'number' ||
        !Number.isSafeInteger(attrs[key]) ||
        Number(attrs[key]) < 0)
    )
      throw new Error(`${resource.id}: ${key} は非負の整数です。`);
  if (attrs.countMin !== undefined || attrs.countMax !== undefined)
    if (
      typeof attrs.countMin !== 'number' ||
      typeof attrs.countMax !== 'number' ||
      attrs.countMin > attrs.countMax ||
      attrs.count !== undefined
    )
      throw new Error(
        `${resource.id}: countMin / countMax を組で指定し、count と併用しないでください。`,
      );
  if (attrs.columnsBy !== undefined && !isBoundary(resource))
    throw new Error('columnsBy は境界に指定してください。');
  if (attrs.boundary !== undefined && typeof attrs.boundary !== 'boolean')
    throw new Error('boundary は boolean です。');
  if (resource.type !== 'note' && (attrs.anchor !== undefined || attrs.anchorEdge !== undefined))
    throw new Error('anchor / anchorEdge は note に指定してください。');
  if (
    resource.type === 'note' &&
    (isBoundary(resource) || (attrs.anchor !== undefined && attrs.anchorEdge !== undefined))
  )
    throw new Error('note は境界にできず、anchor と anchorEdge は併用できません。');
}
