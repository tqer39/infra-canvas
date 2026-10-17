import { sampleGroups } from './samples';
import { resourceTypeLabel, resourceAppearance } from '../core/presentation';
import { renderSVG, printDocument, type PrintOptions } from '../core/static-svg';
import { ChatPanel } from './ChatPanel';
import { Magnifier } from './Magnifier';
import {
  absolutePlacements,
  bridgePath,
  curvedRoutePath,
  nearestPathPoint,
} from '../core/geometry';
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
import { buildDisplayGraph, resolveDisplaySettings } from '../core/display';
import { layoutGraph, connectionLabel } from '../core/layout';
import { telemetrySignalLabels as signalLabels } from '../core/model';
import {
  edgeKinds,
  type EdgeKind,
  isBoundary,
  type Diagram,
  type View,
  type Resource,
  type DisplayGraph,
  type LayoutResult,
} from '../core/model';
import { getIcon, getIconHomepage } from '../assets/icons';
import { getResourceIconType } from '../assets/resource-icons';
import { getCountryFlag } from '../assets/flags';
import { getRegionCountry, getResourceRegion } from '../assets/regions';
import { createHistory, historyReducer } from './history';
import defaultSource from '../../examples/aws.infra?raw';
import { PropertyEditor } from './property-editor';
import { edgeKindLabels as kindLabels, type Attributes, type Connection } from '../core/model';
import { connectionStyles, connectionDescriptions } from './connection-style';

declare global {
  interface Window {
    __INFRA_CANVAS__?: Diagram;
  }
}
type ResourceData = Record<string, unknown> & {
  compact?: boolean;
  resource: Resource;
  collapsed: boolean;
  iconType: string;
  onToggle: (id: string) => void;
  related: boolean;
  muted: boolean;
  contentTop?: number;
};
type ResourceNode = Node<ResourceData>;
const activeEdgeZ = 10;
const detailLabels: Record<View['level'], string> = {
  overview: 'アカウント単位',
  service: 'サービス単位',
  subnet: 'Subnet単位',
  resource: 'リソース単位',
};
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

function ConnectionLegend({
  visibleKinds,
  onToggle,
}: {
  visibleKinds: readonly EdgeKind[];
  onToggle: (kind: EdgeKind) => void;
}) {
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
        <button
          type="button"
          key={kind}
          className="edge-legend-item"
          data-kind={kind}
          style={{ color: connectionStyles[kind].color }}
          aria-pressed={visibleKinds.includes(kind)}
          onClick={() => onToggle(kind)}
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
        </button>
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
          <p>
            現在{visibleKinds.includes(active) ? '表示中' : '非表示'}。クリックで
            {visibleKinds.includes(active) ? '非表示' : '表示'}にします。
          </p>
        </div>
      )}
    </div>
  );
}

