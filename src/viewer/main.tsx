import { resourceMetadata } from '../core/resource-metadata';
import { resourceContent } from '../core/content';
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useReducer,
  type CSSProperties,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
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
import { isBoundary, type Diagram, type Resource, type DisplayGraph } from '../core/model';
import { getIcon, getIconHomepage } from '../assets/icons';
import { getResourceIconType } from '../assets/resource-icons';
import { getCountryFlag } from '../assets/flags';
import { getRegionCountry, getResourceRegion } from '../assets/regions';
import { createHistory, historyReducer } from './history';
import defaultSource from '../../examples/aws.infra?raw';
import { PropertyEditor } from './property-editor';
import {
  edgeKindLabels as kindLabels,
  edgeKinds,
  type Attributes,
  type Connection,
} from '../core/model';
import { connectionStyles, connectionDescriptions } from './connection-style';

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
};
type ResourceNode = Node<ResourceData>;
const activeEdgeZ = 10;
const viewLabels: Record<string, string> = {
  overview: '概要',
  service: 'サービス',
  network: 'ネットワーク',
  security: 'セキュリティ',
};

function ConnectionSample({ kind }: { kind: Connection['kind'] }) {
  return (
    <svg
      width="42"
      height="12"
      viewBox="0 0 42 12"
      aria-hidden="true"
      style={{ color: connectionStyles[kind].color }}
    >
      <path
        d="M 0 6 H 36"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={connectionStyles[kind].dash}
        fill="none"
      />
      <path d="M 36 3 L 41 6 L 36 9 Z" fill="currentColor" />
    </svg>
  );
}

function ConnectionLegend() {
  const [hovered, setHovered] = useState<Connection['kind']>();
  const [focused, setFocused] = useState<Connection['kind']>();
  const [dismissed, setDismissed] = useState(false);
  const active = dismissed ? undefined : (hovered ?? focused);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const enter = (kind: Connection['kind']) => {
    clearTimeout(hoverTimer.current);
    setHovered(kind);
    setDismissed(false);
  };
  const leave = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(undefined), 150);
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  useEffect(() => {
    if (!active) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearTimeout(hoverTimer.current);
        setHovered(undefined);
        setDismissed(true);
      }
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [active]);
  return (
    <div className="edge-legend">
      {edgeKinds.map((kind) => (
        <span
          key={kind}
          className="edge-legend-item"
          data-kind={kind}
          style={{ color: connectionStyles[kind].color }}
          tabIndex={0}
          aria-describedby={active === kind ? 'connection-legend-tooltip' : undefined}
          onMouseEnter={() => enter(kind)}
          onMouseLeave={leave}
          onFocus={() => {
            clearTimeout(hoverTimer.current);
            setHovered(undefined);
            setFocused(kind);
            setDismissed(false);
          }}
          onBlur={() => setFocused(undefined)}
        >
          <ConnectionSample kind={kind} />
          {kindLabels[kind]}
        </span>
      ))}
      {active && (
        <div
          className="edge-legend-tooltip"
          id="connection-legend-tooltip"
          role="tooltip"
          onMouseEnter={() => enter(active)}
          onMouseLeave={leave}
        >
          <strong>
            {kindLabels[active]} · {connectionDescriptions[active].pattern}
          </strong>
          <p>{connectionDescriptions[active].meaning}</p>
        </div>
      )}
    </div>
  );
}

