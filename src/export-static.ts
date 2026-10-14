import { writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { getResourceIconType } from './assets/resource-icons.js';
import {
  exportSVG,
  printDocument,
  type PrintOptions,
  type StaticOptions,
} from './core/static-svg.js';
import type { Diagram } from './core/model.js';

export async function exportStaticFile(
  diagram: Diagram,
  format: 'svg' | 'png' | 'pdf',
  output: string,
  options: StaticOptions & PrintOptions = {},
): Promise<void> {
  const moduleURL = pathToFileURL(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/icon-assets.mjs'),
  );
  const { getIcon } = (await import(moduleURL.href)) as {
    getIcon: (type: string) => string | undefined;
  };
  const byId = new Map(diagram.resources.map((resource) => [resource.id, resource]));
  const icons: Record<string, string> = {};
  for (const resource of diagram.resources) {
    const icon = getIcon(getResourceIconType(resource, byId));
    if (icon) icons[resource.id] = icon;
  }
  const svg = await exportSVG(diagram, { ...options, icons });
  if (format === 'svg') {
    await writeFile(output, svg);
    return;
  }
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale < 0.1 || scale > 2)
    throw new Error('縮尺は0.1〜2を指定してください。');
  const dimensions = /width="([\d.]+)" height="([\d.]+)"/.exec(svg)!;
  const width = Math.ceil(Number(dimensions[1])),
    height = Math.ceil(Number(dimensions[2]));
  if (
    format === 'png' &&
    (width * scale > 32767 ||
      height * scale > 32767 ||
      width * height * scale * scale > 100_000_000)
  )
    throw new Error('PNGの寸法が大きすぎます。--scale を下げてください。');
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: Math.min(width, 16000), height: Math.min(height, 16000) },
      deviceScaleFactor: format === 'png' ? scale : 1,
    });
    await page.route('**/*', (route) => route.abort());
    if (format === 'pdf') {
      await page.setContent(printDocument(svg, options));
      await page.pdf({ path: output, printBackground: true, preferCSSPageSize: true });
    } else {
      await page.setContent(
        `<!doctype html><meta charset="utf-8"><style>body{margin:0}svg{display:block}</style>${svg}`,
      );
      await page.locator('svg').screenshot({ path: output, type: 'png' });
    }
  } finally {
    await browser.close();
  }
}
