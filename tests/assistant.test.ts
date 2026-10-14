import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMessages, validateDraft, parseDraftResponse } from '../src/assistant/contract.js';
import {
  loadRepository,
  parseRepositoryURL,
  repositoryFilePriority,
  redactSource,
} from '../src/assistant/repository.js';
import {
  parseDSL,
  validateDiagram,
  serializeDSL,
  buildDisplayGraph,
  resourceContent,
  layoutGraph,
} from '../src/core/index.js';
const sample = readFileSync('examples/subnet-security.infra', 'utf8');
it('未対応DSLバージョンは対応値を示して拒否し、生成指示にもversion=1を明示する', () => {
  for (const version of ['2', '0', '"1"']) {
    assert.throws(
      () =>
        validateDraft({ message: 'x', dsl: `diagram "x" version=${version} {\n}`, warnings: [] }),
      /version=1 のみ/,
    );
  }
  for (const header of ['diagram "x" {', 'diagram "x" version=1 {']) {
    assert.equal(
      validateDraft({ message: 'x', dsl: header + '\n}', warnings: [] }).diagram.version,
      1,
    );
  }
  assert.match(
    buildMessages(sample, '構成図を作成', []).messages[0].content,
    /supports only version=1/,
  );
});
it('モデルのJSON文字列内の改行・タブを内容を保持して回復し、DSLを検証する', () => {
  const raw = { message: '概要\t作成\r\n完了', dsl: sample, warnings: [] };
  const valid = JSON.stringify(raw);
  const malformed = valid.replaceAll('\\n', '\n').replaceAll('\\r', '\r').replaceAll('\\t', '\t');
  const result = parseDraftResponse(malformed);
  assert.equal(result.message, raw.message);
  assert.equal(result.dsl, validateDraft(raw).dsl);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(parseDraftResponse(valid), validateDraft(raw));
});
it('JSONの引用符・不正エスケープ・切断・DSL参照不正は推測で修復しない', () => {
  for (const text of [
    '{"message":"x","dsl":"diagram "broken" {\n}","warnings":[]}',
    '{"message":"\\q","dsl":"diagram \\"x\\" {\n}","warnings":[]}',
    '{"message":"x","dsl":"diagram',
    JSON.stringify({
      message: 'x',
      dsl: 'diagram "x" {\n a -> missing\n}',
      warnings: [],
    }).replaceAll('\\n', '\n'),
  ])
    assert.throws(() => parseDraftResponse(text));
});
it('単一の明示的JSONコードブロックを検証し、複数の応答候補は拒否する', () => {
  const json = JSON.stringify({ message: '生成しました。', dsl: sample, warnings: [] });
  const block = '```json\n' + json + '\n```';
  assert.equal(parseDraftResponse('生成結果：\n' + block).dsl, validateDraft(JSON.parse(json)).dsl);
  assert.throws(() => parseDraftResponse(block + '\n' + block));
  assert.throws(() => parseDraftResponse('```json\n{}\n```'));
});
it('Subnet内の実体と複数SG所属はサービス表示・JSON/DSL往復でも保持する', async () => {
  const parsed = parseDSL(sample);
  assert.deepEqual(parsed.diagnostics, []);
  const diagram = validateDiagram(parsed.diagram);
  const restored = validateDiagram(parseDSL(serializeDSL(diagram)).diagram);
  assert.equal(restored.resources.find((r) => r.id === 'api')?.parentId, 'private_a');
  const graph = buildDisplayGraph(restored, { view: 'service' });
  assert.deepEqual(graph.resources.find((r) => r.id === 'api')?.attributes.securityGroups, [
    'app_sg',
    'monitoring_sg',
  ]);
  assert.equal(
    graph.resources.some((r) => r.id === 'web'),
    true,
  );
  assert.deepEqual(resourceContent(restored.resources.find((r) => r.id === 'app_sg')!), {
    kind: 'table',
    columns: ['方向', 'プロトコル', 'ポート', '通信相手'],
    rows: [
      ['受信', 'tcp', '8080', 'sg:web_sg'],
      ['送信', 'tcp', '5432', 'sg:db_sg'],
    ],
  });
  assert.equal(
    (await layoutGraph(graph)).nodes.some((r) => r.id === 'api'),
    true,
  );
});
for (const rule of [
  'tcp 70000 0.0.0.0/0',
  'tcp 90-80 ::/0',
  'tcp 443 300.0.0.0/0',
  'tcp 443 sg:missing',
  'icmp 80 ::/0',
  'tcp 443 ::::',
])
  it(`DSL/JSONで不正なSGルールを拒否: ${rule}`, () => {
    const text = `diagram "Bad" {\n sg s "SG" ingress=["${rule}"]\n}`;
    assert.equal(parseDSL(text).diagram, undefined);
    assert.throws(() =>
      validateDiagram({
        version: 1,
        title: 'Bad',
        resources: [{ id: 's', type: 'sg', label: 'SG', attributes: { ingress: [rule] } }],
        connections: [],
        views: [],
        diagnostics: [],
      }),
    );
  });