function ConnectionHelp() {
  return (
    <details
      className="connection-help"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>線種の意味</summary>
      <section className="connection-help-panel" aria-label="線種の意味と例">
        <h2>線種の意味</h2>
        <p>矢印は送信元から接続先へ向きます。色と線の模様を組み合わせて、次の関係を表します。</p>
        <dl>
          {edgeKinds.map((kind) => (
            <div key={kind} data-kind={kind}>
              <dt>
                <ConnectionSample kind={kind} />
                {kindLabels[kind]}
                <small>{connectionDescriptions[kind].pattern}</small>
              </dt>
              <dd>
                {connectionDescriptions[kind].meaning}
                <small>{connectionDescriptions[kind].example}</small>
              </dd>
            </div>
          ))}
        </dl>
        <p>
          線は構成上の関係や設計の意図を表します。実際の通信・権限・複製・切替の成立を保証するものではありません。
        </p>
      </section>
    </details>
  );
}

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
      className={`resource-card ${boundary && !collapsed ? 'boundary-card' : ''} ${boundary && resource.type.startsWith('aws.') ? 'detail-boundary-card' : ''} ${collapsed ? 'collapsed-card' : ''} ${related ? 'related' : ''} ${muted ? 'muted' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
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
          <span className="resource-type">{resource.type}</span>
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
const nodeTypes = { resource: ResourceCard };
type RouteData = { points: { x: number; y: number }[]; label?: { x: number; y: number } };
function RoutedConnection(props: EdgeProps) {
  const route = props.data?.route as RouteData | undefined;
  const curved = props.data?.edgeShape === 'bezier';
  let fallback = curved ? getBezierPath(props) : getSmoothStepPath(props);
  const parallelOffset = Number(props.data?.parallelOffset ?? 0);
  if (curved && parallelOffset) {
    // 同じ端点への監視データの送信も、別の曲線・ラベルとして操作できるようにする。
    const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
    const horizontal = [Position.Left, Position.Right].includes(props.sourcePosition);
    const distance = Math.max(40, Math.abs(horizontal ? tx - sx : ty - sy) / 2);
    const control = (x: number, y: number, position: Position): [number, number] => [
      x +
        (position === Position.Right
          ? distance
          : position === Position.Left
            ? -distance
            : parallelOffset),
      y +
        (position === Position.Bottom
          ? distance
          : position === Position.Top
            ? -distance
            : parallelOffset),
    ];
    const a = control(sx, sy, props.sourcePosition);
    const b = control(tx, ty, props.targetPosition);
    const x = (sx + tx + 3 * (a[0] + b[0])) / 8;
    const y = (sy + ty + 3 * (a[1] + b[1])) / 8;
    fallback = [
      `M${sx},${sy} C${a[0]},${a[1]} ${b[0]},${b[1]} ${tx},${ty}`,
      x,
      y,
      Math.abs(x - sx),
      Math.abs(y - sy),
    ];
  }
  const path =
    !curved && route?.points.length
      ? route.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
      : fallback[0];
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
      <EdgeLabelRenderer>
        <button
          className="connection-label nodrag nopan"
          style={
            {
              transform: `translate(-50%, -50%) translate(${!curved && route?.label ? route.label.x : fallback[1]}px, ${!curved && route?.label ? route.label.y : fallback[2]}px)`,
              opacity: props.style?.opacity,
              '--connection-color': props.style?.stroke,
              zIndex: props.selected ? 11 : 2,
            } as CSSProperties
          }
          data-kind={String(props.data?.kind)}
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
  const [history, dispatchHistory] = useReducer(
    historyReducer,
    {
      diagram: initial,
      documentKey: {},
      source: initial ? serializeDSL(initial) : defaultSource,
      view: 'service',
      edgeShape: 'orthogonal' as const,
      collapsed: [],
      expanded: [],
    },
    createHistory,
  );
  const { diagram, view, edgeShape, collapsed, expanded, scope } = history.present;
  const [documentVersion, setDocumentVersion] = useState(0);
  const [source, setSource] = useState(() => (initial ? serializeDSL(initial) : defaultSource));
  const [editorOpen, setEditorOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>();
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [query, setQuery] = useState('');
  const [nodes, setNodes] = useState<ResourceNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [graph, setGraph] = useState<DisplayGraph>();
  const [layoutTime, setLayoutTime] = useState(0);
  const [labelLayer, setLabelLayer] = useState(activeEdgeZ + 2);
  const [busy, setBusy] = useState(false);
  const autoFitContext = useRef<{ diagram?: Diagram; view: string; scope?: string } | undefined>(
    undefined,
  );
  const pendingFocus = useRef<{ id: string; previousGraph?: DisplayGraph } | undefined>(undefined);
  const measurementFrame = useRef<number | undefined>(undefined);
  const pendingMeasurements = useRef<NodeChange<ResourceNode>[]>([]);
  const onNodesChange = useCallback((changes: NodeChange<ResourceNode>[]) => {
    pendingMeasurements.current.push(...changes.filter((change) => change.type === 'dimensions'));
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
    dispatchHistory({
      type: 'commit',
      update: (current) => ({
        ...current,
        collapsed: isCollapsed
          ? current.collapsed.filter((item) => item !== id)
          : [...current.collapsed, id],
        expanded: isCollapsed
          ? [...new Set([...current.expanded, id])]
          : current.expanded.filter((item) => item !== id),
      }),
    });
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
        .filter((resource) => ids.has(resource.id))
        .map((resource) =>
          resource.id === scope ? { ...resource, parentId: undefined } : resource,
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
    dispatchHistory({
      type: 'commit',
      update: (current) => ({
        ...current,
        collapsed: collapse
          ? [...new Set([...current.collapsed, ...ids])]
          : current.collapsed.filter((id) => !ids.has(id)),
        expanded: collapse
          ? current.expanded.filter((id) => !ids.has(id))
          : [...new Set([...current.expanded, ...ids])],
      }),
    });
  };
  useEffect(() => {
    if (!visibleDiagram) return;
    let active = true;
    setBusy(true);
    const display = buildDisplayGraph(visibleDiagram, { view, collapsed, expanded });
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
        // 入れ子の深度が接続の z-index に加算されるため、ラベル層にも反映する。
        setLabelLayer(activeEdgeZ + Math.max(0, ...sorted.map(depth)) + 2);
        setNodes(
          sorted.map((resource) => {
            const placement = placements.get(resource.id)!;
            return {
              id: resource.id,
              type: 'resource',
              position: { x: placement.x, y: placement.y },
              parentId: placement.parentId,
              extent: placement.parentId ? ('parent' as const) : undefined,
              draggable: false,
              width: placement.width,
              height: placement.height,
              measured: {
                width: Math.round(placement.width),
                height: Math.round(placement.height),
              },
              style: { width: placement.width, height: placement.height },
              data: {
                resource,
                iconType: getResourceIconType(resource, originalResources),
                collapsed: display.collapsed.includes(resource.id),
                onToggle: toggle,
                related: false,
                muted: false,
              },
            };
          }),
        );
        setEdges(
          display.connections.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: connectionLabel(edge),
            markerEnd: { type: MarkerType.ArrowClosed, color: connectionStyles[edge.kind].color },
            style: {
              stroke: connectionStyles[edge.kind].color,
              strokeWidth: 1.7,
              strokeDasharray: connectionStyles[edge.kind].dash,
            },
            labelStyle: { fill: '#4a5870', fontSize: 10 },
            labelBgStyle: { fill: '#fff', fillOpacity: 0.95 },
            labelBgPadding: [5, 3] as [number, number],
            type: 'routed',
            data: { route: routes.get(edge.id), kind: edge.kind },
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
  }, [diagram, visibleDiagram, view, collapsed, expanded, toggle]);
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
  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const parallel = edges.filter(
          (other) => other.source === edge.source && other.target === edge.target,
        );
        const match = selectedConnection
          ? edge.id === selectedConnection.id
          : edge.source === focus || edge.target === focus;
        return {
          ...edge,
          selected: edge.id === selectedConnection?.id,
          data: {
            ...edge.data,
            edgeShape,
            parallelOffset:
              (parallel.findIndex((other) => other.id === edge.id) - (parallel.length - 1) / 2) *
              64,
            onSelect: selectConnection,
            accessibleLabel: `${graph?.resources.find((resource) => resource.id === edge.source)?.label ?? edge.source} → ${graph?.resources.find((resource) => resource.id === edge.target)?.label ?? edge.target}: ${edge.label}`,
          },
          zIndex: match ? activeEdgeZ : 1,
          style: {
            ...edge.style,
            strokeWidth: match ? 3.5 : 1.7,
            opacity: selectionActive && !match ? 0.14 : 1,
          },
        };
      }),
    [edges, focus, selectedConnection, selectConnection, graph, selectionActive, edgeShape],
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
        .filter((resource) =>
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
    const ancestors = new Set<string>();
    let resource = diagram?.resources.find((item) => item.id === id);
    while (resource?.parentId && !ancestors.has(resource.parentId)) {
      ancestors.add(resource.parentId);
      resource = diagram?.resources.find((item) => item.id === resource!.parentId);
    }
    const nextView =
      diagram?.resources.find((item) => item.id === id)?.type === 'sg' ? 'security' : view;
    const needsLayout =
      scope !== undefined ||
      nextView !== view ||
      [...ancestors].some(
        (ancestor) => collapsed.includes(ancestor) || !expanded.includes(ancestor),
      );
    if (!needsLayout) {
      pendingFocus.current = undefined;
      void flow.fitView({ nodes: [{ id }], padding: 0.7, maxZoom: 1.2, duration: 450 });
      return;
    }
    pendingFocus.current = { id, previousGraph: graph };
    dispatchHistory({
      type: 'commit',
      update: (current) => ({
        ...current,
        scope: undefined,
        collapsed: current.collapsed.filter((ancestor) => !ancestors.has(ancestor)),
        expanded: [...new Set([...current.expanded, ...ancestors])],
        view: nextView,
      }),
    });
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
    setSource(nextSource);
    dispatchHistory({
      type: 'commit',
      update: (current) => ({
        ...current,
        diagram: next,
        documentKey: {},
        source: nextSource,
        collapsed: [],
        expanded: [],
        scope: undefined,
      }),
    });
    pendingFocus.current = undefined;
    setHovered(undefined);
    setQuery('');
    setDocumentVersion((current) => current + 1);
    setSelected(undefined);
    setSelectedEdge(undefined);
    setDiagnostics(next.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`));
  };
  const apply = () => {
    const result = parseDSL(source);
    setDiagnostics(result.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`));
    if (result.diagram) acceptDiagram(result.diagram);
  };
  const editItem = (
    id: string,
    value: { label: string; kind: Connection['kind']; attributes: Attributes },
    resource: boolean,
  ) => {
    if (!diagram) return;
    if (source !== serializeDSL(diagram))
      throw new Error('DSL エディターに未反映の変更があります。先に解析して反映してください。');
    const next: Diagram = {
      ...diagram,
      resources: diagram.resources.map((item) =>
        resource && item.id === id
          ? {
              ...item,
              label: value.label,
              attributes: value.attributes,
              provenance: item.provenance ? { ...item.provenance, kind: 'design' } : undefined,
              unresolved:
                item.provenance && item.provenance.kind !== 'design'
                  ? [
                      ...new Set([
                        ...(item.unresolved ?? []),
                        'ビューアで編集した設計値です。取り込み元には反映していません。',
                      ]),
                    ]
                  : item.unresolved,
            }
          : item,
      ),
      connections: diagram.connections.map((item) =>
        !resource && item.id === id
          ? { ...item, kind: value.kind, attributes: value.attributes }
          : item,
      ),
    };
    validateDiagram(next);
    const nextSource = serializeDSL(next);
    const parsed = parseDSL(nextSource);
    if (!parsed.diagram) throw new Error(parsed.diagnostics.map((item) => item.message).join('\n'));
    // 正規化した DSL の位置を同期し、接続の ID と取り込み根拠は保持する。
    next.resources = next.resources.map((item) => ({
      ...item,
      location: parsed.diagram!.resources.find((r) => r.id === item.id)?.location,
    }));
    next.connections = next.connections.map((item, index) => ({
      ...item,
      location: parsed.diagram!.connections[index]?.location,
    }));
    autoFitContext.current = { diagram: next, view, scope };
    dispatchHistory({
      type: 'commit',
      update: (current) => ({ ...current, diagram: next, source: nextSource }),
    });
    setSource(nextSource);
    setDiagnostics([]);
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
  const restoreHistory = useCallback(
    (direction: 'undo' | 'redo') => {
      const target = direction === 'undo' ? history.past.at(-1) : history.future[0];
      if (!target) return;
      if (target.diagram !== diagram || target.source !== history.present.source) {
        setSource(target.source);
      }
      if (
        target.documentKey === history.present.documentKey &&
        target.view === view &&
        target.scope === scope
      ) {
        autoFitContext.current = {
          diagram: target.diagram,
          view: target.view,
          scope: target.scope,
        };
      }
      setDocumentVersion((current) => current + 1);
      pendingFocus.current = undefined;
      setSelected(undefined);
      setSelectedEdge(undefined);
      setHovered(undefined);
      setQuery('');
      setDiagnostics(
        target.diagram?.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`) ??
          [],
      );
      dispatchHistory({ type: direction });
    },
    [history, diagram, view, scope],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey)
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        )
      )
        return;
      const key = event.key.toLowerCase();
      const direction =
        key === 'z'
          ? event.shiftKey
            ? 'redo'
            : 'undo'
          : key === 'y' && event.ctrlKey && !event.shiftKey
            ? 'redo'
            : undefined;
      if (!direction) return;
      event.preventDefault();
      restoreHistory(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [restoreHistory]);
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
        <div className="history-actions" role="group" aria-label="操作履歴">
          <button
            className="toolbar-button"
            disabled={!history.past.length}
            onClick={() => restoreHistory('undo')}
            title="元に戻す（Ctrl / ⌘ + Z）"
          >
            元に戻す
          </button>
          <button
            className="toolbar-button"
            disabled={!history.future.length}
            onClick={() => restoreHistory('redo')}
            title="やり直す（Ctrl / ⌘ + Shift + Z、Ctrl + Y）"
          >
            やり直す
          </button>
        </div>
        <button className="toolbar-button" onClick={() => upload.current?.click()}>
          ファイルを開く
        </button>
        <button
          className={`toolbar-button ${editorOpen ? 'active' : ''}`}
          onClick={() => setEditorOpen(!editorOpen)}
        >
          DSL を編集
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
      <section className="workspace">
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
        <div
          className="canvas-area"
          ref={canvas}
          style={{ '--edge-label-z-index': labelLayer } as CSSProperties}
        >
          <div className="canvas-toolbar">
            <div className="view-tabs" aria-label="表示の切り替え">
              {Object.entries(viewLabels).map(([id, label]) => (
                <button
                  key={id}
                  className={view === id ? 'active' : ''}
                  aria-pressed={view === id}
                  onClick={() =>
                    dispatchHistory({
                      type: 'commit',
                      update: (current) => ({ ...current, view: id }),
                    })
                  }
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
              className="edge-shape-control toolbar-button"
              role="switch"
              aria-label="矢印を曲線にする"
              aria-checked={edgeShape === 'bezier'}
              onClick={() =>
                dispatchHistory({
                  type: 'commit',
                  update: (current) => ({
                    ...current,
                    edgeShape: current.edgeShape === 'bezier' ? 'orthogonal' : 'bezier',
                  }),
                })
              }
              title="直線（直角）と曲線を切り替える"
            >
              矢印 {edgeShape === 'bezier' ? '曲線' : '直線'}{' '}
              <span aria-hidden="true">{edgeShape === 'bezier' ? '●' : '○'}</span>
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
                <button
                  onClick={() =>
                    dispatchHistory({
                      type: 'commit',
                      update: (current) => ({ ...current, scope: undefined }),
                    })
                  }
                >
                  ← 全体へ戻る
                </button>
                <span>
                  {diagram?.resources.find((resource) => resource.id === scope)?.label} の詳細
                </span>
              </div>
            )}
          </div>
          <ReactFlow<ResourceNode>
            nodes={renderedNodes}
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
            onEdgeClick={(_, edge) => selectConnection(edge.id)}
            onPaneClick={clearSelection}
            minZoom={0.05}
            maxZoom={2.5}
            nodesDraggable={false}
            nodesConnectable={false}
            elevateNodesOnSelect={false}
            elevateEdgesOnSelect={false}
          >
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
          <div className="canvas-footer">
            <span>
              {graph?.resources.length ?? 0} 要素 · {graph?.connections.length ?? 0} 接続
            </span>
            <ConnectionLegend />
            <ConnectionHelp />
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
              {selectedConnection.originalIds.map((id) => {
                const original = diagram?.connections.find((edge) => edge.id === id);
                return original ? (
                  <details className="connection-editor" key={id}>
                    <summary>
                      {original.source} → {original.target} を編集
                    </summary>
                    <PropertyEditor
                      key={`${documentVersion}-${id}`}
                      connection={original}
                      onSave={(value) => editItem(id, value, false)}
                    />
                  </details>
                ) : null;
              })}
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
              {isBoundary(selectedResource) && (
                <div className="detail-actions">
                  <button className="toolbar-button" onClick={() => toggle(selectedResource.id)}>
                    {graph?.collapsed.includes(selectedResource.id) ? '展開する' : '折りたたむ'}
                  </button>
                  <button
                    className="toolbar-button"
                    onClick={() => {
                      dispatchHistory({
                        type: 'commit',
                        update: (current) => ({
                          ...current,
                          collapsed: current.collapsed.filter((id) => id !== selectedResource.id),
                          expanded: [...new Set([...current.expanded, selectedResource.id])],
                          scope: selectedResource.id,
                        }),
                      });
                    }}
                  >
                    詳細へ移動
                  </button>
                </div>
              )}
              <h3>属性</h3>
              <PropertyEditor
                key={`${documentVersion}-${selectedResource.id}`}
                resource={selectedResource}
                onSave={(value) => editItem(selectedResource.id, value, true)}
              />
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
