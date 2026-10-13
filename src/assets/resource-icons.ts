import type { Resource } from '../core/model.js';

/** Subnet のベンダーは型・明示属性・取り込み元・所属から判断し、名前では推測しない。 */
export function getResourceIconType(
  resource: Resource,
  byId: ReadonlyMap<string, Resource>,
): string {
  if (resource.type === 'vpc') return 'aws.vpc';
  if (resource.type !== 'subnet') return resource.type;
  const seen = new Set<string>();
  let current: Resource | undefined = resource;
  let aws = false;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const provider = current.attributes.provider;
    if (typeof provider === 'string') {
      if (/^(google|google-beta|azurerm)(\.|$)/.test(provider)) return resource.type;
      if (/^aws(\.|$)/.test(provider)) {
        aws = true;
        break;
      }
    }
    if (['project', 'subscription'].includes(current.type)) return resource.type;
    if (
      current.type === 'vpc' ||
      current.type === 'account' ||
      current.type.startsWith('aws.') ||
      /(^|\.)aws_subnet\./.test(current.provenance?.address ?? '')
    ) {
      aws = true;
      break;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  const visibility = resource.attributes.subnetVisibility ?? resource.attributes.subnetType;
  return aws && (visibility === 'public' || visibility === 'private')
    ? `aws.subnet-${visibility}`
    : resource.type;
}
