import {
  resourceTypeLabel,
  resourceAppearance,
  exposureLabels,
  evidenceLabels,
  changeLabels,
} from '../core/presentation';
import { renderSVG, printDocument, type PrintOptions } from '../core/static-svg';
import expressionSource from '../../examples/expressions.infra?raw';
import architectureSource from '../../examples/architecture.infra?raw';
import subnetSecuritySource from '../../examples/subnet-security.infra?raw';
import { ChatPanel } from './ChatPanel';
import {
  absolutePlacements,
  bridgePath,
  curvedRoutePath,
  nearestPathPoint,
} from '../core/geometry';
import { resourceMetadata } from '../core/resource-metadata';
import { resourceContent } from '../core/content';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  ViewportPortal,
  Position,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getBezierPath,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style.css';
import { parseDSL } from '../core/parser';
import { validateDiagram } from '../core/validate.js';
import { serializeDSL } from '../core/serialize';
import { buildDisplayGraph } from '../core/display';
import { layoutGraph, connectionLabel } from '../core/layout';
import { telemetrySignalLabels as signalLabels } from '../core/model';
import {
  edgeKinds,
  type EdgeKind,
  isBoundary,
  type Diagram,
  type Resource,
  type DisplayGraph,
  type LayoutResult,
} from '../core/model';
import { getIcon, getIconHomepage, getIconTypes } from '../assets/icons';
import { getResourceIconType } from '../assets/resource-icons';
import { getCountryFlag } from '../assets/flags';
import { getRegionCountry, getResourceRegion } from '../assets/regions';
import defaultSource from '../../examples/aws.infra?raw';

declare global {
  interface Window {
    __INFRA_CANVAS__?: Diagram;
  }
}
type ResourceData = Record<string, unknown> & {
  resource: Resource;
  collapsed: boolean;
  iconType: string;
  onToggle: (id: string) => void;
  related: boolean;
  muted: boolean;
  contentTop?: number;
};
type ResourceNode = Node<ResourceData>;
const kindLabels: Record<string, string> = {
  traffic: '通信',
  dependency: '依存',
  auth: '認証',
  deploy: 'デプロイ',
  association: '関連',
  replication: '複製',
  failover: '切替',
};
const kindColors: Record<string, string> = {
  traffic: '#55749a',
  dependency: '#8b93a3',
  auth: '#ad7633',
  deploy: '#8165b0',
  association: '#258d81',
  replication: '#287ca0',
  failover: '#bb5d43',
};
const viewLabels: Record<string, string> = {
  overview: '概要',
  service: 'サービス',
  network: 'ネットワーク',
  security: 'セキュリティ',
};

function RegionFlag({ resource }: { resource: Resource }) {
  const region = getResourceRegion(resource);
  const country = getRegionCountry(region);
  if (!country) return null;
  return (
    <img
      className="region-flag"
      width={20}
      height={15}
      src={getCountryFlag(country.code)}
      alt={`${country.name}の国旗`}
      title={`${country.name} · ${region}`}
    />
  );
}

