import { it } from 'node:test';
import assert from 'node:assert/strict';
import { inspectSource, resolveLocal } from '../src/assistant/source-analysis.js';
import { analyzeRepository } from '../src/assistant/repository-analysis.js';
import { loadRepository } from '../src/assistant/repository.js';
import { buildMessages } from '../src/assistant/contract.js';
const files = [
  {
    path: '.github/workflows/ship.yaml',
    content: 'jobs: {ship: {steps: [{run: "npm run upload"}]}}',
  },
  { path: 'package.json', content: '{"scripts":{"upload":"node tools/start.mjs"}}' },
  {
    path: 'tools/start.mjs',
    content: 'import { publish as send } from "../ops/cloud.js"; send();',
  },
  {
    path: 'ops/cloud.ts',
    content:
      'import { spawnSync as execute } from "node:child_process"; const binary="wrangler"; const operation="deploy"; export function publish(){ execute("npx",[binary,operation]); }',
  },
  {
    path: 'wrangler.jsonc',
    content:
      '{"name":"app","main":"src/edge/entry.ts","env":{"live":{"vars":{"CUSTOM_DATABASE":"https://private-name.turso.io"}}}}',
  },
  {
    path: 'src/edge/entry.ts',
    content:
      'import { connection as client } from "../../adapters/store.js"; export default { fetch(){ return client(); } };',
  },
  {
    path: 'adapters/store.ts',
    content:
      'import { createClient as connect } from "@libsql/client"; export const connection = () => connect({url:process.env.CUSTOM_DATABASE});',
  },
];
it('改名・import別名・多段の呼び出しとnpm scriptをAST/設定から追跡する', () => {
  const analysis = analyzeRepository({ files });
  assert.ok(
    analysis.relations.some(
      (r) =>
        r.kind === 'deployment' && r.evidence.some((e) => e.file === 'ops/cloud.ts' && e.line > 0),
    ),
  );
  assert.ok(
    analysis.relations.some(
      (r) => r.kind === 'database' && r.evidence.some((e) => e.file === 'adapters/store.ts'),
    ),
  );
  assert.ok(
    analysis.calls.some((call) => call.callee === 'send' && call.target === 'ops/cloud.ts#publish'),
  );
  assert.ok(
    analysis.calls.some((call) => call.callee === 'connect' && call.caller === 'connection'),
  );
  const input = buildMessages('diagram "App" {}', '概要を補足', [], {
    url: 'https://github.com/example/infra',
    name: 'example/infra',
    ref: 'main',
    commit: 'a'.repeat(40),
    files,
    warnings: [],
    analysis,
  });
  const evidence =
    input.messages.find((message) => message.content.includes('STRUCTURED STATIC EVIDENCE'))
      ?.content ?? '';
  assert.match(evidence, /"kind":"deployment"/);
  assert.match(evidence, /"reason"/);
  assert.match(evidence, /ops\/cloud.ts/);
});
it('コメントや文字列内の偽コマンドを呼び出しにせず、YAMLの構文エラーと別名循環を診断する', () => {
  const inspected = inspectSource({
    path: 'foo.ts',
    content: '// send("wrangler", "deploy");\nconst text="send(\\"wrangler\\",\\"deploy\\")";',
  });
  assert.equal(inspected.calls.length, 0);
  assert.ok(inspectSource({ path: 'bad.yaml', content: 'jobs: [broken' }).warnings.length);
  const cycle = inspectSource({ path: 'cycle.yaml', content: 'root: &root {child: *root}' });
  assert.ok(cycle.config || cycle.warnings.length);
  assert.equal(
    resolveLocal('src/index.ts', '../../outside.ts', new Set(['outside.ts'])),
    undefined,
  );
});
it('workflowのworking-directoryとローカルActionの入口を解決する', () => {
  const inspected = inspectSource({
    path: '.github/workflows/app.yml',
    content:
      'jobs:\n  upload:\n    defaults: {run: {working-directory: services/app}}\n    steps:\n      - run: |\n          node entry.mjs\n      - uses: ./.github/actions/upload',
  });
  assert.ok(inspected.references.some((ref) => ref.target === 'services/app/entry.mjs'));
  assert.equal(
    resolveLocal(
      'package.json',
      '.github/actions/upload',
      new Set(['.github/actions/upload/action.yml']),
    ),
    '.github/actions/upload/action.yml',
  );
});
it('取得は入口から未命名のスクリプト・import先をたどり、秘密ファイルを読まない', async () => {
  const treeFiles = [...files, { path: 'ops/.env.json', content: '{"password":"hidden"}' }];
  const indexed = treeFiles.map((file, index) => ({
    ...file,
    sha: (index + 1).toString(16).padStart(40, '0'),
  }));
  const commit = 'a'.repeat(40),
    reads: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    reads.push(url.pathname);
    if (url.pathname.endsWith('/git/trees/' + commit))
      return new Response(
        JSON.stringify({
          tree: indexed.map((file) => ({
            path: file.path,
            sha: file.sha,
            size: file.content.length,
            type: 'blob',
            mode: '100644',
          })),
        }),
      );
    if (url.pathname.includes('/git/blobs/')) {
      const file = indexed.find((file) => url.pathname.endsWith(file.sha))!;
      return new Response(
        JSON.stringify({
          encoding: 'base64',
          content: Buffer.from(file.content).toString('base64'),
        }),
      );
    }
    return new Response(
      JSON.stringify(
        url.pathname.includes('/commits/') ? { sha: commit } : { default_branch: 'main' },
      ),
    );
  };
  const snapshot = await loadRepository(
    'https://github.com/example/infra',
    '',
    '',
    undefined,
    fetcher,
  );
  assert.ok(snapshot.files.some((file) => file.path === 'ops/cloud.ts'));
  assert.ok(snapshot.files.some((file) => file.path === 'adapters/store.ts'));
  assert.ok(!snapshot.files.some((file) => file.path.includes('.env')));
  assert.ok(snapshot.analysis?.relations.some((relation) => relation.kind === 'database'));
  assert.ok(reads.every((path) => !path.includes(indexed.at(-1)!.sha)));
});
it('呼び出し結果を定数の引数と誤認せず、export-env=falseの取得も記録する', () => {
  const info = inspectSource({
    path: 'send.mjs',
    content: 'const response=fetch(url,{method:"POST"}); consume(response);',
  });
  assert.deepEqual(info.calls.find((call) => call.symbol === 'consume')?.literals, []);
  const analysis = analyzeRepository({
    files: [
      {
        path: '.github/workflows/secret.yml',
        content:
          'jobs: {read: {steps: [{uses: "1password/load-secrets-action@v5", with: {export-env: false}, env: {KEY: "op://private/item/key"}}]}}',
      },
    ],
  });
  assert.ok(analysis.relations.some((relation) => relation.kind === 'secrets'));
  assert.ok(!analysis.relations.some((relation) => relation.kind === 'secretSync'));
});
