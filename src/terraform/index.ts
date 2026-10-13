import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Attributes, Diagram, Provenance, Resource } from '../core/model.js';
import { definitionAddress, readSources, staticLiteral, type Sources } from './source.js';
export interface TerraformContext {
  repository?: string;
  root?: string;
  commit?: string;
  sources?: Sources;
}
export interface TerraformRepositoryOptions {
  repository: string;
  root?: string;
  json?: string;
}
type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const types: Record<string, string> = {
  aws_organizations_organization: 'aws.organization',
  aws_organizations_root: 'aws.organization-root',
  aws_organizations_organizational_unit: 'aws.organizational-unit',
  aws_organizations_account: 'aws.organization-account',
  aws_organizations_policy: 'aws.organization-policy',
  aws_organizations_policy_attachment: 'aws.organization-policy-attachment',
  aws_vpc: 'vpc',
  aws_subnet: 'subnet',
  aws_lb: 'aws.alb',
  aws_alb: 'aws.alb',
  aws_instance: 'aws.ec2',
  aws_ecs_cluster: 'aws.ecs-cluster',
  aws_ecs_service: 'aws.ecs-service',
  aws_ecs_task_definition: 'aws.ecs-task-definition',
  aws_elastic_beanstalk_application: 'aws.beanstalk-application',
  aws_elastic_beanstalk_environment: 'aws.beanstalk-environment',
  aws_elastic_beanstalk_application_version: 'aws.beanstalk-version',
  aws_db_instance: 'aws.rds',
  aws_security_group: 'sg',
  aws_internet_gateway: 'aws.igw',
  aws_nat_gateway: 'aws.nat',
  aws_route_table: 'aws.route-table',
  aws_route: 'aws.route',
  aws_route_table_association: 'aws.route-association',
  aws_s3_bucket: 'aws.s3',
  aws_lambda_function: 'aws.lambda',
  aws_iam_role: 'aws.iam-role',
  aws_iam_openid_connect_provider: 'aws.oidc',
  aws_db_subnet_group: 'aws.db-subnet-group',
  aws_ec2_transit_gateway: 'aws.transit-gateway',
  aws_ec2_transit_gateway_vpc_attachment: 'aws.tgw-attachment',
  aws_ec2_transit_gateway_route_table: 'aws.tgw-route-table',
  aws_ec2_transit_gateway_route_table_association: 'aws.tgw-route-association',
  aws_ec2_transit_gateway_route_table_propagation: 'aws.tgw-route-propagation',
  aws_ram_resource_share: 'aws.ram-share',
  aws_ram_resource_association: 'aws.ram-resource-association',
  aws_ram_principal_association: 'aws.ram-principal-association',
  aws_customer_gateway: 'aws.customer-gateway',
  aws_vpn_connection: 'aws.vpn-connection',
  google_compute_network: 'network',
  google_compute_ha_vpn_gateway: 'gcp.ha-vpn',
  google_compute_external_vpn_gateway: 'gcp.external-vpn',
  google_compute_vpn_tunnel: 'gcp.vpn-tunnel',
  google_compute_router: 'gcp.router',
  google_compute_router_interface: 'gcp.router-interface',
  google_compute_router_peer: 'gcp.bgp-peer',
};
const safe: Record<string, RegExp> = {
  availability_zone: /^[a-z]{2}(?:-gov)?-[a-z]+-\d[a-z]$/,
  region: /^(?:[a-z]{2}(?:-gov)?-[a-z]+-\d|[a-z]+-[a-z]+\d)$/,
  cidr_block: /^[\d.:a-f]+\/\d{1,3}$/,
  instance_type: /^[a-z]\d[a-z]*\.[a-z\d]+$/,
  engine:
    /^(aurora(?:-mysql|-postgresql)?|mysql|postgres|mariadb|oracle-[a-z0-9-]+|sqlserver-[a-z]+)$/,
  engine_version: /^[\d.]+$/,
};
function hasSensitive(value: unknown): boolean {
  return (
    value === true ||
    (typeof value === 'object' && value !== null && Object.values(value).some(hasSensitive))
  );
}
function clean(values: Obj, sensitive: Obj): Attributes {
  const attrs: Attributes = {};
  for (const [key, pattern] of Object.entries(safe)) {
    const value = values[key];
    if (!hasSensitive(sensitive[key]) && typeof value === 'string' && pattern.test(value))
      attrs[key] = value;
  }
  return attrs;
}
interface Item {
  address: string;
  type: string;
  values: Obj;
  sensitive: Obj;
  unknown: Obj;
  dependencies: string[];
  provider?: string;
}
function empty(): Diagram {
  return {
    version: 1,
    title: 'Terraform infrastructure',
    resources: [],
    connections: [],
    views: [
      { id: 'overview', level: 'overview' },
      { id: 'service', level: 'service' },
      { id: 'network', level: 'subnet' },
      { id: 'security', level: 'resource', overlay: 'sg' },
    ],
    diagnostics: [],
  };
}
function warn(d: Diagram, code: string, message: string): void {
  d.diagnostics.push({ code, message, severity: 'warning', line: 1, column: 1 });
}
function modulePrefix(address: string): string | undefined {
  const match = /^(.*module\.[\w-]+(?:\[(?:\d+|"(?:\\.|[^"\\])*")\])?)\./.exec(address);
  return match?.[1];
}
function build(items: Item[], kind: Provenance['kind'], context: TerraformContext): Diagram {
  if (kind === 'static')
    for (const item of items) {
      if (
        item.type === 'aws_organizations_organization' &&
        items.some(
          (candidate) =>
            candidate.dependencies.includes(item.address) &&
            ['parent_id', 'target_id'].some(
              (key) => candidate.values[key] === item.address + '.roots[0]',
            ),
        )
      ) {
        item.values.roots = [{ id: item.address + '.roots[0]' }];
      }
    }
  // Rootはcomputed rootsまたは静的なroots[0].id直接参照から生成する。
  items = items.flatMap((item) => {
    if (
      item.type !== 'aws_organizations_organization' ||
      hasSensitive(item.sensitive.roots) ||
      hasSensitive(item.unknown.roots)
    )
      return [item];
    return [
      item,
      ...arr(item.values.roots).flatMap((root, index): Item[] => {
        const id = obj(root).id;
        if (typeof id !== 'string') return [];
        return [
          {
            address: item.address + '.roots[' + index + ']',
            type: 'aws_organizations_root',
            values: { id, organization: item.address },
            sensitive: {},
            unknown: {},
            dependencies: [],
          },
        ];
      }),
    ];
  });
  const d = empty();
  const ids = new Map<string, string>();
  const ambiguousIds = new Set<string>();
  const raw = new Map(items.map((i) => [i.address, i]));
  const provenance = (address: string): Provenance => {
    const source = context.sources?.definitions.get(definitionAddress(address));
    return {
      kind,
      repository: context.repository,
      root: context.root,
      commit: context.commit,
      address,
      ...(source ? { file: source.file, line: source.line } : {}),
    };
  };
  const addModule = (address: string): void => {
    if (d.resources.some((r) => r.id === address)) return;
    const parent = modulePrefix(address);
    if (parent) addModule(parent);
    d.resources.push({
      id: address,
      type: 'module',
      label: address,
      parentId: parent,
      attributes: {},
      provenance: {
        kind,
        repository: context.repository,
        root: context.root,
        commit: context.commit,
        address,
      },
      unresolved: ['module の所属アカウントは未確定'],
    });
  };
  for (const item of items) {
    const parent = modulePrefix(item.address);
    if (parent) addModule(parent);
    const attributes = clean(item.values, item.sensitive);
    if (
      item.type === 'aws_organizations_policy' &&
      !hasSensitive(item.sensitive.type) &&
      !hasSensitive(item.unknown.type) &&
      typeof item.values.type === 'string' &&
      /^(SERVICE_CONTROL_POLICY|RESOURCE_CONTROL_POLICY|TAG_POLICY|BACKUP_POLICY|AISERVICES_OPT_OUT_POLICY|BEDROCK_POLICY|CHATBOT_POLICY|DECLARATIVE_POLICY_EC2|INSPECTOR_POLICY|S3_POLICY|SECURITYHUB_POLICY|UPGRADE_ROLLOUT_POLICY)$/.test(
        item.values.type,
      )
    )
      attributes['meta.policyType'] = item.values.type;
    attributes.terraformType = item.type;
    const resource: Resource = {
      id: item.address,
      type: types[item.type] ?? item.type,
      label: item.address,
      parentId: parent,
      attributes,
      provenance: provenance(item.address),
      unresolved: [],
    };
    if (!types[item.type]) resource.unresolved!.push('未対応の Terraform リソース種別');
    if (!resource.provenance?.file) resource.unresolved!.push('ソース位置は未解決');
    if (item.provider && /^[\w.-]+$/.test(item.provider)) attributes.provider = item.provider;
    if (hasSensitive(item.unknown))
      resource.unresolved!.push('未確定属性があります（値は取り込みません）');
    for (const key of Object.keys(safe))
      if (hasSensitive(item.unknown[key])) resource.unresolved!.push(`${key} は未確定`);
    if (!Object.keys(attributes).includes('region'))
      resource.unresolved!.push('アカウント・リージョンは未確定');
    d.resources.push(resource);
    // ID 値は関連の解決だけに使い、表示属性へコピーしません。
    if (
      !hasSensitive(item.sensitive.id) &&
      !hasSensitive(item.unknown.id) &&
      typeof item.values.id === 'string'
    ) {
      if (ids.has(item.values.id)) {
        ambiguousIds.add(item.values.id);
        ids.delete(item.values.id);
      } else if (!ambiguousIds.has(item.values.id)) ids.set(item.values.id, item.address);
    }
  }
  const get = (id: string) => d.resources.find((r) => r.id === id)!;
  const resolve = (value: unknown): string[] =>
    arr(Array.isArray(value) ? value : [value]).flatMap((v) =>
      typeof v === 'string' && (ids.has(v) || raw.has(v)) ? [ids.get(v) ?? v] : [],
    );
  const edge = (
    source: string,
    target: string,
    kind: 'dependency' | 'association',
    relation: string,
  ) => {
    if (source === target) return;
    const id = `${kind}:${source}:${target}:${relation}`;
    if (!d.connections.some((e) => e.id === id))
      d.connections.push({ id, source, target, kind, attributes: { label: relation } });
  };
  const value = (item: Item, key: string): unknown =>
    hasSensitive(item.sensitive[key]) || hasSensitive(item.unknown[key])
      ? undefined
      : item.values[key];
  const related = (item: Item, input: unknown, type: string, category: string): string[] => {
    const expected = arr(Array.isArray(input) ? input : [input]).filter(
      (v) => v !== undefined && v !== null,
    );
    const targets = resolve(input).filter((id) => get(id).type === type);
    if (expected.length > targets.length) {
      const message = `${category} の関連先は未解決`;
      const resource = get(item.address);
      if (!resource.unresolved!.includes(message)) resource.unresolved!.push(message);
    }
    return targets;
  };
  // 関連先の ID/ARN/名前は解決だけに使用し、機密値・未確定値・曖昧な候補は公開しない。
  const semanticTarget = (
    item: Item,
    key: string,
    type: string | string[],
    fields = ['id', 'arn', 'name', 'self_link'],
  ): string | undefined => {
    const input = value(item, key);
    if (typeof input !== 'string') return;
    const candidates = items.filter(
      (candidate) =>
        (Array.isArray(type) ? type : [type]).includes(get(candidate.address).type) &&
        (candidate.address === input ||
          fields.some(
            (field) =>
              value(candidate, field) === input &&
              (field !== 'name' ||
                !item.type.startsWith('google_') ||
                (['project', 'region'].every(
                  (scope) =>
                    typeof value(item, scope) === 'string' &&
                    value(item, scope) === value(candidate, scope),
                ) &&
                  (candidate.type !== 'google_compute_router_interface' ||
                    value(item, 'router') === value(candidate, 'router')))),
          )),
    );
    if (candidates.length === 1) return candidates[0]!.address;
    get(item.address).unresolved!.push(
      `${key} の関連先は${candidates.length > 1 ? '候補が複数あり' : ''}未解決`,
    );
    return;
  };
  const topology: Record<string, [string, string | string[], string][]> = {
    aws_organizations_policy_attachment: [
      ['policy_id', 'aws.organization-policy', 'attached-policy'],
      [
        'target_id',
        ['aws.organization-root', 'aws.organizational-unit', 'aws.organization-account'],
        'policy-target（権限付与を示さない）',
      ],
    ],
    aws_ec2_transit_gateway_vpc_attachment: [
      ['transit_gateway_id', 'aws.transit-gateway', 'attached-transit-gateway'],
    ],
    aws_ec2_transit_gateway_route_table: [
      ['transit_gateway_id', 'aws.transit-gateway', 'transit-gateway-route-table'],
    ],
    aws_ec2_transit_gateway_route_table_association: [
      ['transit_gateway_route_table_id', 'aws.tgw-route-table', 'associated-route-table'],
      [
        'transit_gateway_attachment_id',
        ['aws.tgw-attachment', 'aws.vpn-connection'],
        'route-table-association',
      ],
    ],
    aws_ec2_transit_gateway_route_table_propagation: [
      ['transit_gateway_route_table_id', 'aws.tgw-route-table', 'propagation-route-table'],
      [
        'transit_gateway_attachment_id',
        ['aws.tgw-attachment', 'aws.vpn-connection'],
        'route-propagation',
      ],
    ],
    aws_vpn_connection: [
      ['transit_gateway_id', 'aws.transit-gateway', 'vpn-transit-gateway'],
      ['customer_gateway_id', 'aws.customer-gateway', 'customer-gateway'],
    ],
    aws_ram_resource_association: [
      ['resource_share_arn', 'aws.ram-share', 'resource-share'],
      ['resource_arn', 'aws.transit-gateway', 'shared-resource'],
    ],
    aws_ram_principal_association: [['resource_share_arn', 'aws.ram-share', 'principal-share']],
    google_compute_ha_vpn_gateway: [['network', 'network', 'vpn-network']],
    google_compute_router: [['network', 'network', 'router-network']],
    google_compute_vpn_tunnel: [
      ['vpn_gateway', 'gcp.ha-vpn', 'ha-vpn-gateway'],
      ['peer_external_gateway', 'gcp.external-vpn', 'external-vpn-peer'],
      ['router', 'gcp.router', 'tunnel-router'],
    ],
    google_compute_router_interface: [
      ['router', 'gcp.router', 'interface-router'],
      ['vpn_tunnel', 'gcp.vpn-tunnel', 'interface-tunnel'],
    ],
    google_compute_router_peer: [
      ['router', 'gcp.router', 'bgp-router'],
      ['interface', 'gcp.router-interface', 'bgp-interface'],
    ],
  };
  const organizationParents = new Map<string, string>();
  for (const item of items) {
    if (item.type === 'aws_organizations_root') {
      const parent = semanticTarget(item, 'organization', 'aws.organization', ['id']);
      if (parent) organizationParents.set(item.address, parent);
    }
    if (
      ['aws_organizations_organizational_unit', 'aws_organizations_account'].includes(item.type)
    ) {
      const parent = semanticTarget(
        item,
        'parent_id',
        ['aws.organization-root', 'aws.organizational-unit'],
        ['id'],
      );
      if (parent) organizationParents.set(item.address, parent);
      else
        get(item.address).unresolved!.push(
          'Organizationsの所属は未解決（省略時もRoot所属を推測しません）',
        );
    }
  }
  for (const [child, parent] of organizationParents) {
    const seen = new Set([child]);
    let current: string | undefined = parent;
    while (current && !seen.has(current)) {
      seen.add(current);
      current = organizationParents.get(current);
    }
    if (current) get(child).unresolved!.push('Organizationsの所属が循環しているため未解決');
    else get(child).parentId = parent;
  }
  for (const item of items) {
    const resource = get(item.address);
    for (const [key, targetType, label] of topology[item.type] ?? []) {
      const target = semanticTarget(
        item,
        key,
        targetType,
        item.type === 'aws_organizations_policy_attachment'
          ? ['id']
          : key === 'transit_gateway_attachment_id'
            ? ['id', 'transit_gateway_attachment_id']
            : undefined,
      );
      if (target) edge(item.address, target, 'association', label);
    }
    if (item.type === 'aws_ram_principal_association')
      resource.unresolved!.push(
        '共有先principalのアカウント・OU・組織への所属は未解決（値は取り込みません）',
      );
    if (item.type === 'aws_ecs_service') {
      const cluster = semanticTarget(item, 'cluster', 'aws.ecs-cluster');
      if (cluster) resource.parentId = cluster;
      const definition = semanticTarget(item, 'task_definition', 'aws.ecs-task-definition');
      if (definition) edge(item.address, definition, 'dependency', 'task-definition');
    }
    if (
      ['aws_elastic_beanstalk_environment', 'aws_elastic_beanstalk_application_version'].includes(
        item.type,
      )
    ) {
      const application = semanticTarget(item, 'application', 'aws.beanstalk-application');
      if (application) resource.parentId = application;
    }
    if (item.type === 'aws_elastic_beanstalk_environment') {
      // バージョン名はアプリケーション内で一意。別アプリの同名版を結び付けない。
      const version = value(item, 'version_label');
      if (typeof version === 'string') {
        const candidates = items.filter(
          (candidate) =>
            candidate.type === 'aws_elastic_beanstalk_application_version' &&
            value(candidate, 'name') === version &&
            value(candidate, 'application') === value(item, 'application') &&
            typeof value(item, 'application') === 'string',
        );
        if (
          candidates.length === 1 &&
          resource.parentId &&
          get(resource.parentId).type === 'aws.beanstalk-application'
        )
          edge(item.address, candidates[0]!.address, 'dependency', 'application-version');
        else resource.unresolved!.push('version_label の関連先は未解決');
      }
      resource.unresolved!.push('環境が内部生成するリソースと実配置は未取得（DSLで明示可能）');
    }
    for (const target of related(item, value(item, 'vpc_id'), 'vpc', 'VPC')) {
      if (
        get(target).type === 'vpc' &&
        ['subnet', 'sg', 'aws.route-table', 'aws.igw'].includes(resource.type)
      )
        resource.parentId = target;
      else edge(item.address, target, 'association', 'vpc');
    }
    const subnetKeys = item.type === 'aws_instance' ? ['subnet_id'] : ['subnets', 'subnet_ids'];
    const subnets = subnetKeys.flatMap((key) =>
      related(item, value(item, key), 'subnet', 'Subnet'),
    );
    if (item.type === 'aws_ecs_service')
      for (const network of arr(value(item, 'network_configuration')))
        subnets.push(...related(item, obj(network).subnets, 'subnet', 'Subnet'));
    if (subnets.length) {
      resource.attributes.placement = item.type === 'aws_instance' ? 'actual' : 'configuration';
      resource.attributes.subnets = [...new Set(subnets)];
      if (item.type === 'aws_instance' && subnets.length === 1) resource.parentId = subnets[0];
      for (const target of subnets)
        edge(
          item.address,
          target,
          'association',
          item.type === 'aws_instance' ? 'actual-subnet' : 'configured-subnet',
        );
    }
    const groupRefs = ['vpc_security_group_ids', 'security_groups'].flatMap((key) =>
      related(item, value(item, key), 'sg', 'Security Group'),
    );
    if (item.type === 'aws_ecs_service')
      for (const network of arr(value(item, 'network_configuration')))
        groupRefs.push(...related(item, obj(network).security_groups, 'sg', 'Security Group'));
    for (const sg of new Set(groupRefs))
      if (get(sg).type === 'sg') {
        const members = get(sg).attributes.members as string[] | undefined;
        get(sg).attributes.members = [...new Set([...(members ?? []), item.address])];
        edge(item.address, sg, 'association', 'security-group');
      }
    for (const target of item.dependencies)
      if (raw.has(target)) edge(item.address, target, 'dependency', 'terraform-reference');
    if (resource.type === 'subnet') resource.attributes.subnetVisibility = 'unknown';
  }
  // RDS は Subnet Group の設定を参照します。実インスタンスの AZ 配置とは区別します。
  for (const item of items)
    if (item.type === 'aws_db_instance') {
      const name = value(item, 'db_subnet_group_name');
      const candidates = items.filter(
        (candidate) =>
          candidate.type === 'aws_db_subnet_group' &&
          value(candidate, 'name') === name &&
          typeof name === 'string',
      );
      // 名前だけで複数アカウント・リージョンにまたがる候補を選択しません。
      const group = candidates.length === 1 ? candidates[0] : undefined;
      if (group) {
        const subnets = get(group.address).attributes.subnets;
        if (Array.isArray(subnets)) {
          get(item.address).attributes.subnets = [...subnets];
          get(item.address).attributes.placement = 'configuration';
          for (const target of subnets)
            edge(item.address, target, 'association', 'configured-subnet');
        }
        edge(item.address, group.address, 'association', 'subnet-group');
      } else
        get(item.address).unresolved!.push(
          candidates.length > 1
            ? 'DB Subnet Group の候補が複数あり配置設定は未解決'
            : 'DB Subnet Group の配置設定は未解決',
        );
    }
  // Public 判定にはルートテーブル関連と IGW デフォルトルートの両方が必要です。
  const publicTables = new Set<string>();
  const isDefault = (route: Obj) =>
    route.cidr_block === '0.0.0.0/0' ||
    route.destination_cidr_block === '0.0.0.0/0' ||
    route.ipv6_cidr_block === '::/0' ||
    route.destination_ipv6_cidr_block === '::/0';
  const hasIGW = (route: Obj) =>
    resolve(route.gateway_id).some((id) => raw.get(id)?.type === 'aws_internet_gateway');
  for (const item of items) {
    if (
      item.type === 'aws_route_table' &&
      !hasSensitive(item.sensitive.route) &&
      arr(value(item, 'route')).some((r) => isDefault(obj(r)) && hasIGW(obj(r)))
    )
      publicTables.add(item.address);
    if (
      item.type === 'aws_route' &&
      isDefault(item.values) &&
      !hasSensitive(item.sensitive) &&
      !hasSensitive(item.unknown) &&
      hasIGW(item.values)
    )
      for (const table of resolve(value(item, 'route_table_id'))) publicTables.add(table);
  }
  for (const item of items)
    if (item.type === 'aws_route_table_association')
      for (const table of resolve(value(item, 'route_table_id')))
        if (publicTables.has(table))
          for (const subnet of resolve(value(item, 'subnet_id')))
            get(subnet).attributes.subnetVisibility = 'public';
  for (const message of context.sources?.warnings ?? []) warn(d, 'TF_SOURCE', message);
  const safeId = (address: string): string => 'tf_' + Buffer.from(address, 'utf8').toString('hex');
  for (const resource of d.resources) {
    resource.id = safeId(resource.id);
    if (resource.parentId) resource.parentId = safeId(resource.parentId);
    for (const key of ['subnets', 'members'])
      if (Array.isArray(resource.attributes[key]))
        resource.attributes[key] = (resource.attributes[key] as string[]).map(safeId);
  }
  for (const connection of d.connections) {
    connection.id = safeId(connection.id);
    connection.source = safeId(connection.source);
    connection.target = safeId(connection.target);
  }
  return d;
}
export function importTerraformJSON(input: unknown, context: TerraformContext = {}): Diagram {
  const document = obj(input);
  if (!/^1\./.test(str(document.format_version) ?? ''))
    throw new Error('対応する Terraform show JSON format_version は 1.x です。');
  const kind =
    document.planned_values !== undefined || document.resource_changes !== undefined
      ? 'plan'
      : document.values !== undefined
        ? 'state'
        : undefined;
  if (!kind)
    throw new Error(
      'Terraform plan/state の show -json 形式が必要です。raw tfstate は未対応です。',
    );
  const changes = new Map(
    arr(document.resource_changes).map((r) => [str(obj(r).address), obj(obj(r).change)]),
  );
  const items: Item[] = [];
  const walk = (module: Obj): void => {
    for (const entry of arr(module.resources)) {
      const resource = obj(entry);
      if (typeof resource.address !== 'string' || typeof resource.type !== 'string') continue;
      const change = changes.get(resource.address) ?? {};
      items.push({
        address: resource.address,
        type: resource.type,
        values: obj(resource.values),
        sensitive:
          resource.sensitive_values === true || change.after_sensitive === true
            ? Object.fromEntries(Object.keys(obj(resource.values)).map((key) => [key, true]))
            : Object.fromEntries(
                [
                  ...new Set([
                    ...Object.keys(obj(resource.sensitive_values)),
                    ...Object.keys(obj(change.after_sensitive)),
                  ]),
                ].map((key) => [
                  key,
                  hasSensitive(obj(resource.sensitive_values)[key]) ||
                    hasSensitive(obj(change.after_sensitive)[key]),
                ]),
              ),
        unknown:
          change.after_unknown === true
            ? Object.fromEntries(
                [...new Set([...Object.keys(safe), ...Object.keys(obj(resource.values))])].map(
                  (key) => [key, true],
                ),
              )
            : obj(change.after_unknown),
        dependencies: arr(resource.depends_on).filter((v): v is string => typeof v === 'string'),
      });
    }
    for (const child of arr(module.child_modules)) walk(obj(child));
  };
  walk(obj(obj(kind === 'plan' ? document.planned_values : document.values).root_module));
  // configuration の参照は依存です。通信の根拠にはしません。
  const config = (module: Obj, prefix = ''): void => {
    for (const entry of arr(module.resources)) {
      const r = obj(entry);
      const address = str(r.address);
      if (!address) continue;
      const localAddress = prefix + address;
      const matches = items.filter((i) => definitionAddress(i.address) === localAddress);
      for (const item of matches) {
        item.provider = str(r.provider_config_key);
        for (const expression of Object.values(obj(r.expressions)))
          for (const ref of arr(obj(expression).references))
            if (typeof ref === 'string') {
              const qualified = prefix + ref;
              const targets = items.filter(
                (t) => qualified === t.address || qualified.startsWith(t.address + '.'),
              );
              for (const target of targets) item.dependencies.push(target.address);
            }
      }
    }
    for (const [name, call] of Object.entries(obj(module.module_calls)))
      config(obj(obj(call).module), prefix + 'module.' + name + '.');
  };
  config(obj(obj(document.configuration).root_module));
  return build(items, kind, context);
}
async function readCommit(repository: string): Promise<string | undefined> {
  const validHash = (candidate: string | undefined): string | undefined =>
    candidate && /^[a-f\d]{40,64}$/.test(candidate) ? candidate : undefined;
  try {
    let gitdir = path.join(repository, '.git');
    try {
      const pointer = await readFile(gitdir, 'utf8');
      if (pointer.startsWith('gitdir: '))
        gitdir = path.resolve(repository, pointer.slice(8).trim());
    } catch {
      /* 通常のディレクトリ */
    }
    const head = (await readFile(path.join(gitdir, 'HEAD'), 'utf8')).trim();
    if (validHash(head)) return head;
    if (!head.startsWith('ref: ')) return;
    const ref = head.slice(5);
    // Git ref は相対パスの traversal と制御文字を許容しません。
    if (
      !/^refs\/[A-Za-z0-9._/-]+$/.test(ref) ||
      ref.split('/').some((part) => !part || part === '.' || part === '..')
    )
      return;
    try {
      return validHash((await readFile(path.join(gitdir, ref), 'utf8')).trim());
    } catch {
      /* common dir または packed refs を確認 */
    }
    const common = await readFile(path.join(gitdir, 'commondir'), 'utf8').catch(() => '.');
    const commonDir = path.resolve(gitdir, common.trim());
    try {
      return validHash((await readFile(path.join(commonDir, ref), 'utf8')).trim());
    } catch {
      /* packed refs を確認 */
    }
    const packed = await readFile(path.join(commonDir, 'packed-refs'), 'utf8');
    return validHash(
      packed
        .split('\n')
        .find((line) => line.endsWith(' ' + ref))
        ?.split(' ')[0],
    );
  } catch {
    /* Git メタデータなし */
  }
  return;
}
export async function importTerraformRepository(
  options: TerraformRepositoryOptions,
): Promise<Diagram> {
  const repository = path.resolve(options.repository);
  const root = options.root ?? '.';
  const sources = await readSources(repository, root);
  const context = { repository, root, commit: await readCommit(repository), sources };
  if (options.json) {
    let data: unknown;
    try {
      data = JSON.parse(await readFile(path.resolve(repository, options.json), 'utf8'));
    } catch {
      throw new Error(
        'Terraform JSON ファイルを読み取れません。ファイル内容は安全のため表示しません。',
      );
    }
    return importTerraformJSON(data, context);
  }
  const items: Item[] = [];
  for (const def of sources.definitions.values()) {
    const values: Obj = {};
    const dependencies: string[] = [];
    const unknown: Obj = {};
    for (const [key, expression] of Object.entries(def.attributes)) {
      const literal = staticLiteral(expression);
      if (literal !== undefined) values[key] = literal;
      else {
        unknown[key] = true;
        const refs =
          expression.match(
            /(?:module\.[\w-]+\.)?(?:(?:aws|google)_[\w]+|data\.(?:aws|google)_[\w]+)\.[\w-]+/g,
          ) ?? [];
        for (const ref of refs) {
          const prefix = modulePrefix(def.address);
          const target = (prefix ? prefix + '.' : '') + ref;
          if (sources.definitions.has(target)) {
            dependencies.push(target);
            if (
              !sources.definitions.get(target)?.repeated &&
              (!['parent_id', 'policy_id', 'target_id'].includes(key) ||
                /^aws_organizations_(?:organization\.[\w-]+\.roots\[0\]|(?:organizational_unit|account|policy)\.[\w-]+)\.id$/.test(
                  expression.trim(),
                )) &&
              [
                'vpc_id',
                'subnet_id',
                'subnets',
                'subnet_ids',
                'vpc_security_group_ids',
                'security_groups',
                'gateway_id',
                'route_table_id',
                'cluster',
                'task_definition',
                'application',
                'parent_id',
                'policy_id',
                'target_id',
                'customer_gateway_id',
                'interface',
                'network',
                'peer_external_gateway',
                'resource_arn',
                'resource_share_arn',
                'router',
                'transit_gateway_attachment_id',
                'transit_gateway_id',
                'transit_gateway_route_table_id',
                'vpn_gateway',
                'vpn_tunnel',
              ].includes(key)
            ) {
              values[key] = expression.trim().startsWith('[')
                ? [...arr(values[key]), target]
                : ['parent_id', 'target_id'].includes(key) &&
                    /^aws_organizations_organization\.[\w-]+\.roots\[0\]\.id$/.test(
                      expression.trim(),
                    )
                  ? target + '.roots[0]'
                  : target;
              delete unknown[key];
            }
          }
        }
      }
    }
    items.push({
      address: def.address,
      type: def.type,
      values,
      sensitive: {},
      unknown,
      dependencies,
      provider: def.attributes.provider,
    });
  }
  const d = build(items, 'static', context);
  for (const resource of d.resources)
    if (sources.definitions.get(resource.provenance?.address ?? '')?.repeated)
      resource.unresolved!.push('count / for_each の実体は未解決（plan JSON が必要）');
  warn(
    d,
    'TF_STATIC',
    '静的取り込みは literal 属性と直接参照のみ。変数、関数、dynamic、実体展開は plan JSON で確認してください。',
  );
  return d;
}