it('モデル応答の参照・構文を検証し、実行コードや不完全なDSLを候補にしない', () => {
  assert.equal(
    validateDraft({ message: '生成', dsl: sample, warnings: [] }).diagram.resources.length > 5,
    true,
  );
  assert.throws(() =>
    validateDraft({ message: '', dsl: 'diagram "Bad" {\n a -> missing\n}', warnings: [] }),
  );
  assert.throws(() => validateDraft({ dsl: '<script>alert(1)</script>' }));
  assert.throws(() => buildMessages('x'.repeat(30000), '作成', []));
});
it('URLはGitHubのルートだけに限定し、認証情報・経路のすり替えを拒否する', () => {
  assert.equal(parseRepositoryURL('https://github.com/example/infra.git').repo, 'infra');
  for (const url of [
    'http://github.com/a/b',
    'https://evil.test/a/b',
    'https://token@github.com/a/b',
    'https://github.com/a/b/tree/main',
    'https://github.com/a/b?token=secret',
  ])
    assert.throws(() => parseRepositoryURL(url));
  assert.equal(repositoryFilePriority('infra/secrets.tfvars'), 99);
  assert.equal(repositoryFilePriority('.env'), 99);
  assert.equal(repositoryFilePriority('wrangler.jsonc'), 1);
  assert.equal(redactSource('password = "hidden"').includes('hidden'), false);
});
it('リポジトリはcommitで固定し、関連ファイルだけを読み取りトークンをモデル入力に含めない', async () => {
  const commit = 'a'.repeat(40),
    blob = 'b'.repeat(40);
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
    const value = path.endsWith('/commits/main')
      ? { sha: commit }
      : path.includes('/git/trees/')
        ? {
            tree: [
              { path: 'infra/main.tf', type: 'blob', mode: '100644', sha: blob, size: 100 },
              { path: '.env', type: 'blob', mode: '100644', sha: blob, size: 100 },
              { path: 'infra/link.tf', type: 'blob', mode: '120000', sha: blob, size: 100 },
            ],
          }
        : path.includes('/git/blobs/')
          ? { encoding: 'base64', content: btoa('resource "cloudflare_worker" "app" {}') }
          : { default_branch: 'main' };
    return Response.json(value);
  };
  const snapshot = await loadRepository(
    'https://github.com/example/infra',
    '',
    '',
    undefined,
    fetcher,
    'test-secret',
  );
  assert.equal(snapshot.commit, commit);
  assert.deepEqual(
    snapshot.files.map((f) => f.path),
    ['infra/main.tf'],
  );
  assert.equal(
    paths.some((p) => p.includes('/git/trees/' + commit)),
    true,
  );
  const input = buildMessages('diagram "New" {\n}', '図を生成', [], snapshot);
  assert.equal(JSON.stringify(input).includes('test-secret'), false);
  assert.match(input.messages[0].content, /untrusted evidence/);
  await assert.rejects(() => loadRepository(snapshot.url, '', '../secret', undefined, fetcher));
});

