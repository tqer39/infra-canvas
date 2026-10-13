import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, BaseEdge, getSmoothStepPath, applyNodeChanges, useReactFlow, type Node, type Edge, type NodeProps, type EdgeProps, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style.css';
import { parseDSL } from '../core/parser';
import { validateDiagram } from '../core/validate.js';
import { serializeDSL } from '../core/serialize';
import { buildDisplayGraph } from '../core/display';
import { layoutGraph } from '../core/layout';
import { isBoundary, type Diagram, type Resource, type DisplayGraph } from '../core/model';
import { getIcon } from '../assets/icons';
import defaultSource from '../../examples/aws.infra?raw';

declare global { interface Window { __INFRA_CANVAS__?: Diagram } }
type ResourceData = Record<string, unknown> & { resource: Resource; collapsed: boolean; onToggle: (id: string) => void; related: boolean; muted: boolean };
type ResourceNode = Node<ResourceData>;
const kindLabels: Record<string, string> = { traffic: '通信', dependency: '依存', auth: '認証', deploy: 'デプロイ', association: '関連' };
const kindColors: Record<string, string> = { traffic: '#55749a', dependency: '#8b93a3', auth: '#ad7633', deploy: '#8165b0', association: '#258d81' };
const viewLabels: Record<string, string> = { overview: '概要', service: 'サービス', network: 'ネットワーク', security: 'セキュリティ' };

function ResourceCard({ data }: NodeProps<ResourceNode>) {
  const { resource, collapsed, onToggle, related, muted } = data;
  const boundary = isBoundary(resource);
  const icon = getIcon(resource.type);
  return <div className={`resource-card ${boundary && !collapsed ? 'boundary-card' : ''} ${related ? 'related' : ''} ${muted ? 'muted' : ''}`}>
    <Handle type="target" position={Position.Left} /><Handle type="source" position={Position.Right} />
    <div className="resource-heading">
      {icon ? <img className="service-icon" src={icon} alt="" /> : <span className={`fallback-icon ${boundary ? 'boundary-icon' : ''}`} aria-hidden="true">{boundary ? '▦' : '◇'}</span>}
      <div className="resource-text"><span className="resource-type">{resource.type}</span><strong title={resource.label}>{resource.label}</strong></div>
      {boundary && <button className="boundary-toggle nodrag nopan" onClick={(event) => { event.stopPropagation(); onToggle(resource.id); }} title={collapsed ? '展開' : '折りたたむ'} aria-label={`${resource.label}を${collapsed ? '展開' : '折りたたむ'}`}>{collapsed ? '+' : '−'}</button>}
    </div>
    {collapsed && <span className="collapsed-hint">折りたたみ中</span>}
    {resource.unresolved?.length ? <span className="unresolved-badge" title={resource.unresolved.join(' / ')}>未解決 {resource.unresolved.length}</span> : null}
  </div>;
}
const nodeTypes = { resource: ResourceCard };
type RouteData = { points: { x: number; y: number }[]; label?: { x: number; y: number } };
function RoutedConnection(props: EdgeProps) {
  const route = props.data?.route as RouteData | undefined;
  const fallback = getSmoothStepPath(props);
  const path = route?.points.length ? route.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ') : fallback[0];
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} markerStart={props.markerStart} style={props.style} label={props.label} labelX={route?.label?.x ?? fallback[1]} labelY={route?.label?.y ?? fallback[2]} labelStyle={props.labelStyle} labelBgStyle={props.labelBgStyle} labelBgPadding={props.labelBgPadding} />;
}
const edgeTypes = { routed: RoutedConnection };