function ResourceCard({ data }: NodeProps<ResourceNode>) {
  const { resource, collapsed, onToggle, related, muted } = data;
  const boundary = isBoundary(resource);
  const icon = getIcon(data.iconType);
  const homepage = getIconHomepage(resource.type);
  const content = resourceContent(resource);
  const metadata = resourceMetadata(resource);
  return (
    <div
      style={resourceAppearance(resource)}
      data-evidence={String(resource.attributes.evidence ?? '')}
      data-change={String(resource.attributes.change ?? '')}
      data-exposure={String(
        resource.attributes.exposure ??
          resource.attributes.subnetVisibility ??
          resource.attributes.subnetType ??
          '',
      )}
      data-appearance={String(resource.attributes.appearance ?? 'default')}
      className={`resource-card ${boundary && !collapsed ? 'boundary-card' : ''} ${boundary && resource.type.startsWith('aws.') ? 'detail-boundary-card' : ''} ${collapsed ? 'collapsed-card' : ''} ${related ? 'related' : ''} ${muted ? 'muted' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      {Array.isArray(resource.attributes.ports) &&
        resource.attributes.ports.map((port, index, ports) => (
          <span key={port}>
            <Handle
              type="target"
              position={Position.Left}
              className="interface-handle"
              id={`target:${port}`}
              style={{ top: `${((index + 1) / (ports.length + 1)) * 100}%` }}
              title={port}
            />
            <Handle
              type="source"
              position={Position.Right}
              className="interface-handle"
              id={`source:${port}`}
              style={{ top: `${((index + 1) / (ports.length + 1)) * 100}%` }}
              title={port}
            />
          </span>
        ))}
      <div className="resource-heading">
        {icon ? (
          homepage ? (
            <a
              className="service-icon-link nodrag nopan"
              href={homepage}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Fly.io 公式サイトを開く"
              onClick={(event) => event.stopPropagation()}
            >
              <img className="service-icon" src={icon} alt="" />
            </a>
          ) : (
            <img className="service-icon" src={icon} alt="" />
          )
        ) : (
          <span className={`fallback-icon ${boundary ? 'boundary-icon' : ''}`} aria-hidden="true">
            {boundary ? '▦' : '◇'}
          </span>
        )}
        <div className="resource-text">
          <span className="resource-type">{resourceTypeLabel(resource)}</span>
          <span className="resource-label">
            <RegionFlag resource={resource} />
            {homepage ? (
              <a
                className="service-name-link nodrag nopan"
                href={homepage}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <strong title={resource.label}>{resource.label}</strong>
              </a>
            ) : (
              <strong title={resource.label}>{resource.label}</strong>
            )}
          </span>
        </div>
        {boundary && (
          <button
            className="boundary-toggle nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(resource.id);
            }}
            title={collapsed ? '展開' : '折りたたむ'}
            aria-label={`${resource.label}を${collapsed ? '展開' : '折りたたむ'}`}
          >
            {collapsed ? '+' : '−'}
          </button>
        )}
      </div>
      {metadata.length > 0 && (
        <dl className="resource-metadata nodrag nopan" aria-label={`${resource.label}の識別情報`}>
          {metadata.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {content?.kind === 'table' && (
        <table className="resource-content" aria-label={resource.label}>
          <thead>
            <tr>
              {content.columns.map((column, index) => (
                <th key={index}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={column}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {content?.kind === 'list' && (
        <ul className="resource-content resource-list" aria-label={resource.label}>
          {content.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
      {collapsed && <span className="collapsed-hint">折りたたみ中</span>}
      {resource.unresolved?.length ? (
        <span className="unresolved-badge" title={resource.unresolved.join(' / ')}>
          未解決 {resource.unresolved.length}
        </span>
      ) : null}
    </div>
  );
}
function AnnotationCard({ data }: NodeProps<ResourceNode>) {
  return (
    <aside className="annotation-card" data-note-id={data.resource.id}>
      <strong>{data.resource.label}</strong>
      <p>{String(data.resource.attributes.description ?? '')}</p>
    </aside>
  );
}
const nodeTypes = { resource: ResourceCard, annotation: AnnotationCard };
type RouteData = {
  points: { x: number; y: number }[];
  label?: { x: number; y: number };
  labelAnchor?: { x: number; y: number };
};
function RoutedConnection(props: EdgeProps) {
  const route = props.data?.route as RouteData | undefined;
  const curved = props.data?.edgeShape === 'bezier';
  const fallback = curved ? getBezierPath(props) : getSmoothStepPath(props);
  const path = route?.points.length
    ? curved
      ? curvedRoutePath(
          route.points,
          (props.data?.curveObstacles ?? []) as {
            x: number;
            y: number;
            width: number;
            height: number;
          }[],
          Number(props.data?.parallelOffset ?? 0),
        )
      : String(props.data?.routedPath ?? bridgePath(route.points, []))
    : fallback[0];
  const labelPosition = route?.label ?? { x: fallback[1], y: fallback[2] };
  const curveAnchor = curved ? nearestPathPoint(path, labelPosition) : undefined;
  const labelAnchor = curved
    ? curveAnchor &&
      Math.hypot(curveAnchor.x - labelPosition.x, curveAnchor.y - labelPosition.y) > 16
      ? curveAnchor
      : undefined
    : route?.labelAnchor;
  const select = props.data?.onSelect as ((id: string) => void) | undefined;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        markerStart={props.markerStart}
        style={props.style}
      />
      {labelAnchor && (
        <path
          d={`M ${labelAnchor.x},${labelAnchor.y} L ${labelPosition.x},${labelPosition.y}`}
          stroke="#97a7b4"
          strokeDasharray="2 3"
          fill="none"
          style={{ pointerEvents: 'none', opacity: props.style?.opacity }}
        />
      )}
      <EdgeLabelRenderer>
        <button
          className="connection-label nodrag nopan"
          style={{
            transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
            opacity: props.style?.opacity,
            zIndex: props.selected ? 11 : 2,
          }}
          aria-label={String(props.data?.accessibleLabel ?? props.label)}
          aria-pressed={props.selected}
          onFocus={() => select?.(props.id)}
          onClick={(event) => {
            event.stopPropagation();
            select?.(props.id);
          }}
        >
          {props.label}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { routed: RoutedConnection };

function App() {
  const initial = useMemo(() => window.__INFRA_CANVAS__ ?? parseDSL(defaultSource).diagram, []);
  const [diagram, setDiagram] = useState<Diagram | undefined>(initial);
  const [source, setSource] = useState(() => (initial ? serializeDSL(initial) : defaultSource));
  const [editorOpen, setEditorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [view, setView] = useState('service');
  const [edgeShape, setEdgeShape] = useState<'orthogonal' | 'bezier'>('orthogonal');
  const [lastLayout, setLastLayout] = useState<LayoutResult>();
  const [exportOpen, setExportOpen] = useState(false);
  const [paper, setPaper] = useState<NonNullable<PrintOptions['paper']>>('A4');
  const [orientation, setOrientation] =
    useState<NonNullable<PrintOptions['orientation']>>('landscape');
  const [exportScale, setExportScale] = useState(1);
  const [printPages, setPrintPages] = useState<NonNullable<PrintOptions['pages']>>('fit');
  const [editLayout, setEditLayout] = useState(false);
  const [showMembership, setShowMembership] = useState(false);
  const [viewDisplayName, setViewDisplayName] = useState('');
  const [overlayBoxes, setOverlayBoxes] = useState<
    NonNullable<import('../core/model').LayoutResult['overlays']>
  >([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterKinds, setFilterKinds] = useState<EdgeKind[] | undefined>();
  const [filterRoute, setFilterRoute] = useState<string | undefined>();
  const [filterPurpose, setFilterPurpose] = useState<string | undefined>();
  const [viewName, setViewName] = useState('');
  const activeView = diagram?.views.find((item) => item.id === view);
  const effectiveKinds = filterKinds ?? activeView?.kinds ?? [...edgeKinds];
  const routes = [
    ...new Set(
      diagram?.connections.flatMap((edge) =>
        typeof edge.attributes.route === 'string' ? [edge.attributes.route] : [],
      ) ?? [],
    ),
  ];
  const purposes = [
    ...new Set(
      diagram?.connections.flatMap((edge) =>
        typeof edge.attributes.purpose === 'string' ? [edge.attributes.purpose] : [],
      ) ?? [],
    ),
  ];
  const changeView = (id: string) => {
    setView(id);
    setFilterKinds(undefined);
    setFilterRoute(undefined);
    setFilterPurpose(undefined);
    setSelectedEdge(undefined);
  };
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [scope, setScope] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [query, setQuery] = useState('');
  const [nodes, setNodes] = useState<ResourceNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [graph, setGraph] = useState<DisplayGraph>();
  const [layoutTime, setLayoutTime] = useState(0);
  const [busy, setBusy] = useState(false);
  const autoFitContext = useRef<{ diagram?: Diagram; view: string; scope?: string } | undefined>(
    undefined,
  );
  const pendingFocus = useRef<{ id: string; previousGraph?: DisplayGraph } | undefined>(undefined);
  const measurementFrame = useRef<number | undefined>(undefined);
  const pendingMeasurements = useRef<NodeChange<ResourceNode>[]>([]);
  const onNodesChange = useCallback((changes: NodeChange<ResourceNode>[]) => {
    pendingMeasurements.current.push(
      ...changes.filter((change) => change.type === 'dimensions' || change.type === 'position'),
    );
    if (measurementFrame.current !== undefined || pendingMeasurements.current.length === 0) return;
    measurementFrame.current = requestAnimationFrame(() => {
      const measurements = pendingMeasurements.current;
      pendingMeasurements.current = [];
      measurementFrame.current = undefined;
      setNodes((current) => applyNodeChanges(measurements, current));
    });
  }, []);
  useEffect(
    () => () => {
      if (measurementFrame.current !== undefined) cancelAnimationFrame(measurementFrame.current);
    },
    [],
  );
  const flow = useReactFlow<ResourceNode>();
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        !(event.target instanceof Element) ||
        !event.target.closest('.react-flow')
      )
        return;
      const horizontal = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!horizontal) return;
      event.preventDefault();
      event.stopPropagation();
      const pixels =
        horizontal * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1);
      const viewport = flow.getViewport();
      void flow.setViewport({ ...viewport, x: viewport.x - pixels });
    };
    element.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => element.removeEventListener('wheel', onWheel, { capture: true });
  }, [flow]);
  const selectConnection = useCallback((id: string) => {
    setSelected(undefined);
    setSelectedEdge(id);
  }, []);
  const upload = useRef<HTMLInputElement>(null);
  const graphRef = useRef<DisplayGraph | undefined>(undefined);
  graphRef.current = graph;
  const toggle = useCallback((id: string) => {
    const isCollapsed = graphRef.current?.collapsed.includes(id) ?? false;
    setCollapsed((current) =>
      isCollapsed ? current.filter((item) => item !== id) : [...current, id],
    );
    setExpanded((current) =>
      isCollapsed ? [...new Set([...current, id])] : current.filter((item) => item !== id),
    );
  }, []);
  const visibleDiagram = useMemo(() => {
    if (!diagram || !scope) return diagram;
    const ids = new Set([scope]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const resource of diagram.resources)
        if (resource.parentId && ids.has(resource.parentId) && !ids.has(resource.id)) {
          ids.add(resource.id);
          changed = true;
        }
    }
    return {
      ...diagram,
      resources: diagram.resources
        .filter(
          (resource) =>
            ids.has(resource.id) || resource.type === 'overlay' || resource.type === 'note',
        )
        .map((resource) =>
          resource.type === 'note'
            ? { ...resource, parentId: undefined }
            : resource.type === 'overlay'
              ? {
                  ...resource,
                  attributes: {
                    ...resource.attributes,
                    members: (resource.attributes.members as string[]).filter((id) => ids.has(id)),
                  },
                }
              : resource.id === scope
                ? { ...resource, parentId: undefined }
                : resource,
        ),
      connections: diagram.connections.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
    };
  }, [diagram, scope]);
  const boundaryIds = useMemo(
    () => visibleDiagram?.resources.filter(isBoundary).map((resource) => resource.id) ?? [],
    [visibleDiagram],
  );
  const setAllBoundaries = (collapse: boolean) => {
    const ids = new Set(boundaryIds);
    pendingFocus.current = undefined;
    setSelected(undefined);
    setSelectedEdge(undefined);
    setHovered(undefined);
    setQuery('');
    setCollapsed((current) =>
      collapse ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.has(id)),
    );
    setExpanded((current) =>
      collapse ? current.filter((id) => !ids.has(id)) : [...new Set([...current, ...ids])],
    );
  };
  useEffect(() => {
    if (!visibleDiagram) return;
    let active = true;
    setBusy(true);
    const display = buildDisplayGraph(
      {
        ...visibleDiagram,
        views: visibleDiagram.views.map((item) =>
          item.id !== view
            ? item
            : {
                ...item,
                ...(filterRoute === '' ? { routes: undefined } : {}),
                ...(filterPurpose === '' ? { purposes: undefined } : {}),
              },
        ),
      },
      {
        view,
        collapsed,
        expanded,
        kinds: filterKinds,
        routes: filterRoute === undefined ? undefined : filterRoute ? [filterRoute] : undefined,
        purposes:
          filterPurpose === undefined ? undefined : filterPurpose ? [filterPurpose] : undefined,
      },
    );
    layoutGraph(display, {
      direction: visibleDiagram.views.find((item) => item.id === view)?.direction,
    })
      .then((layout) => {
        if (!active) return;
        const originalResources = new Map(
          diagram?.resources.map((resource) => [resource.id, resource]),
        );
        const placements = new Map(layout.nodes.map((node) => [node.id, node]));
        const routes = new Map((layout.edges ?? []).map((edge) => [edge.id, edge]));
        const sorted = [...display.resources];
        const depth = (resource: Resource): number => {
          let count = 0;
          let parent = resource.parentId;
          const visited = new Set<string>();
          while (parent && !visited.has(parent)) {
            visited.add(parent);
            count++;
            parent = display.resources.find((item) => item.id === parent)?.parentId;
          }
          return count;
        };
        sorted.sort((a, b) => depth(a) - depth(b));
        setLastLayout(layout);
        setOverlayBoxes(layout.overlays ?? []);
        const annotationNodes: ResourceNode[] = (layout.annotations ?? []).map((note) => ({
          id: note.id,
          type: 'annotation',
          position: { x: note.x, y: note.y },
          width: note.width,
          height: note.height,
          measured: { width: note.width, height: note.height },
          style: { width: note.width, height: note.height },
          draggable: false,
          data: {
            resource: display.notes!.find((resource) => resource.id === note.id)!,
            iconType: 'note',
            collapsed: false,
            related: false,
            muted: false,
            onToggle: toggle,
          },
        }));
        setNodes([
          ...sorted.map((resource) => {
            const placement = placements.get(resource.id)!;
            return {
              id: resource.id,
              type: 'resource',
              position: { x: placement.x, y: placement.y },
              parentId: placement.parentId,
              extent: placement.parentId ? ('parent' as const) : undefined,
              draggable: editLayout && !scope,
              width: placement.width,
              height: placement.height,
              measured: {
                width: Math.round(placement.width),
                height: Math.round(placement.height),
              },
              style: { width: placement.width, height: placement.height },
              data: {
                resource,
                contentTop: placement.contentTop,
                iconType: getResourceIconType(resource, originalResources),
                collapsed: display.collapsed.includes(resource.id),
                onToggle: toggle,
                related: false,
                muted: false,
              },
            };
          }),
          ...annotationNodes,
        ]);
        setEdges(
          display.connections.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.attributes.sourcePort
              ? `source:${edge.attributes.sourcePort}`
              : undefined,
            targetHandle: edge.attributes.targetPort
              ? `target:${edge.attributes.targetPort}`
              : undefined,
            label: connectionLabel(edge),
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color:
                edge.attributes.change === 'add'
                  ? '#258454'
                  : edge.attributes.change === 'remove'
                    ? '#ad4848'
                    : edge.attributes.change === 'modify'
                      ? '#b27616'
                      : kindColors[edge.kind],
            },
            style: {
              stroke:
                edge.attributes.change === 'add'
                  ? '#258454'
                  : edge.attributes.change === 'remove'
                    ? '#ad4848'
                    : edge.attributes.change === 'modify'
                      ? '#b27616'
                      : kindColors[edge.kind],
              strokeWidth: 1.7,
              strokeDasharray:
                edge.attributes.change === 'remove' ||
                edge.attributes.change === 'add' ||
                edge.attributes.change === 'modify' ||
                edge.kind === 'failover'
                  ? '8 5'
                  : edge.kind === 'dependency'
                    ? '5 4'
                    : edge.kind === 'association'
                      ? '2 4'
                      : undefined,
            },
            labelStyle: { fill: '#4a5870', fontSize: 10 },
            labelBgStyle: { fill: '#fff', fillOpacity: 0.95 },
            labelBgPadding: [5, 3] as [number, number],
            type: 'routed',
            data: { route: routes.get(edge.id) },
          })),
        );
        setGraph(display);
        setLayoutTime(layout.durationMs);
        setBusy(false);
      })
      .catch((error: unknown) => {
        if (active) {
          setBusy(false);
          setDiagnostics([
            `配置に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
          ]);
        }
      });
    return () => {
      active = false;
    };
  }, [
    diagram,
    visibleDiagram,
    view,
    collapsed,
    expanded,
    toggle,
    filterKinds,
    filterRoute,
    filterPurpose,
    editLayout,
  ]);
  useEffect(() => {
    if (!graph || !nodes.length) return;
    const previous = autoFitContext.current;
    if (
      previous &&
      previous.diagram === diagram &&
      previous.view === view &&
      previous.scope === scope
    )
      return;
    // 図・表示目的・ドリルダウンを変えたときだけ全体表示する。
    // 境界の再配置では、ユーザーが操作したパンとズームを維持する。
    const context = { diagram, view, scope };
    if (pendingFocus.current) {
      autoFitContext.current = context;
      return;
    }
    const frame = requestAnimationFrame(() => {
      autoFitContext.current = context;
      void flow.fitView({ padding: 0.14, duration: 250 });
    });
    return () => cancelAnimationFrame(frame);
  }, [graph, flow]);
  const activeId = selected ?? hovered;
  const clearSelection = () => {
    setSelected(undefined);
    setSelectedEdge(undefined);
    setHovered(undefined);
  };
  const selectedConnection = graph?.connections.find(
    (edge) => edge.id === selectedEdge || edge.originalIds.includes(selectedEdge ?? ''),
  );
  const selectionActive = Boolean(selected || selectedConnection);
  const focus = activeId ? (graph?.representative[activeId] ?? activeId) : undefined;
  const related = useMemo(() => {
    const ids = new Set<string>();
    if (selectedConnection) {
      ids.add(selectedConnection.source);
      ids.add(selectedConnection.target);
      return ids;
    }
    if (focus) {
      ids.add(focus);
      const boundary = graph?.resources.find((resource) => resource.id === focus);
      if (boundary && isBoundary(boundary)) {
        const children = new Map<string, string[]>();
        graph?.resources.forEach((resource) => {
          if (!resource.parentId) return;
          const members = children.get(resource.parentId) ?? [];
          members.push(resource.id);
          children.set(resource.parentId, members);
        });
        const pending = [focus];
        while (pending.length) {
          for (const id of children.get(pending.pop()!) ?? []) {
            if (ids.has(id)) continue;
            ids.add(id);
            pending.push(id);
          }
        }
      }
      graph?.connections.forEach((edge) => {
        if (edge.source === focus || edge.target === focus) {
          ids.add(edge.source);
          ids.add(edge.target);
        }
      });
    }
    return ids;
  }, [focus, graph, selectedConnection]);
  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected:
          node.id === (selected ? (graph?.representative[selected] ?? selected) : undefined),
        data: {
          ...node.data,
          related: related.has(node.id),
          muted: selectionActive && !related.has(node.id) && !isBoundary(node.data.resource),
        },
      })),
    [nodes, selected, related, selectionActive, graph],
  );
  const curveObstacles = useMemo(
    () =>
      lastLayout
        ? [...absolutePlacements(lastLayout.nodes).values()].map((node) => ({
            ...node,
            height: node.contentTop ?? node.height,
          }))
        : [],
    [lastLayout],
  );
  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const parallel = edges.filter(
          (other) => other.source === edge.source && other.target === edge.target,
        );
        const match = selectedConnection
          ? edge.id === selectedConnection.id
          : edge.source === focus ||
            edge.target === focus ||
            (Boolean(
              graph?.resources.some((resource) => resource.id === focus && isBoundary(resource)),
            ) &&
              related.has(edge.source) &&
              related.has(edge.target));
        return {
          ...edge,
          selected: edge.id === selectedConnection?.id,
          data: {
            ...edge.data,
            edgeShape,
            curveObstacles: [
              ...curveObstacles.map((node) =>
                node.id === edge.source || node.id === edge.target
                  ? {
                      ...node,
                      x: node.x + 3,
                      y: node.y + 3,
                      width: node.width - 6,
                      height: node.height - 6,
                    }
                  : node,
              ),
              ...(lastLayout?.annotations ?? []),
            ],
            parallelOffset:
              (parallel.findIndex((other) => other.id === edge.id) - (parallel.length - 1) / 2) *
              64,
            routedPath: bridgePath(
              (edge.data?.route as RouteData | undefined)?.points ?? [],
              edges
                .filter((other) => other.id.localeCompare(edge.id, 'en') < 0)
                .map((other) => (other.data?.route as RouteData | undefined)?.points ?? []),
            ),
            onSelect: selectConnection,
            accessibleLabel: `${graph?.resources.find((resource) => resource.id === edge.source)?.label ?? edge.source} → ${graph?.resources.find((resource) => resource.id === edge.target)?.label ?? edge.target}: ${edge.label}`,
          },
          zIndex: 1,
          style: {
            ...edge.style,
            strokeWidth: match ? 2.2 : 1.7,
            opacity: selectionActive && !match ? 0.45 : 1,
          },
        };
      }),
    [
      edges,
      focus,
      related,
      selectedConnection,
      selectConnection,
      graph,
      selectionActive,
      edgeShape,
      lastLayout,
      curveObstacles,
    ],
  );
  const selectedResource = diagram?.resources.find((resource) => resource.id === selected);
  const selectedRelations = [
    ...(diagram?.connections ?? []),
    ...(graph?.connections.filter(
      (edge) => !diagram?.connections.some((original) => original.id === edge.id),
    ) ?? []),
  ].filter((edge) => edge.source === selected || edge.target === selected);
  const matches = query.trim()
    ? (diagram?.resources
        .filter(
          (resource) =>
            resource.type !== 'overlay' &&
            resource.type !== 'note' &&
            `${resource.id} ${resource.label} ${resource.type}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .slice(0, 40) ?? [])
    : [];
  const focusResource = (id: string) => {
    setSelectedEdge(undefined);
    setSelected(id);
    setQuery('');
    pendingFocus.current = { id, previousGraph: graph };
    setScope(undefined);
    const ancestors = new Set<string>();
    let resource = diagram?.resources.find((item) => item.id === id);
    while (resource?.parentId && !ancestors.has(resource.parentId)) {
      ancestors.add(resource.parentId);
      resource = diagram?.resources.find((item) => item.id === resource!.parentId);
    }
    setCollapsed((current) => current.filter((ancestor) => !ancestors.has(ancestor)));
    setExpanded((current) => [...new Set([...current, ...ancestors])]);
    if (diagram?.resources.find((item) => item.id === id)?.type === 'sg') setView('security');
  };
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || graph === pending.previousGraph) return;
    const representative = pending.id;
    if (nodes.some((node) => node.id === representative)) {
      const frame = requestAnimationFrame(() => {
        void flow.fitView({
          nodes: [{ id: representative }],
          padding: 0.7,
          maxZoom: 1.2,
          duration: 450,
        });
        pendingFocus.current = undefined;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [nodes, graph, flow]);
  const acceptDiagram = (next: Diagram) => {
    const nextSource = serializeDSL(next);
    setFilterKinds(undefined);
    setFilterRoute(undefined);
    setFilterPurpose(undefined);
    setView('service');
    setSource(nextSource);
    setDiagram(next);
    setCollapsed([]);
    setExpanded([]);
    setScope(undefined);
    setSelected(undefined);
    setSelectedEdge(undefined);
    setDiagnostics(next.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`));
  };
  const apply = () => {
    const result = parseDSL(source);
    setDiagnostics(result.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`));
    if (result.diagram) acceptDiagram(result.diagram);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      if (file.name.endsWith('.json')) {
        const next = validateDiagram(JSON.parse(text) as unknown);
        acceptDiagram(next);
      } else {
        setSource(text);
        const parsed = parseDSL(text);
        setDiagnostics(
          parsed.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`),
        );
        if (parsed.diagram) acceptDiagram(parsed.diagram);
      }
    } catch (error) {
      setDiagnostics([error instanceof Error ? error.message : String(error)]);
    }
    if (upload.current) upload.current.value = '';
  };
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportDrawing = async (format: 'svg' | 'png' | 'pdf') => {
    if (!diagram || !graph || !lastLayout || busy) return;
    const popup = format === 'pdf' ? window.open('', '_blank') : undefined;
    try {
      const icons: Record<string, string> = {};
      await Promise.all(
        graph.resources.map(async (resource) => {
          const icon = getIcon(
            getResourceIconType(
              resource,
              new Map(diagram.resources.map((item) => [item.id, item])),
            ),
          );
          if (!icon) return;
          if (icon.startsWith('data:')) icons[resource.id] = icon;
          else {
            const response = await fetch(icon);
            if (!response.ok) throw new Error('同梱アイコンを読み込めません。');
            const text = await response.text();
            icons[resource.id] = 'data:image/svg+xml,' + encodeURIComponent(text);
          }
        }),
      );
      const svg = renderSVG(
        diagram.title,
        graph,
        { ...lastLayout, overlays: showMembership ? lastLayout.overlays : [] },
        { icons },
      );
      if (format === 'svg') {
        download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'diagram.svg');
        return;
      }
      if (format === 'pdf') {
        if (!popup) throw new Error('印刷ウィンドウを開けません。ポップアップを許可してください。');
        popup.document.open();
        popup.document.write(
          printDocument(svg, { paper, orientation, scale: exportScale, pages: printPages }),
        );
        popup.document.close();
        await popup.document.fonts.ready;
        popup.requestAnimationFrame(() => popup.requestAnimationFrame(() => popup.print()));
        return;
      }
      const image = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('SVG画像を読み込めません。'));
          image.src = url;
        });
        const width = Math.ceil(image.naturalWidth * exportScale),
          height = Math.ceil(image.naturalHeight * exportScale);
        if (width > 32767 || height > 32767 || width * height > 100_000_000)
          throw new Error('PNGが大きすぎます。縮尺を下げてください。');
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('画像を生成できません。');
        context.drawImage(image, 0, 0, width, height);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('PNGを生成できません。'))),
            'image/png',
          ),
        );
        download(blob, 'diagram.png');
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      popup?.close();
      setDiagnostics([(error as Error).message]);
    }
  };
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          ▧
        </div>
        <div className="brand">
          <strong>Infra Canvas</strong>
          <span>インフラを、見渡す。</span>
        </div>
        <div className="document-title">{diagram?.title ?? '構成図'}</div>
        <button className="toolbar-button" onClick={() => upload.current?.click()}>
          ファイルを開く
        </button>
        <select
          className="sample-picker"
          aria-label="サンプル"
          value=""
          onChange={(event) => {
            const sample = {
              aws: defaultSource,
              architecture: architectureSource,
              expressions: expressionSource,
              subnetSecurity: subnetSecuritySource,
            }[event.target.value as 'aws' | 'architecture' | 'expressions' | 'subnetSecurity'];
            if (!sample) return;
            const parsed = parseDSL(sample);
            if (parsed.diagram) acceptDiagram(parsed.diagram);
          }}
        >
          <option value="">サンプルを表示</option>
          <option value="aws">AWS 構成</option>
          <option value="architecture">経路・跨る囲み</option>
          <option value="expressions">P2・P3 表現一覧</option>
          <option value="subnetSecurity">AWS Subnet・セキュリティグループ</option>
        </select>
        <button
          className="toolbar-button"
          aria-expanded={exportOpen}
          onClick={() => setExportOpen(!exportOpen)}
        >
          書き出し
        </button>
        <button
          className="toolbar-button"
          onClick={() => {
            if (!diagram) return;
            const data = serializeDSL(diagram);
            const url = URL.createObjectURL(new Blob([data], { type: 'text/plain;charset=utf-8' }));
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'diagram.infra';
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          DSL を保存
        </button>
        <button
          className={`toolbar-button ${editorOpen ? 'active' : ''}`}
          onClick={() => setEditorOpen(!editorOpen)}
        >
          DSL を編集
        </button>
        <button
          className={`toolbar-button ${chatOpen ? 'active' : ''}`}
          aria-expanded={chatOpen}
          onClick={() => setChatOpen(!chatOpen)}
        >
          チャット
        </button>
        <input
          ref={upload}
          type="file"
          accept=".infra,.dsl,.txt,.json"
          hidden
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
          }}
        />
      </header>
      {exportOpen && (
        <section className="export-panel" aria-label="静的出力">
          <label>
            用紙
            <select
              aria-label="用紙"
              value={paper}
              onChange={(event) => setPaper(event.target.value as typeof paper)}
            >
              <option>A4</option>
              <option>A3</option>
            </select>
          </label>
          <label>
            向き
            <select
              aria-label="向き"
              value={orientation}
              onChange={(event) => setOrientation(event.target.value as typeof orientation)}
            >
              <option value="landscape">横</option>
              <option value="portrait">縦</option>
            </select>
          </label>
          <label>
            縮尺
            <select
              aria-label="縮尺"
              value={exportScale}
              onChange={(event) => setExportScale(Number(event.target.value))}
            >
              {[0.25, 0.5, 1, 1.5, 2].map((value) => (
                <option key={value} value={value}>
                  {value * 100}%
                </option>
              ))}
            </select>
          </label>
          <label>
            印刷
            <select
              aria-label="印刷方式"
              value={printPages}
              onChange={(event) => setPrintPages(event.target.value as typeof printPages)}
            >
              <option value="fit">全体を1枚に合わせる</option>
              <option value="tile">指定縮尺で分割</option>
            </select>
          </label>
          <p>現在のビューと固定位置を出力します。PDFは印刷画面で保存先を選べます。</p>
          {(['svg', 'png', 'pdf'] as const).map((format) => (
            <button
              className="toolbar-button"
              key={format}
              disabled={busy || !lastLayout}
              onClick={() => void exportDrawing(format)}
            >
              {format.toUpperCase()} を書き出す
            </button>
          ))}
        </section>
      )}
      <section className="workspace">
        <ChatPanel
          open={chatOpen}
          source={source}
          onApply={acceptDiagram}
          onClose={() => setChatOpen(false)}
        />
        {editorOpen && (
          <aside className="editor-panel">
            <div className="panel-title">
              <strong>DSL エディター</strong>
              <span>変更を図に反映</span>
            </div>
            <textarea
              aria-label="DSL 入力"
              spellCheck={false}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
            <button className="primary-button" onClick={apply}>
              解析して反映
            </button>
            <p className="editor-hint">構文エラーがある場合は、現在の図を保持します。</p>
          </aside>
        )}
        <div className="canvas-area" ref={canvas}>
          <div className="canvas-toolbar">
            <div className="view-tabs" aria-label="表示の切り替え">
              {Object.entries({
                ...viewLabels,
                ...Object.fromEntries(
                  (diagram?.views ?? [])
                    .filter((item) => !viewLabels[item.id])
                    .map((item) => [item.id, item.label ?? item.id]),
                ),
              }).map(([id, label]) => (
                <button
                  key={id}
                  className={view === id ? 'active' : ''}
                  aria-pressed={view === id}
                  onClick={() => changeView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="boundary-actions" aria-label="境界の一括操作">
              <button
                className="toolbar-button"
                disabled={
                  busy ||
                  !boundaryIds.length ||
                  boundaryIds.every((id) => graph?.collapsed.includes(id))
                }
                onClick={() => setAllBoundaries(true)}
                title="現在の表示範囲の境界をすべて折りたたむ"
              >
                すべて折りたたむ
              </button>
              <button
                className="toolbar-button"
                disabled={
                  busy ||
                  !boundaryIds.length ||
                  boundaryIds.every((id) => !graph?.collapsed.includes(id))
                }
                onClick={() => setAllBoundaries(false)}
                title="現在の表示範囲の境界をすべて展開する"
              >
                すべて展開する
              </button>
            </div>
            <button
              className="toolbar-button"
              aria-pressed={editLayout}
              disabled={Boolean(scope)}
              title={
                scope ? '配置は全体表示で編集できます' : 'ノードを移動し、DSLへ位置を保存します'
              }
              onClick={() => setEditLayout(!editLayout)}
            >
              {editLayout ? '移動を完了' : '配置を移動'}
            </button>
            <button
              className="toolbar-button"
              disabled={!diagram?.resources.some((resource) => resource.attributes.fixed)}
              onClick={() => {
                if (!diagram) return;
                const next = {
                  ...diagram,
                  resources: diagram.resources.map((resource) => {
                    const attributes = { ...resource.attributes };
                    delete attributes.x;
                    delete attributes.y;
                    delete attributes.fixed;
                    return { ...resource, attributes };
                  }),
                };
                autoFitContext.current = { diagram: next, view, scope };
                setSource(serializeDSL(next));
                setDiagram(next);
              }}
            >
              固定を解除
            </button>
            <button
              className="toolbar-button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              表示フィルター
            </button>
            <button
              className="toolbar-button"
              aria-label="矢印の形状"
              aria-pressed={edgeShape === 'bezier'}
              title="クリックして直線・曲線を切り替える"
              onClick={() => setEdgeShape(edgeShape === 'bezier' ? 'orthogonal' : 'bezier')}
            >
              矢印：{edgeShape === 'bezier' ? '曲線' : '直線'}
            </button>
            <button
              className="toolbar-button"
              aria-pressed={showMembership}
              disabled={!overlayBoxes.length}
              onClick={() => setShowMembership(!showMembership)}
              title="冗長化・信頼境界など、所属とは別の囲みを表示します"
            >
              追加の囲み：{showMembership ? '表示' : '非表示'}
            </button>
            <button
              className="toolbar-button clear-selection"
              disabled={!selectionActive}
              onClick={clearSelection}
              title="全体をカラー表示に戻す（パン・ズームは維持）"
            >
              選択を解除
            </button>
            <div className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                placeholder="リソースを検索…"
                aria-label="リソース検索"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <div className="search-results">
                  {matches.length ? (
                    matches.map((resource) => (
                      <button key={resource.id} onClick={() => focusResource(resource.id)}>
                        <strong>{resource.label}</strong>
                        <span>
                          {resource.type} · {resource.id}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p>該当するリソースがありません</p>
                  )}
                </div>
              )}
            </div>
            {scope && (
              <div className="scope-bar">
                <button onClick={() => setScope(undefined)}>← 全体へ戻る</button>
                <span>
                  {diagram?.resources.find((resource) => resource.id === scope)?.label} の詳細
                </span>
              </div>
            )}
            {filtersOpen && (
              <section className="display-filters" aria-label="表示フィルター">
                <fieldset>
                  <legend>接続種別</legend>
                  {edgeKinds.map((kind) => (
                    <label key={kind}>
                      <input
                        type="checkbox"
                        checked={effectiveKinds.includes(kind)}
                        onChange={(event) => {
                          setSelectedEdge(undefined);
                          setFilterKinds(
                            event.target.checked
                              ? [...effectiveKinds, kind]
                              : effectiveKinds.filter((item) => item !== kind),
                          );
                        }}
                      />
                      {kindLabels[kind]}
                    </label>
                  ))}
                </fieldset>
                <label>
                  経路
                  <select
                    aria-label="経路フィルター"
                    value={
                      filterRoute ??
                      (activeView?.routes?.length === 1
                        ? activeView.routes[0]
                        : activeView?.routes
                          ? '__saved__'
                          : '')
                    }
                    onChange={(event) => {
                      setSelectedEdge(undefined);
                      setFilterRoute(event.target.value);
                    }}
                  >
                    <option value="">すべて</option>
                    {filterRoute === undefined &&
                      activeView?.routes &&
                      activeView.routes.length !== 1 && (
                        <option value="__saved__">保存した経路の組み合わせ</option>
                      )}
                    {routes.map((route) => (
                      <option key={route}>{route}</option>
                    ))}
                  </select>
                </label>
                <label>
                  用途
                  <select
                    aria-label="用途フィルター"
                    value={
                      filterPurpose ??
                      (activeView?.purposes?.length === 1
                        ? activeView.purposes[0]
                        : activeView?.purposes
                          ? '__saved__'
                          : '')
                    }
                    onChange={(event) => {
                      setSelectedEdge(undefined);
                      setFilterPurpose(event.target.value);
                    }}
                  >
                    <option value="">すべて</option>
                    {filterPurpose === undefined &&
                      activeView?.purposes &&
                      activeView.purposes.length !== 1 && (
                        <option value="__saved__">保存した用途の組み合わせ</option>
                      )}
                    {purposes.map((purpose) => (
                      <option key={purpose}>{purpose}</option>
                    ))}
                  </select>
                </label>
                {(filterRoute === undefined
                  ? activeView?.routes?.length === 1
                  : Boolean(filterRoute)) && (
                  <ol className="route-steps" aria-label="選択経路の通過順">
                    {(diagram?.connections ?? [])
                      .filter(
                        (edge) =>
                          edge.attributes.route === (filterRoute ?? activeView?.routes?.[0]),
                      )
                      .sort(
                        (a, b) =>
                          String(a.attributes.routeDirection ?? 'forward').localeCompare(
                            String(b.attributes.routeDirection ?? 'forward'),
                          ) || Number(a.attributes.step) - Number(b.attributes.step),
                      )
                      .map((edge) => (
                        <li key={edge.id}>
                          {edge.attributes.routeDirection === 'return' ? '復路' : '往路'}{' '}
                          {String(edge.attributes.step)}: {edge.source} → {edge.target}
                        </li>
                      ))}
                  </ol>
                )}
                <input
                  aria-label="保存するビュー名"
                  placeholder="表示名（例：アプリ通信）"
                  value={viewDisplayName}
                  onChange={(event) => setViewDisplayName(event.target.value)}
                />
                <input
                  aria-label="保存するビューID"
                  placeholder="ビューID"
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                />
                <button
                  className="toolbar-button"
                  onClick={() => {
                    if (!diagram) return;
                    const saved = {
                      id: viewName,
                      label: viewDisplayName.trim() || undefined,
                      level:
                        activeView?.level ??
                        (
                          {
                            overview: 'overview',
                            service: 'service',
                            network: 'subnet',
                            security: 'resource',
                          } as const
                        )[view as 'overview' | 'service' | 'network' | 'security'] ??
                        'resource',
                      direction: activeView?.direction,
                      overlay: activeView?.overlay ?? (view === 'security' ? 'sg' : undefined),
                      kinds: effectiveKinds,
                      routes: filterRoute
                        ? [filterRoute]
                        : filterRoute === undefined
                          ? activeView?.routes
                          : undefined,
                      purposes: filterPurpose
                        ? [filterPurpose]
                        : filterPurpose === undefined
                          ? activeView?.purposes
                          : undefined,
                    };
                    const next = {
                      ...diagram,
                      views: [...diagram.views.filter((item) => item.id !== viewName), saved],
                    };
                    try {
                      validateDiagram(next);
                      setSource(serializeDSL(next));
                      setDiagram(next);
                      changeView(viewName);
                      setViewName('');
                    } catch (error) {
                      setDiagnostics([(error as Error).message]);
                    }
                  }}
                >
                  ビューを保存
                </button>
              </section>
            )}
          </div>
          {editLayout && (
            <aside className="layout-help" role="status">
              カードをドラッグして移動します。移動した配置は固定され、DSLに保存されます。
              「移動を完了」で終了し、「固定を解除」で自動配置に戻せます。
            </aside>
          )}
          <ReactFlow<ResourceNode>
            nodes={renderedNodes.map((node) => ({
              ...node,
              draggable: editLayout && !scope && node.data.resource.type !== 'note',
            }))}
            onNodeDragStop={(_, moved) => {
              if (!diagram || scope) return;
              const currentNodes = new Map(flow.getNodes().map((node) => [node.id, node]));
              currentNodes.set(moved.id, moved);
              const next = {
                ...diagram,
                resources: diagram.resources.map((resource) => {
                  const node = currentNodes.get(resource.id);
                  if (!node || resource.type === 'overlay' || resource.type === 'note')
                    return resource;
                  // 展開時の境界のヘッダーへカードを移動させない。
                  const parent = node.parentId ? currentNodes.get(node.parentId) : undefined;
                  const minimumY = parent ? (parent.data.contentTop ?? 56) : -Infinity;
                  return {
                    ...resource,
                    attributes: {
                      ...resource.attributes,
                      x: parent ? Math.max(24, node.position.x) : node.position.x,
                      y: Math.max(minimumY, node.position.y),
                      fixed: true,
                    },
                  };
                }),
              };
              autoFitContext.current = { diagram: next, view, scope };
              setSource(serializeDSL(next));
              setDiagram(next);
            }}
            onNodesChange={onNodesChange}
            edges={renderedEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeMouseEnter={(_, node) => setHovered(node.id)}
            onNodeMouseLeave={() => setHovered(undefined)}
            onNodeClick={(_, node) => {
              setSelectedEdge(undefined);
              setSelected(node.id);
            }}
            onPaneClick={clearSelection}
            minZoom={0.05}
            maxZoom={2.5}
            nodesDraggable={editLayout && !scope}
            nodesConnectable={false}
          >
            <ViewportPortal>
              {(showMembership ? overlayBoxes : []).map((box, index) => (
                <div
                  key={box.id}
                  className="membership-overlay"
                  data-overlay-id={box.id}
                  style={{
                    left: box.x,
                    top: box.y,
                    width: box.width,
                    height: box.height,
                    color:
                      resourceAppearance(
                        graph?.overlays?.find((item) => item.id === box.id) ?? {
                          id: box.id,
                          type: 'overlay',
                          label: box.label,
                          attributes: {},
                        },
                      ).borderColor ?? ['#79518f', '#94651b', '#246b78'][index % 3],
                  }}
                >
                  <span
                    style={{
                      left: (box.labelX ?? box.x + 12) - box.x,
                      top: (box.labelY ?? box.y + 4) - box.y,
                      width: box.labelWidth,
                      minHeight: box.labelHeight,
                      borderColor: 'inherit',
                      color: 'inherit',
                    }}
                  >
                    {box.label}
                  </span>
                </div>
              ))}
              {(lastLayout?.annotations ?? []).map((note) => (
                <div key={note.id}>
                  {note.anchor && (
                    <svg
                      className="annotation-line"
                      style={{
                        left: Math.min(note.anchor.x, note.x) - 2,
                        top: Math.min(note.anchor.y, note.y + 20) - 2,
                        width: Math.abs(note.anchor.x - note.x) + 4,
                        height: Math.abs(note.anchor.y - note.y - 20) + 4,
                      }}
                    >
                      <line
                        x1={note.anchor.x - Math.min(note.anchor.x, note.x) + 2}
                        y1={note.anchor.y - Math.min(note.anchor.y, note.y + 20) + 2}
                        x2={note.x - Math.min(note.anchor.x, note.x) + 2}
                        y2={note.y + 20 - Math.min(note.anchor.y, note.y + 20) + 2}
                      />
                    </svg>
                  )}
                </div>
              ))}
            </ViewportPortal>
            <Background gap={24} size={1} color="#d9e1ea" />
            <Controls showInteractive={false} />
            <MiniMap
              style={{ width: 155, height: 100 }}
              ariaLabel="構成図のミニマップ"
              nodeColor={(node) =>
                isBoundary((node.data as ResourceData).resource) ? '#d9e7ed' : '#9ab6c1'
              }
              pannable
              zoomable
            />
          </ReactFlow>
          {busy && (
            <div className="layout-status" role="status">
              構成を配置しています…
            </div>
          )}
          <details className="expression-legend">
            <summary>表示の凡例</summary>
            <p>公開範囲: {Object.values(exposureLabels).join(' / ')}</p>
            <p>根拠: {Object.values(evidenceLabels).join(' / ')}</p>
            <p>変更: {Object.values(changeLabels).join(' / ')}</p>
            <p>
              緑の破線＝追加、黄の破線＝変更、赤の破線＝削除予定。×Nは台数、範囲は最小〜最大です。
            </p>
          </details>
          <div className="canvas-footer">
            <span>
              {graph?.resources.length ?? 0} 要素 · {graph?.connections.length ?? 0} 接続
            </span>
            <div className="edge-legend">
              {Object.entries(kindLabels).map(([kind, label]) => (
                <span key={kind}>
                  <i style={{ background: kindColors[kind] }} />
                  {label}
                </span>
              ))}
            </div>
            <span>配置 {Math.round(layoutTime)} ms</span>
          </div>
        </div>
        <aside className="detail-panel">
          {graph?.resources.some((resource) => graph.collapsed.includes(resource.id)) && (
            <section className="collapsed-navigation" aria-label="折りたたみ中の境界">
              <h2>折りたたみ中</h2>
              <p>一覧から展開して表示できます。</p>
              {graph.resources
                .filter((resource) => graph.collapsed.includes(resource.id))
                .map((resource) => (
                  <button
                    key={resource.id}
                    disabled={busy}
                    aria-label={`${resource.label}を展開して表示`}
                    onClick={() => {
                      pendingFocus.current = { id: resource.id, previousGraph: graph };
                      setSelected(resource.id);
                      setSelectedEdge(undefined);
                      setHovered(undefined);
                      toggle(resource.id);
                    }}
                  >
                    <span>{resource.label}</span>
                    <span>＋ 展開</span>
                  </button>
                ))}
            </section>
          )}
          {selectedConnection ? (
            <>
              <div className="detail-type">接続 · {kindLabels[selectedConnection.kind]}</div>
              <h2>
                {String(selectedConnection.attributes.label ?? kindLabels[selectedConnection.kind])}
              </h2>
              <h3>接続元 → 接続先</h3>
              <div className="relations">
                {[selectedConnection.source, selectedConnection.target].map((id, index) => (
                  <button key={`${index}-${id}`} onClick={() => focusResource(id)}>
                    <span className="relation-kind">{index === 0 ? '接続元' : '接続先'}</span>
                    <strong>
                      {graph?.resources.find((resource) => resource.id === id)?.label ?? id}
                    </strong>
                  </button>
                ))}
              </div>
              <h3>属性</h3>
              <dl>
                {Object.entries(selectedConnection.attributes).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key === 'signals' ? '送信データ' : key}</dt>
                    <dd>
                      {Array.isArray(value)
                        ? key === 'signals'
                          ? value.map((signal) => signalLabels[signal] ?? signal).join(' / ')
                          : value.join(', ')
                        : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              <h3>
                元の接続 <span>{selectedConnection.originalIds.length}</span>
              </h3>
              <dl>
                {selectedConnection.originalIds.map((id) => {
                  const original = diagram?.connections.find((edge) => edge.id === id);
                  return (
                    <div key={id}>
                      <dt>{id}</dt>
                      <dd>
                        {original
                          ? `${original.source} → ${original.target}`
                          : `${selectedConnection.source} → ${selectedConnection.target}`}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </>
          ) : selectedResource ? (
            <>
              <div className="detail-type">{selectedResource.type}</div>
              <h2>
                <span className="resource-label">
                  <RegionFlag resource={selectedResource} />
                  <span>{selectedResource.label}</span>
                </span>
              </h2>
              <code className="resource-id">{selectedResource.id}</code>
              {(diagram?.resources ?? []).filter(
                (resource) =>
                  resource.type === 'sg' &&
                  ((selectedResource.attributes.securityGroups as string[] | undefined)?.includes(
                    resource.id,
                  ) ||
                    (resource.attributes.members as string[] | undefined)?.includes(
                      selectedResource.id,
                    )),
              ).length > 0 && (
                <section aria-label="所属セキュリティグループ" className="relations">
                  <h3>セキュリティグループ</h3>
                  {(diagram?.resources ?? [])
                    .filter(
                      (resource) =>
                        resource.type === 'sg' &&
                        ((
                          selectedResource.attributes.securityGroups as string[] | undefined
                        )?.includes(resource.id) ||
                          (resource.attributes.members as string[] | undefined)?.includes(
                            selectedResource.id,
                          )),
                    )
                    .map((resource) => (
                      <button key={resource.id} onClick={() => focusResource(resource.id)}>
                        {resource.label}
                      </button>
                    ))}
                </section>
              )}
              {isBoundary(selectedResource) && (
                <div className="detail-actions">
                  <button className="toolbar-button" onClick={() => toggle(selectedResource.id)}>
                    {graph?.collapsed.includes(selectedResource.id) ? '展開する' : '折りたたむ'}
                  </button>
                  <button
                    className="toolbar-button"
                    onClick={() => {
                      setCollapsed((current) => current.filter((id) => id !== selectedResource.id));
                      setExpanded((current) => [...new Set([...current, selectedResource.id])]);
                      setScope(selectedResource.id);
                    }}
                  >
                    詳細へ移動
                  </button>
                </div>
              )}
              <label className="icon-picker">
                表示アイコン
                <select
                  aria-label="表示アイコン"
                  value={String(selectedResource.attributes.icon ?? '')}
                  onChange={(event) => {
                    if (!diagram) return;
                    const next = {
                      ...diagram,
                      resources: diagram.resources.map((resource) => {
                        if (resource.id !== selectedResource.id) return resource;
                        const attributes = { ...resource.attributes };
                        if (event.target.value) attributes.icon = event.target.value;
                        else delete attributes.icon;
                        return { ...resource, attributes };
                      }),
                    };
                    autoFitContext.current = { diagram: next, view, scope };
                    setSource(serializeDSL(next));
                    setDiagram(next);
                  }}
                >
                  <option value="">種別・providerから選ぶ</option>
                  {getIconTypes().map((type) => (
                    <option key={type} value={type}>
                      {type === 'aws.organization-account' ? 'AWS アカウント' : type}
                    </option>
                  ))}
                </select>
              </label>
              <h3>属性</h3>
              {Object.entries(selectedResource.attributes).length ? (
                <dl>
                  {Object.entries(selectedResource.attributes).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted-copy">追加属性なし</p>
              )}
              <h3>
                関係 <span>{selectedRelations.length}</span>
              </h3>
              <div className="relations">
                {selectedRelations.map((edge) => {
                  const other = edge.source === selected ? edge.target : edge.source;
                  return (
                    <button key={edge.id} onClick={() => focusResource(other)}>
                      <span className="relation-kind">
                        {edge.source === selected ? '→' : '←'} {kindLabels[edge.kind]}
                      </span>
                      <strong>
                        {diagram?.resources.find((resource) => resource.id === other)?.label ??
                          other}
                      </strong>
                      <span>
                        {Object.entries(edge.attributes)
                          .map(([key, value]) => `${key}=${String(value)}`)
                          .join(' · ')}
                      </span>
                    </button>
                  );
                })}
              </div>
              <h3>取り込み元</h3>
              <dl>
                {Object.entries(selectedResource.provenance ?? { kind: 'design' }).map(
                  ([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ),
                )}
                {selectedResource.location && (
                  <div>
                    <dt>DSL</dt>
                    <dd>
                      {selectedResource.location.line}:{selectedResource.location.column}
                    </dd>
                  </div>
                )}
              </dl>
              {selectedResource.unresolved?.length ? (
                <>
                  <h3>未解決情報</h3>
                  {selectedResource.unresolved.map((message) => (
                    <p className="warning-copy" key={message}>
                      {message}
                    </p>
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <div className="empty-details">
              <div aria-hidden="true">⌁</div>
              <h2>構成を探索</h2>
              <p>要素をクリックすると、属性・関係・取り込み元を確認できます。</p>
              <p>ホバーで関係を強調し、クリックで固定します。境界の − / + で詳細を展開できます。</p>
              <span className="info-pill">ズームと表示の抽象度は独立</span>
            </div>
          )}
        </aside>
      </section>
      {diagnostics.length > 0 && (
        <div className="diagnostics" role="alert">
          <button aria-label="診断を閉じる" onClick={() => setDiagnostics([])}>
            ×
          </button>
          {diagnostics.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  </StrictMode>,
);
