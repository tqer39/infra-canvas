import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { parseDSL } from './core/parser.js';
import { serializeDSL } from './core/serialize.js';
import type { Diagram } from './core/model.js';
import { validateDiagram } from './core/validate.js';
import { importTerraformRepository } from './terraform/index.js';
import { embedDiagram, exportHTML } from './export.js';
import { fileURLToPath } from 'node:url';

const help = `Infra Canvas\n\n  validate <file.infra>\n  preview <file.infra|model.json> [--port 5180]\n  import <repository> [--root .] [--json plan.json] [--out model.json] [--dsl output.infra]\n  dsl <model.json> --out output.infra\n  html <file.infra|model.json> --out diagram.html\n\nTerraform の JSON は terraform show -json で事前に生成してください。\n`;

export async function loadDiagram(path: string): Promise<Diagram> {
  const source = await readFile(path, 'utf8');
  if (path.endsWith('.json')) {
    return validateDiagram(JSON.parse(source) as unknown);
  }
  const result = parseDSL(source);
  if (!result.diagram || result.diagnostics.some(d => d.severity === 'error')) {
    for (const d of result.diagnostics) console.error(`${path}:${d.line}:${d.column} [${d.code}] ${d.message}`);
    throw new Error('DSL を修正してください。');
  }
  return result.diagram;
}

async function main(args: string[]) {
  const [command, input, ...rest] = args;
  if (!command || command === '--help' || command === 'help') { console.log(help); return; }
  if (!input || input.startsWith('--')) throw new Error('入力ファイルまたはリポジトリを指定してください。');
  const options: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]; const value = rest[i + 1];
    if (!['--port', '--root', '--json', '--out', '--dsl'].includes(key) || !value || value.startsWith('--')) throw new Error('オプション名と値を確認してください。');
    options[key] = value;
  }
  if (command === 'import') {
    const diagram = await importTerraformRepository({ repository: input, root: options['--root'], json: options['--json'] });
    await writeFile(options['--out'] ?? 'model.json', JSON.stringify(diagram, null, 2) + '\n');
    if (options['--dsl']) await writeFile(options['--dsl'], serializeDSL(diagram));
    const unresolved = diagram.resources.reduce((count, resource) => count + (resource.unresolved?.length ?? 0), 0);
    console.log(`${diagram.resources.length} 要素を取り込みました。未解決項目: ${unresolved} 件、診断: ${diagram.diagnostics.length} 件。`);
    return;
  }
  const diagram = await loadDiagram(input);
  if (command === 'validate') { console.log(`DSL は有効です: ${diagram.resources.length} 要素、${diagram.connections.length} 接続。`); return; }
  if (command === 'dsl') { if (!options['--out']) throw new Error('--out を指定してください。'); await writeFile(options['--out'], serializeDSL(diagram)); return; }
  if (command === 'html') { if (!options['--out']) throw new Error('--out を指定してください。'); await exportHTML(diagram, options['--out']); console.log(`HTML を保存しました: ${options['--out']}`); return; }
  if (command === 'preview') {
    const template = await readFile(fileURLToPath(new URL('../dist/template.html', import.meta.url)), 'utf8');
    const html = embedDiagram(template, diagram);
    const port = Number(options['--port'] ?? 5180);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port は 1024〜65535 の整数を指定してください。');
    const server = createServer((req, res) => {
      if (req.url !== '/') { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
    });
    server.on('error', () => { console.error('プレビューを起動できません。別の port を指定してください。'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/  (終了: Ctrl+C)`));
    return;
  }
  throw new Error(`不明なコマンドです。\n${help}`);
}

main(process.argv.slice(2)).catch(() => { console.error('処理に失敗しました。入力、オプション、出力先を確認してください。'); process.exitCode = 1; });