function App() {
  const initial = useMemo(() => window.__INFRA_CANVAS__ ?? parseDSL(defaultSource).diagram, []);
  const [diagram, setDiagram] = useState<Diagram | undefined>(initial);
  const [source, setSource] = useState(() => initial ? serializeDSL(initial) : defaultSource);
  const [editorOpen, setEditorOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [view, setView] = useState('service');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [scope, setScope] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const [query, setQuery] = useState('');
  const [nodes, setNodes] = useState<ResourceNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [graph, setGraph] = useState<DisplayGraph>();
  const [layoutTime, setLayoutTime] = useState(0);
  const [busy, setBusy] = useState(false);
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
  useEffect(() => () => { if (measurementFrame.current !== undefined) cancelAnimationFrame(measurementFrame.current); }, []);
  const flow = useReactFlow<ResourceNode>();
  const upload = useRef<HTMLInputElement>(null);
  const graphRef = useRef<DisplayGraph | undefined>(undefined);
  graphRef.current = graph;
  const toggle = useCallback((id: string) => {
    const isCollapsed = graphRef.current?.collapsed.includes(id) ?? false;
    setCollapsed((current) => isCollapsed ? current.filter((item) => item !== id) : [...current, id]);
    setExpanded((current) => isCollapsed ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }, []);
  const visibleDiagram = useMemo(() => {
    if (!diagram || !scope) return diagram;
    const ids = new Set([scope]);
    let changed = true;
    while (changed) { changed = false; for (const resource of diagram.resources) if (resource.parentId && ids.has(resource.parentId) && !ids.has(resource.id)) { ids.add(resource.id); changed = true; } }
    return { ...diagram, resources: diagram.resources.filter((resource) => ids.has(resource.id)).map((resource) => resource.id === scope ? { ...resource, parentId: undefined } : resource), connections: diagram.connections.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
  }, [diagram, scope]);
  useEffect(() => {
    if (!visibleDiagram) return;
    let active = true;
    setBusy(true);
    const display = buildDisplayGraph(visibleDiagram, { view, collapsed, expanded });
    layoutGraph(display, { direction: visibleDiagram.views.find((item) => item.id === view)?.direction }).then((layout) => {
      if (!active) return;
      const placements = new Map(layout.nodes.map((node) => [node.id, node]));
      const routes = new Map((layout.edges ?? []).map((edge) => [edge.id, edge]));
      const sorted = [...display.resources];
      const depth = (resource: Resource): number => { let count = 0; let parent = resource.parentId; const visited = new Set<string>(); while (parent && !visited.has(parent)) { visited.add(parent); count++; parent = display.resources.find((item) => item.id === parent)?.parentId; } return count; };
      sorted.sort((a, b) => depth(a) - depth(b));
      setNodes(sorted.map((resource) => { const placement = placements.get(resource.id)!; return { id: resource.id, type: 'resource', position: { x: placement.x, y: placement.y }, parentId: placement.parentId, extent: placement.parentId ? 'parent' as const : undefined, draggable: false, width: placement.width, height: placement.height, measured: { width: Math.round(placement.width), height: Math.round(placement.height) }, style: { width: placement.width, height: placement.height }, data: { resource, collapsed: display.collapsed.includes(resource.id), onToggle: toggle, related: false, muted: false } }; }));
      setEdges(display.connections.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: [edge.attributes.label ?? kindLabels[edge.kind], edge.attributes.protocol, edge.attributes.port].filter((value) => value !== undefined).join(' · '), markerEnd: { type: MarkerType.ArrowClosed, color: kindColors[edge.kind] }, style: { stroke: kindColors[edge.kind], strokeWidth: 1.7, strokeDasharray: edge.kind === 'dependency' ? '5 4' : edge.kind === 'association' ? '2 4' : undefined }, labelStyle: { fill: '#4a5870', fontSize: 10 }, labelBgStyle: { fill: '#fff', fillOpacity: 0.95 }, labelBgPadding: [5, 3] as [number, number], type: 'routed', data: { route: routes.get(edge.id) } })));
      setGraph(display); setLayoutTime(layout.durationMs); setBusy(false);
    }).catch((error: unknown) => { if (active) { setBusy(false); setDiagnostics([`配置に失敗しました: ${error instanceof Error ? error.message : String(error)}`]); } });
    return () => { active = false; };
  }, [visibleDiagram, view, collapsed, expanded, toggle]);
  useEffect(() => { if (nodes.length) { const frame = requestAnimationFrame(() => { void flow.fitView({ padding: 0.14, duration: 250 }); }); return () => cancelAnimationFrame(frame); } }, [graph, flow]);
  const activeId = selected ?? hovered;
  const focus = activeId ? graph?.representative[activeId] ?? activeId : undefined;
  const related = useMemo(() => { const ids = new Set<string>(); if (focus) { ids.add(focus); graph?.connections.forEach((edge) => { if (edge.source === focus || edge.target === focus) { ids.add(edge.source); ids.add(edge.target); } }); } return ids; }, [focus, graph]);
  const renderedNodes = useMemo(() => nodes.map((node) => ({ ...node, selected: node.id === (selected ? graph?.representative[selected] ?? selected : undefined), data: { ...node.data, related: related.has(node.id), muted: Boolean(focus) && !related.has(node.id) && !isBoundary(node.data.resource) } })), [nodes, selected, related, focus, graph]);
  const renderedEdges = useMemo(() => edges.map((edge) => { const match = edge.source === focus || edge.target === focus; return { ...edge, zIndex: match ? 10 : 1, style: { ...edge.style, strokeWidth: match ? 3.5 : 1.7, opacity: focus && !match ? 0.14 : 1 } }; }), [edges, focus]);
  const selectedResource = diagram?.resources.find((resource) => resource.id === selected);
  const selectedRelations = [...(diagram?.connections ?? []), ...(graph?.connections.filter((edge) => !diagram?.connections.some((original) => original.id === edge.id)) ?? [])].filter((edge) => edge.source === selected || edge.target === selected);
  const matches = query.trim() ? diagram?.resources.filter((resource) => `${resource.id} ${resource.label} ${resource.type}`.toLowerCase().includes(query.toLowerCase())).slice(0, 40) ?? [] : [];
  const pendingFocus = useRef<{ id: string; previousGraph?: DisplayGraph } | undefined>(undefined);
  const focusResource = (id: string) => {
    setSelected(id); setQuery(''); pendingFocus.current = { id, previousGraph: graph }; setScope(undefined);
    const ancestors = new Set<string>(); let resource = diagram?.resources.find((item) => item.id === id);
    while (resource?.parentId && !ancestors.has(resource.parentId)) { ancestors.add(resource.parentId); resource = diagram?.resources.find((item) => item.id === resource!.parentId); }
    setCollapsed((current) => current.filter((ancestor) => !ancestors.has(ancestor)));
    setExpanded((current) => [...new Set([...current, ...ancestors])]);
    if (diagram?.resources.find((item) => item.id === id)?.type === 'sg') setView('security');
  };
  useEffect(() => { const pending = pendingFocus.current; if (!pending || graph === pending.previousGraph) return; const representative = pending.id; if (nodes.some((node) => node.id === representative)) { const frame = requestAnimationFrame(() => { void flow.fitView({ nodes: [{ id: representative }], padding: 0.7, maxZoom: 1.2, duration: 450 }); pendingFocus.current = undefined; }); return () => cancelAnimationFrame(frame); } }, [nodes, graph, flow]);
  const acceptDiagram = (next: Diagram) => { const nextSource = serializeDSL(next); setSource(nextSource); setDiagram(next); setCollapsed([]); setExpanded([]); setScope(undefined); setSelected(undefined); setDiagnostics(next.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`)); };
  const apply = () => { const result = parseDSL(source); setDiagnostics(result.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`)); if (result.diagram) acceptDiagram(result.diagram); };
  const importFile = async (file?: File) => { if (!file) return; try { const text = await file.text(); if (file.name.endsWith('.json')) { const next = validateDiagram(JSON.parse(text) as unknown); acceptDiagram(next); } else { setSource(text); const parsed = parseDSL(text); setDiagnostics(parsed.diagnostics.map((item) => `${item.line}:${item.column} ${item.message}`)); if (parsed.diagram) acceptDiagram(parsed.diagram); } } catch (error) { setDiagnostics([error instanceof Error ? error.message : String(error)]); } if (upload.current) upload.current.value = ''; };
  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark" aria-hidden="true">▧</div><div className="brand"><strong>Infra Canvas</strong><span>インフラを、見渡す。</span></div><div className="document-title">{diagram?.title ?? '構成図'}</div><button className="toolbar-button" onClick={() => upload.current?.click()}>ファイルを開く</button><button className={`toolbar-button ${editorOpen ? 'active' : ''}`} onClick={() => setEditorOpen(!editorOpen)}>DSL を編集</button><input ref={upload} type="file" accept=".infra,.dsl,.txt,.json" hidden onChange={(event) => { void importFile(event.target.files?.[0]); }} /></header>
    <section className="workspace">
      {editorOpen && <aside className="editor-panel"><div className="panel-title"><strong>DSL エディター</strong><span>変更を図に反映</span></div><textarea aria-label="DSL 入力" spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)} /><button className="primary-button" onClick={apply}>解析して反映</button><p className="editor-hint">構文エラーがある場合は、現在の図を保持します。</p></aside>}
      <div className="canvas-area"><div className="canvas-toolbar"><div className="view-tabs" aria-label="表示の切り替え">{Object.entries(viewLabels).map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div><div className="search-box"><span aria-hidden="true">⌕</span><input placeholder="リソースを検索…" aria-label="リソース検索" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <div className="search-results">{matches.length ? matches.map((resource) => <button key={resource.id} onClick={() => focusResource(resource.id)}><strong>{resource.label}</strong><span>{resource.type} · {resource.id}</span></button>) : <p>該当するリソースがありません</p>}</div>}</div></div>
        {scope && <div className="scope-bar"><button onClick={() => setScope(undefined)}>← 全体へ戻る</button><span>{diagram?.resources.find((resource) => resource.id === scope)?.label} の詳細</span></div>}
        <ReactFlow<ResourceNode> nodes={renderedNodes} onNodesChange={onNodesChange} edges={renderedEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodeMouseEnter={(_, node) => setHovered(node.id)} onNodeMouseLeave={() => setHovered(undefined)} onNodeClick={(_, node) => setSelected(node.id)} onPaneClick={() => setSelected(undefined)} minZoom={0.05} maxZoom={2.5} nodesDraggable={false} nodesConnectable={false} fitView><Background gap={24} size={1} color="#d9e1ea" /><Controls showInteractive={false} /><MiniMap style={{ width: 155, height: 100 }} ariaLabel="構成図のミニマップ" nodeColor={(node) => isBoundary((node.data as ResourceData).resource) ? '#d9e7ed' : '#9ab6c1'} pannable zoomable /></ReactFlow>
        {busy && <div className="layout-status" role="status">構成を配置しています…</div>}
        <div className="canvas-footer"><span>{graph?.resources.length ?? 0} 要素 · {graph?.connections.length ?? 0} 接続</span><div className="edge-legend">{Object.entries(kindLabels).map(([kind, label]) => <span key={kind}><i style={{ background: kindColors[kind] }} />{label}</span>)}</div><span>配置 {Math.round(layoutTime)} ms</span></div>
      </div>
      <aside className="detail-panel">{selectedResource ? <><div className="detail-type">{selectedResource.type}</div><h2>{selectedResource.label}</h2><code className="resource-id">{selectedResource.id}</code>{isBoundary(selectedResource) && <div className="detail-actions"><button className="toolbar-button" onClick={() => toggle(selectedResource.id)}>{graph?.collapsed.includes(selectedResource.id) ? '展開する' : '折りたたむ'}</button><button className="toolbar-button" onClick={() => { setCollapsed((current) => current.filter((id) => id !== selectedResource.id)); setExpanded((current) => [...new Set([...current, selectedResource.id])]); setScope(selectedResource.id); }}>詳細へ移動</button></div>}<h3>属性</h3>{Object.entries(selectedResource.attributes).length ? <dl>{Object.entries(selectedResource.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(', ') : String(value)}</dd></div>)}</dl> : <p className="muted-copy">追加属性なし</p>}<h3>関係 <span>{selectedRelations.length}</span></h3><div className="relations">{selectedRelations.map((edge) => { const other = edge.source === selected ? edge.target : edge.source; return <button key={edge.id} onClick={() => focusResource(other)}><span className="relation-kind">{edge.source === selected ? '→' : '←'} {kindLabels[edge.kind]}</span><strong>{diagram?.resources.find((resource) => resource.id === other)?.label ?? other}</strong><span>{Object.entries(edge.attributes).map(([key, value]) => `${key}=${String(value)}`).join(' · ')}</span></button>; })}</div><h3>取り込み元</h3><dl>{Object.entries(selectedResource.provenance ?? { kind: 'design' }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}{selectedResource.location && <div><dt>DSL</dt><dd>{selectedResource.location.line}:{selectedResource.location.column}</dd></div>}</dl>{selectedResource.unresolved?.length ? <><h3>未解決情報</h3>{selectedResource.unresolved.map((message) => <p className="warning-copy" key={message}>{message}</p>)}</> : null}</> : <div className="empty-details"><div aria-hidden="true">⌁</div><h2>構成を探索</h2><p>要素をクリックすると、属性・関係・取り込み元を確認できます。</p><p>ホバーで関係を強調し、クリックで固定します。境界の − / + で詳細を展開できます。</p><span className="info-pill">ズームと表示の抽象度は独立</span></div>}</aside>
    </section>{diagnostics.length > 0 && <div className="diagnostics" role="alert"><button aria-label="診断を閉じる" onClick={() => setDiagnostics([])}>×</button>{diagnostics.map((message, index) => <p key={index}>{message}</p>)}</div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><ReactFlowProvider><App /></ReactFlowProvider></StrictMode>);
