import { absolutePlacements, bridgePath } from './geometry.js';
import { buildDisplayGraph } from './display.js';
import { layoutGraph, connectionLabel } from './layout.js';
import { resourceMetadata } from './resource-metadata.js';
import { resourceContent } from './content.js';
import {
  resourceTypeLabel,
  resourceAppearance,
  evidenceLabels,
  changeLabels,
  exposureLabels,
} from './presentation.js';
import {
  isBoundary,
  type Diagram,
  type DisplayGraph,
  type LayoutResult,
  type Resource,
  type DisplayOptions,
} from './model.js';
import { validateDiagram } from './validate.js';

export const connectionColors: Record<string, string> = {
  traffic: '#55749a',
  dependency: '#8b93a3',
  auth: '#ad7633',
  deploy: '#8165b0',
  association: '#258d81',
  replication: '#287ca0',
  failover: '#bb5d43',
};
export const connectionKinds: Record<string, string> = {
  traffic: '通信',
  dependency: '依存',
  auth: '認証',
  deploy: 'デプロイ',
  association: '関連',
  replication: '複製',
  failover: '切替',
};
export interface StaticOptions extends DisplayOptions {
  icons?: Record<string, string>;
}
const escape = (value: unknown): string =>
  String(value)
    .split('')
    .filter((char) => char.charCodeAt(0) >= 32 || ['\n', '\r', '\t'].includes(char))
    .join('')
    .replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
const text = (x: number, y: number, value: string, size = 12, extra = ''): string =>
  `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escape(value)}</text>`;
function wrap(value: string, width: number, size = 12): string[] {
  const capacity = Math.max(1, Math.floor(width / (size * 0.58)));
  const lines: string[] = [];
  for (const line of value.split('\n')) {
    let current = '',
      units = 0;
    for (const char of line) {
      const n = char.codePointAt(0)! > 255 ? 2 : 1;
      if (units + n > capacity && current) {
        lines.push(current);
        current = '';
        units = 0;
      }
      current += char;
      units += n;
    }
    lines.push(current);
  }
  return lines;
}
const block = (x: number, y: number, value: string, width: number, size = 12): string =>
  wrap(value, width, size)
    .map((line, index) => text(x, y + index * 18, line, size))
    .join('');

