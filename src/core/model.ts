export type Attribute = string | number | boolean | string[];
export type Attributes = Record<string, Attribute>;
export interface SourceLocation {
  file?: string;
  line: number;
  column: number;
}
export interface Diagnostic extends SourceLocation {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}
export interface Provenance {
  kind: 'design' | 'plan' | 'state' | 'static';
  repository?: string;
  commit?: string;
  root?: string;
  address?: string;
  file?: string;
  line?: number;
}
export interface Resource {
  id: string;
  type: string;
  label: string;
  parentId?: string;
  attributes: Attributes;
  location?: SourceLocation;
  provenance?: Provenance;
  unresolved?: string[];
}
export const edgeKinds = [
  'traffic',
  'dependency',
  'auth',
  'deploy',
  'association',
  'replication',
  'failover',
] as const;
export type EdgeKind = (typeof edgeKinds)[number];
export const edgeKindLabels: Record<EdgeKind, string> = {
  traffic: '通信',
  dependency: '依存',
  auth: '認証',
  deploy: 'デプロイ',
  association: '関連',
  replication: '複製',
  failover: '切替',
};
export const telemetrySignals = ['metrics', 'logs', 'traces'] as const;
export const telemetrySignalLabels: Record<string, string> = {
  metrics: 'メトリクス',
  logs: 'ログ',
  traces: 'トレース',
};
export function isTelemetrySignals(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (signal) =>
        typeof signal === 'string' && (telemetrySignals as readonly string[]).includes(signal),
    )
  );
}
export interface Connection {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  attributes: Attributes;
  location?: SourceLocation;
}
export interface View {
  id: string;
  label?: string;
  level: 'overview' | 'service' | 'subnet' | 'resource';
  overlay?: string;
  direction?: 'RIGHT' | 'DOWN';
  kinds?: EdgeKind[];
  routes?: string[];
  purposes?: string[];
}
export interface Diagram {
  version: 1;
  title: string;
  resources: Resource[];
  connections: Connection[];
  views: View[];
  diagnostics: Diagnostic[];
}
export interface ParseResult {
  diagram?: Diagram;
  diagnostics: Diagnostic[];
}
export interface DisplayOptions {
  view?: string;
  level?: View['level'];
  showSG?: boolean;
  collapsed?: string[];
  expanded?: string[];
  direction?: 'RIGHT' | 'DOWN';
  kinds?: EdgeKind[];
  routes?: string[];
  purposes?: string[];
}
export interface DisplayGraph {
  resources: Resource[];
  connections: (Connection & { originalIds: string[] })[];
  representative: Record<string, string>;
  collapsed: string[];
  overlays?: Resource[];
  notes?: Resource[];
}
export interface Placement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string;
  contentTop?: number;
}
export interface EdgeRoute {
  id: string;
  points: { x: number; y: number }[];
  label?: { x: number; y: number };
  labelAnchor?: { x: number; y: number };
}
export interface LayoutResult {
  compact?: boolean;
  nodes: Placement[];
  edges?: EdgeRoute[];
  durationMs: number;
  version: string;
  overlays?: (Placement & {
    label: string;
    members: string[];
    labelX?: number;
    labelY?: number;
    labelWidth?: number;
    labelHeight?: number;
  })[];
  annotations?: (Placement & { label: string; text: string; anchor?: { x: number; y: number } })[];
}
export const boundaryTypes = new Set([
  'account',
  'project',
  'subscription',
  'region',
  'vpc',
  'network',
  'subnet',
  'group',
  'collection',
  'site',
  'rack',
  'namespace',
  'cluster',
  'zone',
  'module',
  'aws.organization',
  'aws.organization-root',
  'aws.organizational-unit',
  'aws.organization-account',
  'aws.eks',
  'aws.eks-cluster',
  'aws.eks-node-group',
  'aws.eks-fargate-profile',
  'k8s.namespace',
  'k8s.deployment',
  'aws.ecs-cluster',
  'aws.ecs-service',
  'aws.ecs-task-definition',
  'aws.ecs-task',
  'aws.beanstalk-application',
  'aws.beanstalk-environment',
]);
export const isBoundary = (resource: Resource): boolean =>
  boundaryTypes.has(resource.type) || resource.attributes.boundary === true;
