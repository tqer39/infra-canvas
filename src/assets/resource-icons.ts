import type { Resource } from '../core/model.js';

/** 境界のベンダーは型・明示属性・取り込み元・所属から判断し、名前では推測しない。 */
export function getResourceIconType(
  resource: Resource,
  byId: ReadonlyMap<string, Resource>,
): string {
  if (resource.type === 'vpc') return 'aws.vpc';
  if (resource.type === 'account') return 'aws.account';
  if (!['subnet', 'region'].includes(resource.type)) return resource.type;
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
  if (resource.type === 'region') {
    const region = resource.attributes.region;
    return aws || (typeof region === 'string' && /^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/.test(region))
      ? 'aws.region'
      : resource.type;
  }
  const visibility = resource.attributes.subnetVisibility ?? resource.attributes.subnetType;
  return aws && (visibility === 'public' || visibility === 'private')
    ? `aws.subnet-${visibility}`
    : resource.type;
}