it('認証付きローカルAPIは外部Origin・GET・過大入力・別ホストを拒否する', async () => {
  const { Readable } = await import('node:stream');
  const { handleRepositoryRequest } = await import('../src/assistant/server.js');
  async function request(
    method: string,
    origin: string | undefined,
    body = '{}',
    host = '127.0.0.1:5194',
  ) {
    const req = Object.assign(Readable.from([body]), {
      url: '/api/repository',
      method,
      headers: { origin, host },
    });
    let status = 0,
      result = '';
    const res = {
      writableEnded: false,
      on() {
        return this;
      },
      writeHead(code: number) {
        status = code;
        return this;
      },
      end(value: string) {
        result = value;
        this.writableEnded = true;
      },
    };
    await handleRepositoryRequest(
      req as unknown as import('node:http').IncomingMessage,
      res as unknown as import('node:http').ServerResponse,
    );
    return { status, result };
  }
  assert.equal((await request('POST', undefined)).status, 403);
  assert.equal((await request('GET', 'http://127.0.0.1:5194')).status, 403);
  assert.equal((await request('POST', 'https://evil.test')).status, 403);
  assert.equal(
    (await request('POST', 'http://evil.test:5194', '{}', 'evil.test:5194')).status,
    403,
  );
  assert.equal((await request('POST', 'http://127.0.0.1:5194', 'x'.repeat(4001))).status, 400);
  assert.equal(
    (await request('POST', 'http://127.0.0.1:5194', '{"url":"https://evil.test/a/b"}')).status,
    400,
  );
});

it('Markdownで囲まれた完全なDSLは外枠だけ除去し、内部の不正な参照は拒否する', () => {
  const wrapped = '```infra\n' + sample + '\n```';
  assert.equal(
    validateDraft({ message: '生成', dsl: wrapped, warnings: [] }).diagram.title,
    'AWS Subnetとセキュリティグループ',
  );
  assert.throws(() =>
    validateDraft({
      message: '生成',
      dsl: '```infra\ndiagram "Bad" {\n a -> missing\n}\n```',
      warnings: [],
    }),
  );
});

it('ストリーミング応答を組み立て、出力上限・中止を候補にしない', async () => {
  const { LocalModel } = await import('../src/assistant/local-model.js');
  const model = new LocalModel();
  let finish = 'stop';
  Object.assign(model, {
    engine: {
      chat: {
        completions: {
          async *create(request: { stream: boolean; messages: { role: string }[] }) {
            assert.equal(request.stream, true);
            assert.equal(request.messages[0].role, 'system');
            yield { choices: [{ delta: { content: 'x'.repeat(90) } }] };
            yield { choices: [{ delta: { content: 'tail' }, finish_reason: finish }] };
          },
        },
      },
    },
  });
  const progress: number[] = [];
  assert.equal(
    (
      await model.complete([{ role: 'user', content: 'instructions' }], (count) =>
        progress.push(count),
      )
    ).length,
    94,
  );
  assert.deepEqual(progress, [90]);
  finish = 'length';
  await assert.rejects(
    () => model.complete([{ role: 'user', content: 'instructions' }]),
    /出力上限/,
  );
  finish = 'abort';
  await assert.rejects(() => model.complete([{ role: 'user', content: 'instructions' }]), /中止/);
});

it('Terraformのコメント・文字列・heredoc内の偽宣言を無視する', async () => {
  const { terraformDeclarations } = await import('../src/assistant/scaffold.js');
  const source = `# resource "aws_instance" "fake" {}
/* resource "aws_instance" "fake2" {} */
locals { text = <<EOF
resource "aws_instance" "fake3" {}
EOF
}
resource "cloudflare_queue" "real" { name = "queue" }
`;
  assert.deepEqual(terraformDeclarations(source), ['cloudflare_queue']);
});

it('JSONCはコメント後の末尾カンマを許容し文字列内のURLを保持する', async () => {
  const { parseJSONC } = await import('../src/assistant/scaffold.js');
  assert.deepEqual(parseJSONC('{"url":"https://example.com/a,b", "a":[1, // comment\n],}'), {
    url: 'https://example.com/a,b',
    a: [1],
  });
});

