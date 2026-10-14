import { securityRules } from './security.js';
import { isBoundary, type Resource } from './model.js';

export type ResourceContent =
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'list'; items: string[] };

/** HTMLを解釈しない、図上に表示するテキスト表・リスト。 */
export function resourceContent(resource: Resource): ResourceContent | undefined {
  const { display, columns, rows, items } = resource.attributes;
  if (
    resource.type === 'sg' &&
    display === undefined &&
    columns === undefined &&
    rows === undefined &&
    items === undefined &&
    (resource.attributes.ingress !== undefined || resource.attributes.egress !== undefined)
  ) {
    return {
      kind: 'table',
      columns: ['方向', 'プロトコル', 'ポート', '通信相手'],
      rows: securityRules(resource).map(({ direction, rule }) => [
        direction,
        rule.protocol,
        rule.port,
        rule.peer,
      ]),
    };
  }
  if (display === undefined && columns === undefined && rows === undefined && items === undefined)
    return undefined;
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (isBoundary(resource)) throw new Error('表・リストは入れ子境界に指定できません。');
  if (
    display === 'table' &&
    strings(columns) &&
    columns.length &&
    strings(rows) &&
    items === undefined &&
    rows.length % columns.length === 0
  ) {
    return {
      kind: 'table',
      columns,
      rows: Array.from({ length: rows.length / columns.length }, (_, index) =>
        rows.slice(index * columns.length, (index + 1) * columns.length),
      ),
    };
  }
  if (display === 'list' && strings(items) && columns === undefined && rows === undefined)
    return { kind: 'list', items };
  throw new Error(
    'display=table は columns と列数の倍数の rows、display=list は items の文字列配列を指定してください。',
  );
}

const units = (text: string): number =>
  [...text].reduce((sum, c) => sum + (c.codePointAt(0)! > 255 ? 2 : 1), 0);
/** CSSの等幅12px・行高18pxと一致させ、折り返し分も配置入力に含める。 */
export function contentDimensions(content: ResourceContent, width: number): { height: number } {
  const columns = content.kind === 'table' ? content.columns.length : 1;
  const capacity = Math.max(1, Math.floor(((width - 28) / columns - 20) / 7.2));
  const lines = (text: string): number =>
    text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(units(line) / capacity)), 0);
  const rows =
    content.kind === 'table'
      ? [content.columns, ...content.rows]
      : content.items.map((item) => [item]);
  return { height: rows.reduce((sum, row) => sum + Math.max(...row.map(lines)) * 18 + 12, 0) + 16 };
}
