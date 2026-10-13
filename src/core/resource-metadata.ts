import type { Resource } from './model.js';

export interface ResourceMetadata {
  label: string;
  value: string;
}
/** 名前や親から推測せず、そのリソースに明記された属性のみ表示する。 */
export function resourceMetadata(resource: Resource): ResourceMetadata[] {
  const fields = [
    ['アカウントID', ['account']],
    ['プロジェクト', ['project']],
    ['サブスクリプション', ['subscription']],
    ['リージョン', ['region']],
    ['AZ', ['az', 'availability_zone']],
    ['AZ ID', ['azId', 'availability_zone_id']],
    ['CIDR', ['cidr', 'cidr_block']],
  ] as const;
  return fields.flatMap(([label, keys]) => {
    for (const key of keys) {
      const value = resource.attributes[key];
      if (typeof value === 'string' && value.trim()) return [{ label, value }];
    }
    return [];
  });
}
const textWidth = (text: string): number =>
  [...text].reduce((sum, c) => sum + (c.codePointAt(0)! > 255 ? 14 : 7), 0);
export function metadataWidth(items: ResourceMetadata[]): number {
  return items.length
    ? Math.min(480, Math.max(...items.map((item) => textWidth(item.value))) + 144)
    : 0;
}
export function metadataHeight(items: ResourceMetadata[], width: number): number {
  const available = Math.max(1, width - 144);
  return items.length
    ? items.reduce(
        (sum, item) =>
          sum +
          item.value
            .split('\n')
            .reduce(
              (height, line) => height + Math.max(1, Math.ceil(textWidth(line) / available)) * 16,
              0,
            ) +
          4,
        0,
      ) + 8
    : 0;
}
