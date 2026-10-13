import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/viewer/main.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  minify: true,
  outfile: 'dist/viewer.js',
  loader: { '.svg': 'dataurl', '.infra': 'text' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'raw',
      setup(builder) {
        builder.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
          contents: await readFile(args.path, 'utf8'),
          loader: 'text',
        }));
      },
    },
  ],
});
const js = await readFile('dist/viewer.js', 'utf8');
const css = await readFile('dist/viewer.css', 'utf8');
const flagManifest = JSON.parse(await readFile('src/assets/flags/manifest.json', 'utf8'));
const flagLicense = await readFile('src/assets/flags/LICENSE.txt', 'utf8');
const template =
  '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Infra Canvas</title><style>' +
  css +
  '</style></head><body><div id="root"></div><script>window.__INFRA_CANVAS__=__INFRA_CANVAS_MODEL__;</script><script>' +
  js.replace(/<\/script/gi, '<\\/script') +
  '</script><!-- flag-icons ' +
  flagManifest.version +
  '\n' +
  flagLicense +
  '--></body></html>';
await writeFile('dist/template.html', template);
await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/cli.js',
  packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
});
await chmod('dist/cli.js', 0o755);
execFileSync('node_modules/.bin/tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit' });
await viteBuild();
