import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export interface Definition { address: string; type: string; file: string; line: number; attributes: Record<string, string>; repeated: boolean }
export interface Sources { definitions: Map<string, Definition>; modules: Map<string, { file: string; line: number }>; warnings: string[] }
interface Token { text: string; start: number; end: number; line: number }
// HCL は評価せず、式を不透明なソース断片として保持します。
function tokens(text: string): Token[] {
  const out: Token[] = []; let i = 0; let line = 1;
  while (i < text.length) {
    const start = i; const at = line; const c = text[i]!;
    if (/\s/.test(c)) { if (c === '\n') line++; i++; continue; }
    if (c === '#' || text.slice(i, i + 2) === '//') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (text.slice(i, i + 2) === '/*') { i += 2; while (i < text.length && text.slice(i, i + 2) !== '*/') { if (text[i] === '\n') line++; i++; } i += 2; continue; }
    if (text.slice(i, i + 2) === '<<') { const match = /^<<-?(\w+)[^\n]*\n/.exec(text.slice(i)); if (match) { i += match[0].length; line++; while (i < text.length) { const end = text.indexOf('\n', i); const stop = end < 0 ? text.length : end; const body = text.slice(i, stop); i = stop + 1; line++; if (body.trim() === match[1]) break; } out.push({ text: '<heredoc>', start, end: i, line: at }); continue; } }
    if (c === '"') { i++; while (i < text.length) { const ch = text[i++]!; if (ch === '\n') line++; if (ch === '\\') i++; else if (ch === '"') break; } }
    else if (/[\w-]/.test(c)) { while (i < text.length && /[\w-]/.test(text[i]!)) i++; }
    else i++;
    out.push({ text: text.slice(start, i), start, end: i, line: at });
  }
  return out;
}
function literal(text: string | undefined): string | undefined { if (!text || !/^"[^"\n]*"$/.test(text) || text.includes('${')) return; try { return JSON.parse(text) as string; } catch { return; } }
export async function readSources(repository: string, root: string): Promise<Sources> {
  const result: Sources = { definitions: new Map(), modules: new Map(), warnings: [] }; const base = await realpath(repository);
  async function visit(directory: string, prefix: string, ancestors: Set<string>): Promise<void> {
    let actual: string;
    try { actual = await realpath(directory); } catch { result.warnings.push('ローカル module のソースを読み取れません。'); return; }
    if (actual !== base && !actual.startsWith(base + path.sep)) { result.warnings.push('リポジトリ外の module は読み取り対象外です。'); return; }
    if (ancestors.has(actual)) { result.warnings.push('循環する module ソースを読み取り対象外にしました。'); return; }
    const next = new Set(ancestors).add(actual);
    const entries = (await readdir(actual, { withFileTypes: true })).filter(e => e.isFile() && e.name.endsWith('.tf')).sort((a,b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.relative(base, path.join(actual, entry.name)); const content = await readFile(path.join(actual, entry.name), 'utf8'); const stream = tokens(content);
      for (let i = 0; i < stream.length; i++) {
        const head = stream[i]!; if (!['resource', 'data', 'module'].includes(head.text)) continue;
        const labels: string[] = []; let j = i + 1;
        while (stream[j]?.text.startsWith('"')) { const label = literal(stream[j]!.text); if (label === undefined) break; labels.push(label); j++; }
        if (stream[j]?.text !== '{' || labels.length !== (head.text === 'module' ? 1 : 2)) continue;
        const attrs: Record<string,string> = {}; let depth = 1; j++;
        while (j < stream.length && depth > 0) {
          const t = stream[j]!;
          if (depth === 1 && /^[\w-]+$/.test(t.text) && stream[j+1]?.text === '=') {
            const key = t.text; j += 2; const first = stream[j]; let nested = 0; const begin = first?.start ?? t.end;
            while (j < stream.length) {
              const v = stream[j]!;
              if (nested === 0 && (v.text === '}' || (v.line > (stream[j-1]?.line ?? v.line) && /^[\w-]+$/.test(v.text) && ['=', '{'].includes(stream[j+1]?.text ?? '')) || (j > 0 && /^[\w-]+$/.test(v.text) && stream[j+1]?.text === '='))) break;
              if (['[','{','('].includes(v.text)) nested++; if ([']','}',')'].includes(v.text)) nested--; j++;
            }
            attrs[key] = content.slice(begin, stream[j-1]?.end ?? begin).trim(); continue;
          }
          if (t.text === '{') depth++; if (t.text === '}') depth--; j++;
        }
        i = j - 1;
        if (head.text === 'module') {
          const address = prefix + 'module.' + labels[0]; result.modules.set(address, { file, line: head.line });
          const source = literal(attrs.source);
          if (source?.startsWith('./') || source?.startsWith('../')) await visit(path.resolve(actual, source), address + '.', next);
          else result.warnings.push('外部 module のソース位置は未解決です。');
        } else {
          const address = prefix + (head.text === 'data' ? 'data.' : '') + labels.join('.');
          result.definitions.set(address, { address, type: labels[0]!, file, line: head.line, attributes: attrs, repeated: attrs.count !== undefined || attrs.for_each !== undefined });
        }
      }
    }
  }
  await visit(path.resolve(repository, root), '', new Set()); return result;
}
export function definitionAddress(address: string): string { return address.replace(/\[(?:\d+|"(?:\\.|[^"\\])*")\]/g, ''); }
export function staticLiteral(expression: string): unknown { try { return JSON.parse(expression); } catch { return undefined; } }