function ConnectionHelp({
  visibleKinds,
  onToggle,
}: {
  visibleKinds: readonly EdgeKind[];
  onToggle: (kind: EdgeKind) => void;
}) {
  return (
    <details
      className="connection-help"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          // 凡例の説明を先に閉じ、次のEscapeでパネルを閉じる。
          if (
            event.target instanceof Element &&
            event.target.closest('[aria-describedby="connection-legend-tooltip"]')
          )
            return;
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>線種の意味</summary>
      <section className="connection-help-panel" aria-label="線種の意味と例">
        <h2>線種の意味</h2>
        <ConnectionLegend visibleKinds={visibleKinds} onToggle={onToggle} />
        <div className="connection-help-content">
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
        </div>
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
      className={`resource-card ${data.compact ? 'compact-card' : ''} ${boundary && !collapsed ? 'boundary-card' : ''} ${boundary && resource.type.startsWith('aws.') ? 'detail-boundary-card' : ''} ${collapsed ? 'collapsed-card' : ''} ${related ? 'related' : ''} ${muted ? 'muted' : ''}`}
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
          className={`connection-label nodrag nopan ${props.data?.compact ? 'compact-label' : ''}`}
          style={
            {
              transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
              opacity: props.style?.opacity,
              zIndex: props.selected ? 'var(--edge-label-z-index)' : 2,
              '--connection-color': String(props.style?.stroke ?? '#35556b'),
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
  const { diagram, view, displayLevel, showSG, edgeShape, collapsed, expanded, scope } =
    history.present;
  const setView = (next: string) =>
    dispatchHistory({
      type: 'commit',
      update: (current) => ({ ...current, view: next, displayLevel: undefined, showSG: undefined }),
    });
  const setEdgeShape = (next: 'orthogonal' | 'bezier') =>
    dispatchHistory({ type: 'commit', update: (current) => ({ ...current, edgeShape: next }) });
  const setDiagram = (next: Diagram) =>
    dispatchHistory({
      type: 'commit',
      update: (current) => ({ ...current, diagram: next, source: serializeDSL(next) }),
    });
  const [documentVersion, setDocumentVersion] = useState(0);
  const [source, setSource] = useState(() => (initial ? serializeDSL(initial) : defaultSource));
  const [editorOpen, setEditorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
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
  const displaySettings = resolveDisplaySettings(diagram, { view, level: displayLevel, showSG });
  const effectiveKinds = filterKinds ?? activeView?.kinds ?? [...edgeKinds];
  const toggleKind = (kind: EdgeKind) => {
    setSelectedEdge(undefined);
    setFilterKinds((current) => {
      const kinds = current ?? activeView?.kinds ?? [...edgeKinds];
      return kinds.includes(kind) ? kinds.filter((item) => item !== kind) : [...kinds, kind];
    });
  };
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
  const [magnifierZoom, setMagnifierZoom] = useState<number>();
  const magnifierActive = magnifierZoom !== undefined;
  const magnifierZoomRef = useRef(magnifierZoom);
  magnifierZoomRef.current = magnifierZoom;
  const fitView = (options: Parameters<typeof flow.fitView>[0]) => {
    const zoom = magnifierZoomRef.current;
    return flow.fitView({
      ...options,
      ...(zoom !== undefined
        ? { minZoom: zoom, maxZoom: zoom, interpolate: 'linear' as const }
        : {}),
    });
  };
  useEffect(() => {
    if (!magnifierActive) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setMagnifierZoom(undefined);
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [magnifierActive]);
  const canvas = useRef<HTMLDivElement>(null);
  const mousePan = useRef<MouseEvent | undefined>(undefined);
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === mousePan.current?.button) mousePan.current = undefined;
    };
    const finishPan = () => {
      const start = mousePan.current;
      if (!start) return;
      mousePan.current = undefined;
      // React Flow の d3-zoom は window の mouseup でパンと選択抑止を解除する。
      // 画面外での解除を取り逃した場合も、同じ終了処理を通す。
      window.dispatchEvent(
        new MouseEvent('mouseup', {
          view: window,
          button: start.button,
          clientX: start.clientX,
          clientY: start.clientY,
        }),
      );
    };
    const onMouseMove = (event: MouseEvent) => {
      if (mousePan.current && event.buttons === 0) finishPan();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') finishPan();
    };
    // d3-zoom がドラッグ開始時に登録する window の capture リスナーより先に処理する。
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('blur', finishPan);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      finishPan();
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('blur', finishPan);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
  const displayOptionsAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    const anchor = displayOptionsAnchor.current;
    const toolbar = anchor?.closest('.canvas-toolbar');
    if (!anchor || !toolbar) return;
    const positionPanel = () => {
      const bounds = toolbar.getBoundingClientRect();
      const trigger = anchor.getBoundingClientRect();
      const width = Math.min(340, bounds.width);
      const offset = Math.max(
        bounds.left - trigger.left,
        Math.min(0, bounds.right - trigger.left - width),
      );
      anchor.style.setProperty('--display-options-width', `${width}px`);
      anchor.style.setProperty('--display-options-offset', `${offset}px`);
      anchor.style.setProperty(
        '--display-options-height',
        `${Math.max(120, Math.min(380, window.innerHeight - trigger.bottom - 24))}px`,
      );
    };
    positionPanel();
    const observer = new ResizeObserver(positionPanel);
    observer.observe(toolbar);
    observer.observe(anchor);
    window.addEventListener('resize', positionPanel);
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !anchor.contains(event.target)) setFiltersOpen(false);
    };
    document.addEventListener('click', closeOnOutsideClick, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', positionPanel);
      document.removeEventListener('click', closeOnOutsideClick, true);
    };
  }, [filtersOpen]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (
        magnifierActive &&
        event.target instanceof Element &&
        event.target.closest('.react-flow') &&
        (event.ctrlKey || event.metaKey || (!event.deltaX && !event.shiftKey))
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
  }, [flow, magnifierActive]);
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
        level: displayLevel,
        showSG,
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
        setLabelLayer(activeEdgeZ + Math.max(0, ...sorted.map(depth)) + 2);
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
                compact: layout.compact,
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
                      : connectionStyles[edge.kind].color,
            },
            style: {
              stroke:
                edge.attributes.change === 'add'
                  ? '#258454'
                  : edge.attributes.change === 'remove'
                    ? '#ad4848'
                    : edge.attributes.change === 'modify'
                      ? '#b27616'
                      : connectionStyles[edge.kind].color,
              strokeWidth: 1.7,
              strokeDasharray: ['add', 'remove', 'modify'].includes(String(edge.attributes.change))
                ? '8 5'
                : connectionStyles[edge.kind].dash,
            },
            labelStyle: { fill: '#4a5870', fontSize: 10 },
            labelBgStyle: { fill: '#fff', fillOpacity: 0.95 },
            labelBgPadding: [5, 3] as [number, number],
            type: 'routed',
            data: { route: routes.get(edge.id), kind: edge.kind, compact: layout.compact },
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
    displayLevel,
    showSG,
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
      void fitView({ padding: lastLayout?.compact ? 0.06 : 0.14, duration: 250 });
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
          zIndex: match ? activeEdgeZ : 1,
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
    const ancestors = new Set<string>();
    let resource = diagram?.resources.find((item) => item.id === id);
    while (resource?.parentId && !ancestors.has(resource.parentId)) {
      ancestors.add(resource.parentId);
      resource = diagram?.resources.find((item) => item.id === resource!.parentId);
    }
    const revealSG = diagram?.resources.find((item) => item.id === id)?.type === 'sg';
    const needsLayout =
      scope !== undefined ||
      (revealSG && !displaySettings.showSG) ||
      [...ancestors].some(
        (ancestor) => collapsed.includes(ancestor) || !expanded.includes(ancestor),
      );
    if (!needsLayout) {
      pendingFocus.current = undefined;
      void fitView({ nodes: [{ id }], padding: 0.7, maxZoom: 1.2, duration: 450 });
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
        ...(revealSG ? { showSG: true } : {}),
      }),
    });
  };
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || graph === pending.previousGraph) return;
    const representative = pending.id;
    if (nodes.some((node) => node.id === representative)) {
      const frame = requestAnimationFrame(() => {
        void fitView({
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
    setSource(nextSource);
    dispatchHistory({
      type: 'commit',
      update: (current) => ({
        ...current,
        diagram: next,
        view: 'service',
        displayLevel: undefined,
        showSG: undefined,
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
        <div className="header-actions" role="group" aria-label="ファイル">
          <button className="toolbar-button" onClick={() => upload.current?.click()}>
            ファイルを開く
          </button>
          <select
            className="sample-picker"
            aria-label="サンプル"
            value=""
            onChange={(event) => {
              const sample = sampleGroups
                .flatMap((group) => group.samples)
                .find((item) => item.id === event.target.value);
              if (!sample) return;
              const parsed = parseDSL(sample.source);
              if (parsed.diagram) acceptDiagram(parsed.diagram);
            }}
          >
            <option value="">サンプルを表示</option>
            {sampleGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.samples.map((sample) => (
                  <option key={sample.id} value={sample.id}>
                    {sample.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            className="toolbar-button"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen(!exportOpen)}
          >
            ダウンロード・印刷
          </button>
          <button
            className="toolbar-button"
            onClick={() => {
              if (!diagram) return;
              const data = serializeDSL(diagram);
              const url = URL.createObjectURL(
                new Blob([data], { type: 'text/plain;charset=utf-8' }),
              );
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = 'diagram.infra';
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            DSL を保存
          </button>
        </div>
        <div className="header-actions" role="group" aria-label="編集・相談">
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
        </div>
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
        <section className="export-panel" aria-label="ダウンロード・印刷">
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
          <p>現在のビューと固定位置を反映します。PDFは印刷画面から保存できます。</p>
          {(['svg', 'png', 'pdf'] as const).map((format) => (
            <button
              className="toolbar-button"
              key={format}
              disabled={busy || !lastLayout}
              onClick={() => void exportDrawing(format)}
            >
              {format === 'pdf' ? '印刷 / PDF を保存' : `${format.toUpperCase()} をダウンロード`}
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
        <div
          className="canvas-area"
          ref={canvas}
          style={{ '--edge-label-z-index': labelLayer } as CSSProperties}
        >
          <div className="canvas-toolbar" role="group" aria-label="図の操作">
            <div className="display-controls toolbar-group" role="group" aria-label="表示">
              <button
                className="toolbar-button"
                aria-label="ルーペ"
                aria-pressed={magnifierActive}
                title="ポインター周辺を2倍に拡大（起動中は縮尺を固定・Escで終了）"
                onClick={() => {
                  if (magnifierActive) setMagnifierZoom(undefined);
                  else {
                    const viewport = flow.getViewport();
                    void flow.setViewport(viewport);
                    setMagnifierZoom(viewport.zoom);
                  }
                }}
              >
                ルーペ {magnifierActive ? 'ON' : 'OFF'}
              </button>
              <label className="detail-picker">
                構成の詳しさ
                <select
                  aria-label="構成の詳しさ"
                  value={displaySettings.level}
                  onChange={(event) => {
                    const level = event.target.value as View['level'];
                    dispatchHistory({
                      type: 'commit',
                      update: (current) => ({ ...current, displayLevel: level }),
                    });
                    setSelectedEdge(undefined);
                  }}
                >
                  {Object.entries(detailLabels).map(([level, label]) => (
                    <option key={level} value={level}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="display-options-anchor" ref={displayOptionsAnchor}>
                <button
                  className="toolbar-button"
                  aria-expanded={filtersOpen}
                  aria-controls="display-options"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  表示オプション <span aria-hidden="true">{filtersOpen ? '▴' : '▾'}</span>
                </button>
                <section
                  hidden={!filtersOpen}
                  id="display-options"
                  className="display-filters"
                  aria-label="表示オプション"
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape' || event.defaultPrevented) return;
                    event.stopPropagation();
                    setFiltersOpen(false);
                    canvas.current
                      ?.querySelector<HTMLButtonElement>('[aria-controls="display-options"]')
                      ?.focus();
                  }}
                >
                  <fieldset className="display-additions">
                    <legend>追加情報</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={displaySettings.showSG}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          dispatchHistory({
                            type: 'commit',
                            update: (current) => ({ ...current, showSG: checked }),
                          });
                          setSelectedEdge(undefined);
                        }}
                      />
                      セキュリティグループと所属
                    </label>

                    <label title="冗長化・信頼境界など、所属とは別の囲みを表示します">
                      <input
                        type="checkbox"
                        checked={showMembership}
                        disabled={!overlayBoxes.length}
                        onChange={(event) => setShowMembership(event.target.checked)}
                      />
                      追加の囲み
                    </label>

                    <p className="display-hint">SGの所属は、通信の成立を示しません。</p>
                  </fieldset>
                  <label className="display-setting-row">
                    矢印の形
                    <select
                      aria-label="矢印の形"
                      value={edgeShape}
                      onChange={(event) =>
                        setEdgeShape(event.target.value as 'orthogonal' | 'bezier')
                      }
                    >
                      <option value="orthogonal">直角</option>
                      <option value="bezier">曲線</option>
                    </select>
                  </label>

                  <fieldset>
                    <legend>接続種別</legend>
                    {edgeKinds.map((kind) => (
                      <label key={kind}>
                        <input
                          type="checkbox"
                          checked={effectiveKinds.includes(kind)}
                          onChange={() => toggleKind(kind)}
                        />
                        {kindLabels[kind]}
                      </label>
                    ))}
                  </fieldset>
                  <div className="display-filter-row">
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
                  </div>
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
                  <details className="saved-views">
                    <summary>保存した表示</summary>
                    <div className="display-saved-content">
                      <label>
                        保存した表示
                        <select
                          aria-label="保存した表示"
                          value={view}
                          onChange={(event) => changeView(event.target.value)}
                        >
                          {!diagram?.views.some((item) => item.id === 'service') && (
                            <option value="service">標準表示</option>
                          )}
                          {(diagram?.views ?? []).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label ?? viewLabels[item.id] ?? item.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(displayLevel !== undefined ||
                        showSG !== undefined ||
                        filterKinds !== undefined ||
                        filterRoute !== undefined ||
                        filterPurpose !== undefined) && (
                        <>
                          <span className="display-hint">選択した表示を調整中</span>
                          <button className="toolbar-button" onClick={() => changeView(view)}>
                            保存した設定に戻す
                          </button>
                        </>
                      )}
                    </div>
                  </details>
                  <details className="save-view">
                    <summary>ビューの保存</summary>
                    <div className="display-saved-content">
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
                            level: displaySettings.level,
                            direction: activeView?.direction,
                            overlay: displaySettings.showSG ? 'sg' : undefined,
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
                    </div>
                  </details>
                </section>
              </div>
              <span className="display-summary">
                {effectiveKinds.length === edgeKinds.length
                  ? '接続はすべて'
                  : effectiveKinds.length === 1
                    ? `接続：${kindLabels[effectiveKinds[0]!]}`
                    : `接続 ${effectiveKinds.length} 種類`}
                {(filterRoute === undefined ? activeView?.routes?.length : Boolean(filterRoute))
                  ? ' · 経路を絞り込み'
                  : ''}
                {(
                  filterPurpose === undefined
                    ? activeView?.purposes?.length
                    : Boolean(filterPurpose)
                )
                  ? ' · 用途を絞り込み'
                  : ''}
                {displaySettings.showSG ? ' · SGあり' : ''}
                {showMembership ? ' · 囲みあり' : ''}
              </span>
            </div>
            <div className="toolbar-group" role="group" aria-label="検索・選択">
              <span className="toolbar-group-label">検索・選択</span>
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
            </div>
            <div
              className="toolbar-group boundary-actions"
              role="group"
              aria-label="境界の一括操作"
            >
              <span className="toolbar-group-label">境界</span>
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
            <div className="toolbar-group" role="group" aria-label="配置">
              <span className="toolbar-group-label">配置</span>
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
            </div>
            <div className="canvas-footer" role="group" aria-label="構成情報">
              <span>
                {graph?.resources.length ?? 0} 要素 · {graph?.connections.length ?? 0} 接続
              </span>
              <span>配置 {Math.round(layoutTime)} ms</span>
            </div>
            <div className="toolbar-group" role="group" aria-label="接続・囲み">
              <span className="toolbar-group-label">接続・囲み</span>
              <ConnectionHelp visibleKinds={effectiveKinds} onToggle={toggleKind} />
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
          {editLayout && (
            <aside className="layout-help" role="status">
              カードをドラッグして移動します。移動した配置は固定され、DSLに保存されます。
              「移動を完了」で終了し、「固定を解除」で自動配置に戻せます。
            </aside>
          )}
          <ReactFlow<ResourceNode>
            onMoveStart={(event) => {
              if (event instanceof MouseEvent && event.type === 'mousedown')
                mousePan.current = event;
            }}
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
            minZoom={magnifierZoom ?? 0.05}
            maxZoom={magnifierZoom ?? 2.5}
            zoomOnScroll={!magnifierActive}
            zoomOnPinch={!magnifierActive}
            zoomOnDoubleClick={!magnifierActive}
            zoomActivationKeyCode={magnifierActive ? null : undefined}
            nodesDraggable={editLayout && !scope}
            nodesConnectable={false}
            elevateNodesOnSelect={false}
            elevateEdgesOnSelect={false}
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
            <Controls
              showInteractive={false}
              fitViewOptions={
                magnifierActive ? { minZoom: magnifierZoom, maxZoom: magnifierZoom } : undefined
              }
            />
            <MiniMap
              style={{ width: 155, height: 100 }}
              ariaLabel="構成図のミニマップ"
              nodeColor={(node) =>
                isBoundary((node.data as ResourceData).resource) ? '#d9e7ed' : '#9ab6c1'
              }
              pannable
              zoomable={!magnifierActive}
            />
            {magnifierActive && <Magnifier />}
          </ReactFlow>
          {busy && (
            <div className="layout-status" role="status">
              構成を配置しています…
            </div>
          )}
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
                resourceIconType={getResourceIconType(
                  selectedResource,
                  new Map(diagram?.resources.map((resource) => [resource.id, resource])),
                )}
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
