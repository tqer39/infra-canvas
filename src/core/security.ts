import type { Diagram, Resource } from './model.js';

export interface SecurityRule {
  protocol: 'tcp' | 'udp' | 'icmp' | 'all';
  port: string;
  peer: string;
  group?: string;
}
function cidr(value: string): boolean {
  const [address, prefix, extra] = value.split('/');
  if (extra !== undefined || !/^\d+$/.test(prefix ?? '')) return false;
  const n = Number(prefix);
  if (/^\d+(?:\.\d+){3}$/.test(address))
    return n <= 32 && address.split('.').every((part) => Number(part) <= 255);
  if (!/^[\da-f:]+$/i.test(address) || !address.includes(':') || n > 128) return false;
  const parts = address.split('::');
  if (parts.length > 2) return false;
  const groups = parts.flatMap((part) => (part ? part.split(':') : []));
  return (
    groups.every((part) => /^[\da-f]{1,4}$/i.test(part)) &&
    (parts.length === 2 ? groups.length < 8 : groups.length === 8)
  );
}
/** SGのルールは通信成立とは分離し、許可条件だけを表示する。 */
export function parseSecurityRule(text: string): SecurityRule {
  const parts = text.trim().split(/\s+/);
  const [protocol, port, peer] = parts;
  if (parts.length !== 3 || !['tcp', 'udp', 'icmp', 'all'].includes(protocol))
    throw new Error('SGルールは "tcp 443 0.0.0.0/0" または "tcp 5432 sg:db_sg" の形式です。');
  if (protocol === 'tcp' || protocol === 'udp') {
    const range = port.split('-');
    if (
      range.length > 2 ||
      range.some((p) => !/^\d+$/.test(p) || Number(p) > 65535) ||
      (range.length === 2 && Number(range[0]) > Number(range[1]))
    )
      throw new Error('SGのTCP/UDPポートは0〜65535、範囲は開始-終了で指定してください。');
  } else if (port !== '*') throw new Error('all/icmpのポートは * で指定してください。');
  const group = /^sg:([A-Za-z_][A-Za-z0-9_.:-]*)$/.exec(peer)?.[1];
  if (!group && !cidr(peer))
    throw new Error('SGの通信相手はIPv4/IPv6 CIDRまたはsg:IDで指定してください。');
  return {
    protocol: protocol as SecurityRule['protocol'],
    port,
    peer,
    ...(group ? { group } : {}),
  };
}
export function securityRules(resource: Resource): { direction: string; rule: SecurityRule }[] {
  return ['ingress', 'egress'].flatMap((direction) => {
    const rules = resource.attributes[direction];
    if (rules === undefined) return [];
    if (resource.type !== 'sg' || !Array.isArray(rules))
      throw new Error('ingress/egressはsgの文字列配列です。');
    return rules.map((text) => ({
      direction: direction === 'ingress' ? '受信' : '送信',
      rule: parseSecurityRule(text),
    }));
  });
}
export function validateSecurity(diagram: Diagram): void {
  const resources = new Map(diagram.resources.map((resource) => [resource.id, resource]));
  for (const resource of diagram.resources)
    for (const { rule } of securityRules(resource))
      if (rule.group && resources.get(rule.group)?.type !== 'sg')
        throw new Error(
          `${resource.id}: SGルールの参照先 ${rule.group} は存在するsgを指定してください。`,
        );
}