it('宣言からの概要はプロバイダーを保持し、設定以外の通信を捏造しない', async () => {
  const { repositoryScaffold } = await import('../src/assistant/scaffold.js');
  const draft = repositoryScaffold({
    url: 'https://github.com/example/infra',
    name: 'example/infra',
    ref: 'main',
    commit: 'a'.repeat(40),
    warnings: [],
    files: [
      {
        path: 'wrangler.jsonc',
        content:
          '{"name":"app","main":"src/index.ts","queues":{"producers":[{"binding":"Q","queue":"jobs"}]},"env":{"dev":{"d1_databases":[{"binding":"DB"}]}}}',
      },
      {
        path: 'infra/main.tf',
        content: 'resource "google_project" "p" {}\nresource "turso_database" "db" {}',
      },
      { path: 'README.md', content: 'resource "aws_instance" "fake" {}' },
    ],
  })!;
  assert.ok(draft);
  assert.ok(draft.diagram.resources.length <= 15);
  assert.equal(draft.diagram.connections.length, 2);
  assert.ok(draft.diagram.resources.some((r) => r.label.includes('Google Cloud')));
  assert.ok(draft.diagram.resources.some((r) => r.label.includes('Turso')));
  assert.ok(!draft.dsl.includes('aws.'));
  assert.ok(draft.diagram.resources.every((r) => r.attributes.evidence === 'inferred'));
  assert.equal(validateDraft(draft).diagram.resources.length, draft.diagram.resources.length);
});

it('ワークフローと実スクリプトの根拠が揃う時だけDiscord通知を概要へ追加する', async () => {
  const { repositoryScaffold, discordNotificationSources } =
    await import('../src/assistant/scaffold.js');
  const { repositoryFilePriority } = await import('../src/assistant/repository.js');
  const snapshot = {
    url: 'https://github.com/example/infra',
    name: 'example/infra',
    ref: 'main',
    commit: 'a'.repeat(40),
    warnings: [],
    files: [
      {
        path: '.github/workflows/release.yml',
        content:
          'jobs:\n  release:\n    steps:\n      - run: node scripts/notify-discord.mjs success\n',
      },
      {
        path: 'scripts/notify-discord.mjs',
        content:
          'const url = new URL(env.DISCORD_WEBHOOK_URL); if (url.hostname !== "discord.com") throw Error(); await transport(url, {method:"POST"});',
      },
      { path: 'infra/main.tf', content: 'resource "turso_database" "db" {}' },
    ],
  };
  assert.ok(repositoryFilePriority(snapshot.files[0].path) < 99);

  assert.equal(discordNotificationSources(snapshot).length, 2);
  const draft = repositoryScaffold(snapshot)!;
  assert.equal(validateDraft(draft).diagram.connections.length, draft.diagram.connections.length);
  assert.ok(
    draft.diagram.connections.some(
      (c) => c.source === 'repo_github_actions' && c.target === 'repo_discord_notifications',
    ),
  );
  assert.equal(
    draft.diagram.resources.find((r) => r.id === 'repo_provider_turso')?.attributes.icon,
    'saas.turso',
  );
  assert.equal(
    draft.diagram.resources.find((r) => r.id === 'repo_turso_settings')?.attributes.icon,
    'saas.turso',
  );
  snapshot.files[0].content = '# - run: node scripts/notify-discord.mjs success\njobs: {}';
  assert.deepEqual(discordNotificationSources(snapshot), []);
  snapshot.files[0].content =
    'jobs:\n  notify:\n    env:\n      DISCORD_WEBHOOK_URL: secret\n    steps:\n      - run: echo notification';
  assert.deepEqual(discordNotificationSources(snapshot), []);
});

