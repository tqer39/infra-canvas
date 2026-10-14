import type { Diagram } from '../core/model';

export interface ViewerState {
  diagram?: Diagram;
  // 同じ文書の属性編集を戻すときはパン・ズームを維持する。
  documentKey?: object;
  source: string;
  view: string;
  edgeShape: 'orthogonal' | 'bezier';
  collapsed: string[];
  expanded: string[];
  scope?: string;
}

export interface History {
  past: ViewerState[];
  present: ViewerState;
  future: ViewerState[];
}

export type HistoryAction =
  | { type: 'commit'; update: (current: ViewerState) => ViewerState }
  | { type: 'undo' | 'redo' };

export const historyLimit = 100;

export function createHistory(present: ViewerState): History {
  return { past: [], present, future: [] };
}

function diagramContent(diagram?: Diagram): string | undefined {
  if (!diagram) return undefined;
  // 再解析による行・列の変化だけでは新しい編集として扱わない。
  return JSON.stringify({
    ...diagram,
    resources: diagram.resources.map(({ location: _location, ...resource }) => resource),
    connections: diagram.connections.map(({ location: _location, ...connection }) => connection),
  });
}

function sameState(a: ViewerState, b: ViewerState): boolean {
  const sameIds = (left: string[], right: string[]) =>
    left.length === right.length && left.every((id) => right.includes(id));
  return (
    a.source === b.source &&
    a.view === b.view &&
    a.edgeShape === b.edgeShape &&
    a.scope === b.scope &&
    sameIds(a.collapsed, b.collapsed) &&
    sameIds(a.expanded, b.expanded) &&
    (a.diagram === b.diagram || diagramContent(a.diagram) === diagramContent(b.diagram))
  );
}

export function historyReducer(history: History, action: HistoryAction): History {
  if (action.type === 'commit') {
    const next = action.update(history.present);
    if (sameState(history.present, next)) return history;
    return {
      past: [...history.past, history.present].slice(-historyLimit),
      present: next,
      future: [],
    };
  }
  if (action.type === 'undo') {
    const previous = history.past.at(-1);
    if (!previous) return history;
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
    };
  }
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}