/** 同じ表示モデル・座標で、外部通信やforeignObjectを含まないSVGを生成する。 */
export function renderSVG(
  title: string,
  graph: DisplayGraph,
  layout: LayoutResult,
  options: StaticOptions = {},
): string {
  const rectangles = absolutePlacements(layout.nodes);
  const labels =
    layout.edges?.flatMap((edge) =>
      edge.label
        ? [
            {
              x:
                edge.label.x -
                connectionLabel(graph.connections.find((item) => item.id === edge.id)!).length * 7,
              y: edge.label.y - 16,
              width:
                connectionLabel(graph.connections.find((item) => item.id === edge.id)!).length * 14,
              height: 32,
            },
          ]
        : [],
    ) ?? [];
  const boxes = [
    ...rectangles.values(),
    ...(layout.overlays ?? []),
    ...(layout.overlays ?? []).map((box) => ({
      x: box.labelX ?? box.x,
      y: box.labelY ?? box.y,
      width: box.labelWidth ?? 160,
      height: box.labelHeight ?? 32,
    })),
    ...(layout.annotations ?? []),
    ...labels,
  ];
  const points = layout.edges?.flatMap((edge) => edge.points) ?? [];
  const minX = Math.min(0, ...boxes.map((box) => box.x), ...points.map((p) => p.x)) - 32;
  const top = Math.min(0, ...boxes.map((box) => box.y), ...points.map((p) => p.y)) - 100;
  const width = Math.max(
    860,
    Math.max(0, ...boxes.map((box) => box.x + box.width), ...points.map((p) => p.x)) - minX + 32,
  );
  const height = Math.max(
    300,
    Math.max(0, ...boxes.map((box) => box.y + box.height), ...points.map((p) => p.y)) - top + 130,
  );
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${top} ${width} ${height}" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title><defs>${Object.entries(
      connectionColors,
    )
      .map(
        ([kind, color]) =>
          `<marker id="arrow-${kind}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${color}"/></marker>`,
      )
      .join(
        '',
      )}</defs><rect x="${minX}" y="${top}" width="${width}" height="${height}" fill="#fff"/><g font-family="system-ui, sans-serif" fill="#253b49">`,
    block(minX + 24, top + 30, title, width - 48, 20),
  ];
  const card = (resource: Resource): string => {
    const box = rectangles.get(resource.id)!;
    const boundary = isBoundary(resource) && !graph.collapsed.includes(resource.id);
    const appearance = resourceAppearance(resource);
    const fill = appearance.background ?? (boundary ? '#f1f6f8' : '#fff');
    const border = appearance.borderColor ?? '#afc6d2';
    const shape = String(resource.attributes.appearance ?? 'default');
    let result = `<g data-resource-id="${escape(resource.id)}" opacity="${appearance.opacity ?? 1}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${shape === 'storage' ? 0 : shape === 'database' ? 18 : 10}" fill="${fill}" stroke="${border}" ${appearance.borderStyle === 'dashed' ? 'stroke-dasharray="6 4"' : ''}/>`;
    if (shape === 'database')
      result += `<ellipse cx="${box.x + box.width / 2}" cy="${box.y + 12}" rx="${box.width / 2}" ry="12" fill="none" stroke="${border}"/>`;
    if (shape === 'queue' || shape === 'rack')
      result += [12, 20, 28]
        .map(
          (offset) =>
            `<path d="M${box.x + box.width - 36} ${box.y + offset} h22" stroke="${border}"/>`,
        )
        .join('');
    const icon = options.icons?.[resource.id];
    if (icon) {
      if (!/^data:image\/(?:svg\+xml|png)[;,]/.test(icon))
        throw new Error('静的出力のアイコンには同梱画像のdata URLを指定してください。');
      result += `<image href="${escape(icon)}" x="${box.x + 12}" y="${box.y + 14}" width="24" height="24"/>`;
    }
    result += text(box.x + 44, box.y + 16, resourceTypeLabel(resource), 10);
    const lines = wrap(resource.label, box.width - 64, 14);
    result += lines
      .map((line, index) =>
        text(
          box.x + 44,
          box.y + 34 + index * 18,
          line,
          14,
          resource.attributes.change === 'remove' ? 'text-decoration="line-through"' : '',
        ),
      )
      .join('');
    let y = box.y + 52 + (lines.length - 1) * 18;
    for (const metadata of resourceMetadata(resource)) {
      result += text(box.x + 14, y, metadata.label, 11);
      result += block(box.x + 118, y, metadata.value, box.width - 132, 12);
      y += wrap(metadata.value, box.width - 132, 12).length * 18 + 4;
    }
    const content = resourceContent(resource);
    if (content) {
      const rows =
        content.kind === 'table'
          ? [content.columns, ...content.rows]
          : content.items.map((item) => [item]);
      const columnCount = content.kind === 'table' ? content.columns.length : 1;
      const cellWidth = (box.width - 28) / columnCount;
      for (const row of rows) {
        const h = Math.max(...row.map((cell) => wrap(cell, cellWidth - 20).length)) * 18 + 12;
        row.forEach((cell, index) => {
          result +=
            `<rect x="${box.x + 14 + cellWidth * index}" y="${y - 12}" width="${cellWidth}" height="${h}" fill="none" stroke="#d9e1ea"/>` +
            block(box.x + 24 + cellWidth * index, y + 2, cell, cellWidth - 20);
        });
        y += h;
      }
    }
    if (graph.collapsed.includes(resource.id))
      result += text(box.x + 14, box.y + box.height - 12, '折りたたみ中', 10);
    if (resource.unresolved?.length)
      result += text(
        box.x + 14,
        box.y + box.height - 12,
        `未解決 ${resource.unresolved.length}`,
        10,
      );
    return result + '</g>';
  };
  for (const resource of graph.resources.filter(
    (resource) => isBoundary(resource) && !graph.collapsed.includes(resource.id),
  ))
    parts.push(card(resource));
  for (const [index, edge] of (layout.edges ?? []).entries()) {
    const connection = graph.connections.find((item) => item.id === edge.id)!;
    const color =
      connection.attributes.change === 'modify'
        ? '#b27616'
        : connection.attributes.change === 'add'
          ? '#258454'
          : connection.attributes.change === 'remove'
            ? '#ad4848'
            : connectionColors[connection.kind]!;
    parts.push(
      `<defs><marker id="arrow-edge-${index}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${color}"/></marker></defs>`,
    );
    parts.push(
      `<path data-edge-id="${escape(edge.id)}" d="${bridgePath(
        edge.points,
        (layout.edges ?? []).slice(0, index).map((other) => other.points),
      )}" fill="none" stroke="${color}" stroke-width="1.7" marker-end="url(#arrow-edge-${index})" ${['dependency', 'association', 'failover'].includes(connection.kind) || connection.attributes.change === 'remove' ? 'stroke-dasharray="6 4"' : ''}/>`,
    );
  }
  for (const resource of graph.resources.filter(
    (resource) => !isBoundary(resource) || graph.collapsed.includes(resource.id),
  ))
    parts.push(card(resource));
  for (const [index, box] of (layout.overlays ?? []).entries()) {
    const resource = graph.overlays?.find((item) => item.id === box.id);
    const style = resource ? resourceAppearance(resource) : {};
    const color = style.borderColor ?? ['#986bb0', '#b17f30', '#287d8b'][index % 3];
    parts.push(
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="12" fill="none" stroke="${color}" stroke-dasharray="7 4"/>`,
      `<rect x="${box.labelX ?? box.x + 12}" y="${box.labelY ?? box.y + 4}" width="${box.labelWidth ?? 160}" height="${box.labelHeight ?? 32}" rx="5" fill="#fff" stroke="${color}"/>` +
        `<g fill="${color}">` +
        block(
          (box.labelX ?? box.x + 12) + 12,
          (box.labelY ?? box.y + 4) + 21,
          box.label,
          (box.labelWidth ?? 160) - 24,
          14,
        ) +
        `</g>`,
    );
  }
  for (const edge of layout.edges ?? []) {
    if (!edge.label) continue;
    if (edge.labelAnchor)
      parts.push(
        `<path d="M${edge.labelAnchor.x} ${edge.labelAnchor.y} L${edge.label.x} ${edge.label.y}" stroke="#97a7b4" stroke-dasharray="2 3"/>`,
      );
    const label = connectionLabel(graph.connections.find((item) => item.id === edge.id)!);
    const w = [...label].reduce((sum, char) => sum + (char.codePointAt(0)! > 255 ? 12 : 7), 0) + 14;
    parts.push(
      `<rect x="${edge.label.x - w / 2}" y="${edge.label.y - 12}" width="${w}" height="24" rx="3" fill="#fff"/>`,
      text(edge.label.x, edge.label.y + 4, label, 12, 'text-anchor="middle"'),
    );
  }
  for (const note of layout.annotations ?? []) {
    if (note.anchor)
      parts.push(
        `<path d="M${note.anchor.x} ${note.anchor.y} L${note.x} ${note.y + 20}" stroke="#ad9544" stroke-dasharray="3 4"/>`,
      );
    parts.push(
      `<rect data-note-id="${escape(note.id)}" x="${note.x}" y="${note.y}" width="${note.width}" height="${note.height}" rx="5" fill="#fff9df" stroke="#c5ae59"/>`,
      block(note.x + 16, note.y + 24, note.label, note.width - 32, 14),
      block(note.x + 16, note.y + 50, note.text, note.width - 32),
    );
  }
  const legendY = top + height - 88;
  parts.push(text(minX + 24, legendY - 4, '凡例', 13));
  Object.entries(connectionKinds).forEach(([kind, label], index) => {
    const x = minX + 24 + index * 114;
    parts.push(
      `<path d="M${x} ${legendY + 15} h24" stroke="${connectionColors[kind]}"/>`,
      text(x + 30, legendY + 19, label),
    );
  });
  parts.push(
    text(
      minX + 24,
      legendY + 44,
      `公開範囲: ${Object.values(exposureLabels).join(' / ')}　根拠: ${Object.values(evidenceLabels).join(' / ')}`,
      11,
    ),
    text(
      minX + 24,
      legendY + 64,
      `変更: ${Object.values(changeLabels).join(' / ')}　※明示された設計・観測情報を表示`,
      11,
    ),
    '</g></svg>',
  );
  return parts.join('');
}
export async function exportSVG(diagram: Diagram, options: StaticOptions = {}): Promise<string> {
  validateDiagram(diagram);
  const graph = buildDisplayGraph(diagram, options);
  const layout = await layoutGraph(graph, {
    direction:
      options.direction ?? diagram.views.find((view) => view.id === options.view)?.direction,
  });
  return renderSVG(diagram.title, graph, layout, options);
}
export interface PrintOptions {
  paper?: 'A4' | 'A3';
  orientation?: 'portrait' | 'landscape';
  scale?: number;
  pages?: 'fit' | 'tile';
}
/** SVGのviewBoxを切り出し、各用紙でクリップする。改ページは明示する。 */
export function printDocument(svg: string, options: PrintOptions = {}): string {
  const paper = options.paper ?? 'A4',
    orientation = options.orientation ?? 'landscape',
    scale = options.scale ?? 1,
    pages = options.pages ?? 'fit';
  if (
    !['A4', 'A3'].includes(paper) ||
    !['portrait', 'landscape'].includes(orientation) ||
    !['fit', 'tile'].includes(pages) ||
    !Number.isFinite(scale) ||
    scale < 0.1 ||
    scale > 2
  )
    throw new Error('用紙・向き・分割方式または縮尺(0.1〜2)が不正です。');
  const dimensions = paper === 'A4' ? [210, 297] : [297, 420];
  const [w, h] =
    orientation === 'landscape'
      ? [dimensions[1]!, dimensions[0]!]
      : [dimensions[0]!, dimensions[1]!];
  const width = ((w - 20) * 96) / 25.4,
    height = ((h - 30) * 96) / 25.4;
  const match = /viewBox="([^"]+)"/.exec(svg);
  if (!match) throw new Error('viewBox付きSVGが必要です。');
  const [x, y, sw, sh] = match[1]!.split(' ').map(Number);
  if (
    [x, y, sw, sh].some((value) => value === undefined || !Number.isFinite(value)) ||
    sw! <= 0 ||
    sh! <= 0
  )
    throw new Error('SVG寸法が不正です。');
  const columns = pages === 'fit' ? 1 : Math.ceil((sw! * scale) / width),
    rows = pages === 'fit' ? 1 : Math.ceil((sh! * scale) / height);
  if (columns * rows > 200)
    throw new Error('分割は200ページ以内にしてください。縮尺を下げてください。');
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const sheets = Array.from({ length: columns * rows }, (_, index) => {
    const vx = pages === 'fit' ? x : x! + ((index % columns) * width) / scale;
    const vy = pages === 'fit' ? y : y! + (Math.floor(index / columns) * height) / scale;
    const vw = pages === 'fit' ? sw : width / scale,
      vh = pages === 'fit' ? sh : height / scale;
    return `<section class="sheet"><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">${inner}</svg><footer>Infra Canvas · ${index + 1}/${columns * rows} · ${escape(paper)} ${escape(orientation)}${pages === 'tile' ? ` · ${scale * 100}%` : ' · 全体を用紙に合わせる'}</footer></section>`;
  });
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>Infra Canvas 印刷</title><style>@page{size:${paper} ${orientation};margin:10mm}body{margin:0;font-family:system-ui,sans-serif}.sheet{width:${w - 20}mm;break-after:page;overflow:hidden}.sheet:last-child{break-after:auto}.sheet svg{display:block;max-width:100%;height:${h - 30}mm}footer{font-size:10px;height:8mm;text-align:center;color:#5d7180}@media screen{body{background:#edf3f6}.sheet{background:white;margin:12px auto;padding:10mm}}</style><body>${sheets.join('')}</body></html>`;
}