it('デプロイ・Turso接続・1Password取得は対応するコードの根拠を必要とする', async () => {
  const { repositoryScaffold } = await import('../src/assistant/scaffold.js');
  const { repositoryRelationships } = await import('../src/assistant/relationships.js');
  const snapshot = {
    url: 'https://github.com/example/infra',
    name: 'example/infra',
    ref: 'main',
    commit: 'a'.repeat(40),
    warnings: [],
    files: [
      {
        path: '.github/workflows/release.yml',
        content:
          'jobs:\n  release:\n    steps:\n      - run: node scripts/release.mjs\n      - uses: 1password/load-secrets-action@v5\n        env:\n          KEY: op://PRIVATE_VAULT/PRIVATE_ITEM/PRIVATE_FIELD',
      },
      {
        path: 'scripts/release.mjs',
        content: 'command("npx", ["wrangler", "deploy", "--env", "production"]);',
      },
      {
        path: 'wrangler.jsonc',
        content:
          '{"name":"app","main":"src/worker/index.ts","env":{"dev":{"vars":{"DATABASE_BACKEND":"turso","TURSO_DATABASE_URL":"https://private-name.turso.io"}}}}',
      },
      {
        path: 'src/worker/index.ts',
        content:
          'import { TursoDatabase } from "./database"; const db = new TursoDatabase(env.TURSO_DATABASE_URL!, env.TURSO_AUTH_TOKEN);',
      },
      {
        path: 'src/worker/database.ts',
        content:
          'import {openHttp} from "@libsql/hrana-client"; class TursoDatabase { constructor(url,token) {this.client=openHttp(url,token);} }',
      },
    ],
  };
  const relations = repositoryRelationships(snapshot);
  assert.equal(relations.deployment.length, 2);
  assert.equal(relations.turso.length, 3);
  assert.equal(relations.secrets.length, 1);
  const draft = repositoryScaffold(snapshot)!;
  assert.equal(validateDraft(draft).diagram.connections.length, 3);
  assert.ok(!draft.dsl.includes('PRIVATE_'));
  assert.ok(!draft.dsl.includes('private-name'));
  assert.equal(
    draft.diagram.connections.find((c) => c.id === 'repo_cloudflare_deployment')?.kind,
    'deploy',
  );
  snapshot.files[1].content = '// command("npx", ["wrangler", "deploy"]);';
  snapshot.files[4].content =
    '// import {openHttp} from "@libsql/hrana-client"; openHttp(url,token);';
  snapshot.files[0].content =
    'jobs:\n  release:\n    steps:\n      - run: node scripts/release.mjs\n      # - uses: 1password/load-secrets-action@v5\n      # KEY: op://secret';
  assert.deepEqual(repositoryRelationships(snapshot), {
    deployment: [],
    turso: [],
    secrets: [],
    workerSecrets: [],
  });
});

it('同一jobの1Password取得とWrangler secret bulkの入力を照合してWorkers同期を表示する', async () => {
  const { repositoryRelationships } = await import('../src/assistant/relationships.js');
  const { repositoryScaffold } = await import('../src/assistant/scaffold.js');
  const step =
    '      - uses: 1password/load-secrets-action@v5\n        with:\n          export-env: true\n        env:\n          TURSO_AUTH_TOKEN: op://PRIVATE/item/token\n';
  const run = '      - run: node scripts/sync-worker-secrets.mjs\n';
  const snapshot = {
    url: 'https://github.com/example/infra',
    name: 'example/infra',
    ref: 'main',
    commit: 'a'.repeat(40),
    warnings: [],
    files: [
      {
        path: '.github/workflows/sync.yml',
        content: 'jobs:\n  worker:\n    steps:\n' + step + run,
      },
      {
        path: 'scripts/sync-worker-secrets.mjs',
        content:
          'const names=["TURSO_AUTH_TOKEN"]; const secrets=Object.fromEntries(names.map(name=>[name,env[name]])); const wrangler=fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js",import.meta.url)); run(process.execPath,[wrangler,"secret","bulk"],{input:JSON.stringify(secrets)});',
      },
      { path: 'wrangler.jsonc', content: '{"name":"app","main":"src/index.ts"}' },
    ],
  };

  assert.equal(repositoryRelationships(snapshot).workerSecrets.length, 2);
  const draft = repositoryScaffold(snapshot)!;
  assert.ok(
    validateDraft(draft).diagram.connections.some(
      (c) =>
        c.id === 'repo_worker_secret_sync' &&
        c.source === 'repo_onepassword' &&
        c.target === 'repo_cf_app',
    ),
  );
  assert.ok(!draft.dsl.includes('op://') && !draft.dsl.includes('PRIVATE'));
  snapshot.files[0].content = 'jobs:\n  load:\n    steps:\n' + step + '  sync:\n    steps:\n' + run;
  assert.deepEqual(repositoryRelationships(snapshot).workerSecrets, []);
  snapshot.files[0].content =
    'jobs:\n  worker:\n    steps:\n' + step.replace('export-env: true', 'export-env: false') + run;
  assert.deepEqual(repositoryRelationships(snapshot).workerSecrets, []);
  snapshot.files[0].content = 'jobs:\n  worker:\n    steps:\n' + step + run;
  snapshot.files[1].content = snapshot.files[1].content.replace('"bulk"', '"list"');
  assert.deepEqual(repositoryRelationships(snapshot).workerSecrets, []);
});
