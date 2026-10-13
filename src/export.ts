import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Diagram } from './core/model.js';

export function embedDiagram(template: string, diagram: Diagram): string {
  const encoded = JSON.stringify(diagram)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  if (!template.includes('__INFRA_CANVAS_MODEL__'))
    throw new Error('HTML テンプレートをビルドしてください。');
  return template.replace('__INFRA_CANVAS_MODEL__', () => encoded);
}

export async function exportHTML(diagram: Diagram, output: string): Promise<void> {
  const template = await readFile(
    fileURLToPath(new URL('../dist/template.html', import.meta.url)),
    'utf8',
  );
  await writeFile(output, embedDiagram(template, diagram));
}
