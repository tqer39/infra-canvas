import { expressionMetadata } from './presentation.js';
import type { Resource } from './model.js';

export interface ResourceMetadata {
  label: string;
  value: string;
}
/** CPUはECSのCPU units、メモリはMiB、タスク数は非負整数。 */
export function validateComputeAttributes(resource: Resource): void {
  for (const key of ['cpu', 'memory', 'desiredCount']) {
    const value = resource.attributes[key];
    if (
      value !== undefined &&
      (typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < (key === 'memory' ? 1 : 0))
    )
      throw new Error(`${key} は ${key === 'memory' ? '正' : '非負'}の整数で指定してください。`);
  }
  const launchType = resource.attributes.launchType;
  if (
    launchType !== undefined &&
    (typeof launchType !== 'string' || !['FARGATE', 'EC2', 'EXTERNAL'].includes(launchType))
  )
    throw new Error('launchType は FARGATE・EC2・EXTERNAL で指定してください。');
  for (const key of ['capacityProviders', 'requiresCompatibilities']) {
    const value = resource.attributes[key];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim()))
    )
      throw new Error(`${key} は空でない文字列の配列で指定してください。`);
  }
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
  const identity = fields.flatMap(([label, keys]) => {
    for (const key of keys) {
      const value = resource.attributes[key];
      if (typeof value === 'string' && value.trim()) return [{ label, value }];
    }
    return [];
  });
  const compute: ResourceMetadata[] = [];
  const roles: Record<string, string> = {
    primary: 'Primary',
    replica: 'Replica',
    active: 'Active',
    standby: 'Standby',
  };
  if (typeof resource.attributes.redundancyRole === 'string')
    compute.push({ label: '冗長化', value: roles[resource.attributes.redundancyRole]! });
  if (Array.isArray(resource.attributes.ports) && resource.attributes.ports.length)
    compute.push({ label: '接続口', value: resource.attributes.ports.join(' / ') });
  const attrs = resource.attributes;
  if (Array.isArray(attrs.securityGroups) && attrs.securityGroups.length)
    compute.push({ label: 'SG', value: attrs.securityGroups.join(' / ') });
  for (const [label, key] of [
    ['実行方式', 'launchType'],
    ['容量プロバイダー', 'capacityProviders'],
    ['互換性', 'requiresCompatibilities'],
  ] as const) {
    const value = attrs[key];
    if (typeof value === 'string' && value.trim()) compute.push({ label, value });
    if (Array.isArray(value) && value.length) compute.push({ label, value: value.join(' / ') });
  }
  for (const key of ['cpu', 'memory', 'desiredCount'] as const) {
    const raw = attrs[key] ?? attrs[`meta.${key}`];
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^\d+$/.test(raw)
          ? Number(raw)
          : undefined;
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) continue;
    compute.push({
      label: key === 'cpu' ? 'CPU' : key === 'memory' ? 'メモリ' : '希望タスク数',
      value:
        key === 'cpu'
          ? `${value} units (${value / 1024} vCPU)`
          : key === 'memory'
            ? `${value} MiB (${value / 1024} GiB)`
            : String(value),
    });
  }
  return [...identity, ...compute, ...expressionMetadata(resource)];
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
