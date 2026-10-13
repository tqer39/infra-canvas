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
export type EdgeKind = 'traffic' | 'dependency' | 'auth' | 'deploy' | 'association';
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
  level: 'overview' | 'service' | 'subnet' | 'resource';
  overlay?: string;
  direction?: 'RIGHT' | 'DOWN';
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
  collapsed?: string[];
  expanded?: string[];
  direction?: 'RIGHT' | 'DOWN';
}
export interface DisplayGraph {
  resources: Resource[];
  connections: (Connection & { originalIds: string[] })[];
  representative: Record<string, string>;
  collapsed: string[];
}
export interface Placement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId?: string;
}
export interface EdgeRoute {
  id: string;
  points: { x: number; y: number }[];
  label?: { x: number; y: number };
}
export interface LayoutResult {
  nodes: Placement[];
  edges?: EdgeRoute[];
  durationMs: number;
  version: string;
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
  'module',
  'aws.organization',
  'aws.organization-root',
  'aws.organizational-unit',
  'aws.organization-account',
  'aws.ecs-cluster',
  'aws.ecs-service',
  'aws.ecs-task-definition',
  'aws.ecs-task',
  'aws.beanstalk-application',
  'aws.beanstalk-environment',
]);
export const isBoundary = (resource: Resource): boolean => boundaryTypes.has(resource.type);
