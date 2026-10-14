import { it } from 'node:test';
import assert from 'node:assert/strict';
import { inspectSource, parseConfig } from '../src/assistant/source-analysis.js';
import { createModuleResolver } from '../src/assistant/module-resolution.js';
import { traceValueFlow } from '../src/assistant/value-flow.js';
import { analyzeRepository } from '../src/assistant/repository-analysis.js';
import { repositoryScaffold } from '../src/assistant/scaffold.js';
import { validateDraft } from '../src/assistant/contract.js';
it('Wrangler TOMLの環境・配列テーブル・エントリーを解析してDSLへ反映する', () => {
  const files = [
    {
      path: 'wrangler.toml',
      content:
        'name="app"\nmain="src/entry.ts"\n[env.live.vars]\nURL="https://example.turso.io"\n[[env.live.d1_databases]]\nbinding="DB"\ndatabase_name="local"',
    },
    {
      path: 'src/entry.ts',
      content: 'import {createClient as db} from "@libsql/client"; db({url:env.URL});',
    },
  ];
  const info = inspectSource(files[0]);
  assert.equal(info.config?.main, 'src/entry.ts');
  const analysis = analyzeRepository({ files });
  assert.ok(analysis.relations.some((r) => r.kind === 'database'));
  const draft = repositoryScaffold({
    url: 'https://github.com/example/infra',
    name: 'example/infra',
    ref: 'main',
    commit: 'a'.repeat(40),
    files,
    warnings: [],
    analysis,
  })!;
  assert.ok(validateDraft(draft).diagram.resources.some((r) => r.id === 'repo_cf_app'));
  assert.ok(draft.diagram.connections.some((c) => c.target === 'repo_cf_d1'));
  assert.throws(() => parseConfig({ path: 'bad.toml', content: 'a=1\na=2' }));
  assert.throws(() => parseConfig({ path: 'bad.toml', content: '__proto__.evil="x"' }));
});
it('pathsの継承元・baseUrl・長い接頭辞・フォールバックを解決する', () => {
  const files = [
    {
      path: 'config/base.json',
      content: '{"compilerOptions":{"paths":{"@shared/*":["../shared/*"]}}}',
    },
    { path: 'app/tsconfig.json', content: '{"extends":"../config/base.json"}' },
    {
      path: 'other/tsconfig.json',
      content:
        '{"compilerOptions":{"baseUrl":"./src","paths":{"@/*":["missing/*","common/*"],"@/special/*":["specific/*"]}}}',
    },
    { path: 'shared/db.ts', content: '' },
    { path: 'other/src/common/util.ts', content: '' },
    { path: 'other/src/specific/util.ts', content: '' },
  ];
  const resolver = createModuleResolver(files, new Set(files.map((f) => f.path)));
  assert.equal(resolver.resolve('app/main.ts', '@shared/db'), 'shared/db.ts');
  assert.equal(resolver.resolve('other/main.ts', '@/util'), 'other/src/common/util.ts');
  assert.equal(resolver.resolve('other/main.ts', '@/special/util'), 'other/src/specific/util.ts');
  const cyclic = createModuleResolver(
    [
      { path: 'tsconfig.json', content: '{"extends":"./base.json"}' },
      { path: 'base.json', content: '{"extends":"./tsconfig.json"}' },
    ],
    new Set(['tsconfig.json', 'base.json']),
  );
  assert.ok(cyclic.warnings.some((w) => w.includes('循環')));
});
it('定数テンプレートのimport、別名経由の引数・戻り値・bindを追跡する', () => {
  const files = [
    { path: 'tsconfig.json', content: '{"compilerOptions":{"paths":{"@ops/*":["ops/*"]}}}' },
    {
      path: 'entry.mjs',
      content:
        'import {wrap as launch} from "@ops/runner"; const actions={upload:launch.bind(null,"npx")}; const key="upload"; const verb=choose(true); actions[key](["wrangler",verb]); function choose(flag){if(flag)return "deploy";return "help";}',
    },
    {
      path: 'ops/runner.ts',
      content:
        'import {spawnSync as execute} from "node:child_process"; export function wrap(binary,argv){return execute(binary,argv);}',
    },
  ];
  const traced = traceValueFlow(files, 'entry.mjs');
  assert.ok(
    traced.calls.some(
      (item) =>
        item.call.symbol === 'node:child_process.spawnSync' &&
        item.call.literals.join(',') === 'npx,wrangler,deploy',
    ),
  );
  assert.ok(traced.flows.some((flow) => flow.to.file === 'ops/runner.ts' && flow.resolved === 2));
  const dynamic = inspectSource({
    path: 'entry.mjs',
    content: 'const leaf="worker"; import(`./${leaf}.mjs`);',
  });
  assert.ok(dynamic.references.some((ref) => ref.target === './worker.mjs'));
});
it('callback・オブジェクト引数・spread・applyを伝播し、未確定のdispatchと再帰は打ち切る', () => {
  const source =
    'import {spawnSync as run} from "node:child_process"; function forward(callback,options){callback.apply(null,[options.binary,[...options.args]]);} const handler=run;forward(handler,{binary:"npx",args:["wrangler","deploy"]}); const table={known:handler};table[process.env.KEY]("npx",["bad"]); function recur(a){recur(a);}recur("x");';
  const result = traceValueFlow([{ path: 'entry.mjs', content: source }], 'entry.mjs');
  assert.ok(result.calls.some((item) => item.call.literals.join(',') === 'npx,wrangler,deploy'));
  assert.ok(result.warnings.some((w) => w.includes('解決できません')));
  assert.ok(result.warnings.some((w) => w.includes('上限')));
});
it('引数で決まる動的importの参照先を追跡する', () => {
  const files = [
    { path: 'entry.mjs', content: 'import {load} from "./loader.mjs"; load("plugin");' },
    { path: 'loader.mjs', content: 'export function load(name){return import(`./${name}.mjs`);}' },
    { path: 'plugin.mjs', content: 'export function start(){}' },
  ];
  const result = traceValueFlow(files, 'entry.mjs');
  assert.ok(
    result.references.some(
      (item) => item.file === 'loader.mjs' && item.reference.target === './plugin.mjs',
    ),
  );
});
it('複数extendsのオプションを保持し、範囲外のbaseUrlは解決しない', () => {
  const files = [
    { path: 'tsconfig.json', content: '{"extends":["./paths.json","./strict.json"]}' },
    { path: 'paths.json', content: '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}' },
    { path: 'strict.json', content: '{"compilerOptions":{"strict":true}}' },
    { path: 'src/db.ts', content: '' },
  ];
  const resolver = createModuleResolver(files, new Set(files.map((f) => f.path)));
  assert.equal(resolver.resolve('entry.ts', '@/db'), 'src/db.ts');
  const invalid = createModuleResolver(
    [
      {
        path: 'tsconfig.json',
        content: '{"compilerOptions":{"baseUrl":"../outside","paths":{"@/*":["*"]}}}',
      },
      { path: 'db.ts', content: '' },
    ],
    new Set(['tsconfig.json', 'db.ts']),
  );
  assert.equal(invalid.resolve('entry.ts', '@/db'), undefined);
  assert.ok(invalid.warnings.length);
});
it('多段re-exportとCommonJSの関数へ引数を渡せる', () => {
  const files = [
    {
      path: 'entry.mjs',
      content:
        'import {go} from "./barrel.mjs"; const worker=require("./wrapper.cjs"); worker("npx",["wrangler",go()]);',
    },
    { path: 'barrel.mjs', content: 'export {verb as go} from "./values.mjs";' },
    { path: 'values.mjs', content: 'export function verb(){return "deploy";}' },
    {
      path: 'wrapper.cjs',
      content:
        'const child=require("node:child_process");module.exports=function(binary,args){child.spawnSync(binary,args);};',
    },
  ];
  const result = traceValueFlow(files, 'entry.mjs');
  assert.ok(
    result.calls.some(
      (item) =>
        item.call.symbol === 'node:child_process.spawnSync' &&
        item.call.literals.join(',') === 'npx,wrangler,deploy',
    ),
  );
});
it('関数スコープの同名変数を混同せず、evalを実行しない', () => {
  const files = [
    {
      path: 'entry.mjs',
      content:
        'const verb="help"; function run(){const verb="deploy"; execute("npx",["wrangler",verb]);}run();eval("throw new Error(\\"EXECUTED\\")");',
    },
  ];
  const result = traceValueFlow(files, 'entry.mjs');
  assert.ok(result.calls.some((item) => item.call.literals.join(',') === 'npx,wrangler,deploy'));
  assert.ok(result.warnings.some((w) => w.includes('eval')));
});
it('取得時にextends・別名import・引数で決まる動的import先を追加で読む', async () => {
  const { loadRepository } = await import('../src/assistant/repository.js');
  const files = [
    { path: 'tsconfig.json', content: '{"extends":"./config/options.json"}' },
    {
      path: 'config/options.json',
      content: '{"compilerOptions":{"paths":{"@load":["../lib/loader.mjs"]}}}',
    },
    { path: 'wrangler.toml', content: 'name="app"\nmain="entry.mjs"' },
    { path: 'entry.mjs', content: 'import {load} from "@load";load("plugins/worker");' },
    {
      path: 'lib/loader.mjs',
      content: 'export function load(path){return import(`../${path}.mjs`);}',
    },
    { path: 'plugins/worker.mjs', content: 'export function run(){}' },
  ];
  const entries = files.map((file, index) => ({
      ...file,
      sha: String(index + 1).padStart(40, '0'),
    })),
    commit = 'a'.repeat(40);
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.includes('/git/trees/'))
      return new Response(
        JSON.stringify({
          tree: entries.map((file) => ({
            path: file.path,
            sha: file.sha,
            size: file.content.length,
            type: 'blob',
            mode: '100644',
          })),
        }),
      );
    if (path.includes('/git/blobs/')) {
      const file = entries.find((file) => path.endsWith(file.sha))!;
      return new Response(
        JSON.stringify({
          encoding: 'base64',
          content: Buffer.from(file.content).toString('base64'),
        }),
      );
    }
    return new Response(
      JSON.stringify(path.includes('/commits/') ? { sha: commit } : { default_branch: 'main' }),
    );
  };
  const snapshot = await loadRepository(
    'https://github.com/example/infra',
    '',
    '',
    undefined,
    fetcher,
  );
  assert.ok(snapshot.files.some((file) => file.path === 'config/options.json'));
  assert.ok(snapshot.files.some((file) => file.path === 'lib/loader.mjs'));
  assert.ok(snapshot.files.some((file) => file.path === 'plugins/worker.mjs'));
  assert.ok(
    snapshot.analysis?.dependencies.some(
      (edge) => edge.from === 'entry.mjs' && edge.to === 'lib/loader.mjs',
    ),
  );
  assert.ok(
    snapshot.analysis?.dependencies.some(
      (edge) => edge.from === 'lib/loader.mjs' && edge.to === 'plugins/worker.mjs',
    ),
  );
});
it('既知オブジェクトのthisとcall/apply/bindの受け渡しを解決する', () => {
  const result = traceValueFlow(
    [
      {
        path: 'entry.mjs',
        content:
          'import {spawnSync as execute} from "node:child_process"; const runner={binary:"npx",go(args){execute(this.binary,args);}};runner.go(["wrangler","deploy"]);const bound=runner.go.bind(runner);bound(["wrangler","deploy"]);runner.go.call(runner,["wrangler","deploy"]);runner.go.apply(runner,[["wrangler","deploy"]]);',
      },
    ],
    'entry.mjs',
  );
  assert.equal(
    result.calls.filter(
      (item) =>
        item.call.symbol === 'node:child_process.spawnSync' &&
        item.call.literals.join(',') === 'npx,wrangler,deploy',
    ).length,
    4,
  );
});
it('未知値を含むオブジェクトや配列は引数が完全に解決したと表示しない', () => {
  const result = traceValueFlow(
    [
      {
        path: 'entry.mjs',
        content:
          'function accept(options){return options;}accept({token:process.env.TOKEN});accept([process.env.TOKEN]);',
      },
    ],
    'entry.mjs',
  );
  assert.ok(result.flows.length === 2);
  assert.ok(result.flows.every((flow) => flow.resolved === 0));
});
it('emit拡張子からTSソースを選び、型だけのimportを実行関係にしない', () => {
  const paths = new Set(['lib/code.mts', 'lib/legacy.cts', 'lib/common.ts']);
  const resolver = createModuleResolver([], paths);
  assert.equal(resolver.resolve('lib/entry.ts', './code.mjs'), 'lib/code.mts');
  assert.equal(resolver.resolve('lib/entry.ts', './legacy.cjs'), 'lib/legacy.cts');
  assert.equal(resolver.resolve('lib/entry.ts', './common.js'), 'lib/common.ts');
  const info = inspectSource({
    path: 'entry.ts',
    content: 'import type { Client } from "./db"; import {start,type Config} from "./runtime";',
  });
  assert.equal(info.references.find((ref) => ref.symbol === 'Client')?.kind, 'type');
  assert.equal(info.references.find((ref) => ref.symbol === 'Config')?.kind, 'type');
  assert.equal(info.references.find((ref) => ref.symbol === 'start')?.kind, 'import');
});
it('宣言前の変数値を推測して引数へ流さない', () => {
  const result = traceValueFlow(
    [
      {
        path: 'entry.mjs',
        content: 'function accept(value){return value;}accept(later);const later="deploy";',
      },
    ],
    'entry.mjs',
  );
  assert.equal(result.flows[0]?.resolved, 0);
  assert.ok(result.warnings.some((w) => w.includes('初期化前')));
});
