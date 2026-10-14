import { it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createLLMHandler as createHandler,
  remoteConfigurations,
} from '../src/assistant/llm-server.js';
import type { Settings, SettingsStore } from '../src/assistant/settings-store.js';
import { validateDraft } from '../src/assistant/contract.js';

function memorySettings(): SettingsStore {
  const saved: Settings = {};
  return {
    load: async () => ({ ...saved }),
    save: async (provider, config) => {
      saved[provider] = config;
      return undefined;
    },
    reset: async (provider) => {
      delete saved[provider];
      return undefined;
    },
  };
}
const createLLMHandler = (options: Parameters<typeof createHandler>[0] = {}) =>
  createHandler({ ...options, settings: options.settings ?? memorySettings() });

it('接続テストは保存済み認証と最小プロンプトだけを使い、応答本文やキーを返さない', async () => {
  const handler = createLLMHandler({
    env,
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 64);
      assert.equal(body.messages.length, 2);
      assert.doesNotMatch(String(init?.body), /Current DSL|diagram|test-secret/);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
      return Response.json({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    },
  });
  const request = exchange({ provider: 'api' }, { path: '/api/llm/test' });
  await handler(request.req, request.res);
  assert.equal(request.result().status, 200);
  assert.equal(request.result().value.model, env.INFRA_LLM_API_MODEL);
  assert.equal(request.result().value.outputTokens, 5);
  assert.doesNotMatch(request.result().body, /test-secret|"ok"|"text"/);
});

it('Bedrock接続テストでプロファイル・リージョンと認証エラーを確認できる', async () => {
  const handler = createLLMHandler({
    env: { ...env, AWS_PROFILE: 'check', AWS_REGION: 'ap-northeast-1' },
    converse: async (input, _signal, options) => {
      assert.equal(input.inferenceConfig?.maxTokens, 64);
      assert.deepEqual(options, { profile: 'check', region: 'ap-northeast-1' });
      assert.doesNotMatch(JSON.stringify(input), /diagram|Current DSL/);
      return {
        $metadata: {},
        stopReason: 'end_turn',
        metrics: { latencyMs: 1 },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        output: { message: { role: 'assistant', content: [{ text: '{"ok":true}' }] } },
      };
    },
  });
  const success = exchange({ provider: 'bedrock' }, { path: '/api/llm/test' });
  await handler(success.req, success.res);
  assert.equal(success.result().status, 200);
  const failed = exchange({ provider: 'bedrock' }, { path: '/api/llm/test' });
  await createLLMHandler({
    env,
    converse: async () => {
      throw Object.assign(new Error('RAW test-secret'), { name: 'CredentialsProviderError' });
    },
  })(failed.req, failed.res);
  assert.equal(failed.result().status, 401);
  assert.match(failed.result().body, /SSO/);
  assert.doesNotMatch(failed.result().body, /test-secret/);
});

it('接続テストは未設定・入力の上書き・外部Originを拒否し、不完全な応答を成功にしない', async () => {
  let calls = 0;
  const handler = createLLMHandler({
    env,
    fetcher: async () => {
      calls++;
      return Response.json({
        choices: [{ finish_reason: 'length', message: { content: 'truncated' } }],
      });
    },
  });
  for (const request of [
    exchange({ provider: 'api', apiKey: 'other' }, { path: '/api/llm/test' }),
    exchange({ provider: 'api', messages }, { path: '/api/llm/test' }),
    exchange({ provider: 'api' }, { path: '/api/llm/test', origin: 'https://evil.test' }),
  ]) {
    await handler(request.req, request.res);
    assert.ok(request.result().status >= 400);
  }
  assert.equal(calls, 0);
  const length = exchange({ provider: 'api' }, { path: '/api/llm/test' });
  await handler(length.req, length.res);
  assert.equal(length.result().status, 502);
  const absent = exchange({ provider: 'api' }, { path: '/api/llm/test' });
  await createLLMHandler({ env: {} })(absent.req, absent.res);
  assert.equal(absent.result().status, 400);
});
const env = {
  INFRA_LLM_API_BASE_URL: 'https://api.example.test/v1',
  INFRA_LLM_API_MODEL: 'example-model',
  INFRA_LLM_API_KEY: 'test-secret',
  INFRA_LLM_BEDROCK_MODEL: 'example-bedrock',
};
const messages = [
  { role: 'user', content: 'Instructions' },
  { role: 'assistant', content: 'Current DSL' },
  { role: 'user', content: 'Create diagram' },
];
const draft = JSON.stringify({
  message: '生成',
  dsl: 'diagram "Test" {\n external.service a "A"\n}',
  warnings: [],
});

it('画面設定は原子的に保存し、URL変更時にキーを持ち越さず、リセット・再起動で環境設定へ戻す', async () => {
  let authorization = '';
  const handler = createLLMHandler({
    env,
    fetcher: async (_url, init) => {
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
      return Response.json({ choices: [{ message: { content: draft }, finish_reason: 'stop' }] });
    },
  });
  const save = async (value: unknown, origin?: string) => {
    const request = exchange(value, { path: '/api/llm/config', ...(origin ? { origin } : {}) });
    await handler(request.req, request.res);
    return request.result();
  };
  const first = await save({
    provider: 'api',
    model: 'changed',
    baseURL: env.INFRA_LLM_API_BASE_URL,
    apiKey: 'new-secret',
  });
  assert.equal(first.status, 200);
  assert.doesNotMatch(first.body, /new-secret|test-secret/);
  assert.equal(first.value.providers[0].hasKey, true);
  assert.equal(
    (
      await save({
        provider: 'api',
        model: 'changed-again',
        baseURL: env.INFRA_LLM_API_BASE_URL,
        apiKey: '',
      })
    ).status,
    200,
  );
  assert.equal(
    (await save({ provider: 'api', model: 'bad', baseURL: 'https://other.test/v1', apiKey: '' }))
      .status,
    400,
  );
  assert.equal(
    (
      await save(
        { provider: 'api', model: 'bad', baseURL: env.INFRA_LLM_API_BASE_URL, apiKey: 'secret' },
        'https://evil.test',
      )
    ).status,
    403,
  );
  const generation = exchange({ provider: 'api', messages });
  await handler(generation.req, generation.res);
  assert.equal(authorization, 'Bearer new-secret');
  const reset = await save({ provider: 'api', reset: true });
  assert.equal(reset.value.providers[0].model, env.INFRA_LLM_API_MODEL);
  assert.equal(reset.value.providers[0].settingsSource, 'environment');
  const fresh = exchange({}, { path: '/api/llm/status', method: 'GET' });
  await createLLMHandler({ env })(fresh.req, fresh.res);
  assert.equal(fresh.result().value.providers[0].model, env.INFRA_LLM_API_MODEL);
});

it('Bedrockの画面設定はクライアントごとのプロファイル・リージョンへ渡し、環境変数を書き換えない', async () => {
  const settings = {
    provider: 'bedrock',
    model: 'new-model',
    profile: 'diagram-user',
    region: 'ap-northeast-1',
  };
  const testEnv = { ...env, AWS_PROFILE: 'original', AWS_REGION: 'us-east-1' };
  const handler = createLLMHandler({
    env: testEnv,
    converse: async (input, _signal, options) => {
      assert.equal(input.modelId, settings.model);
      assert.deepEqual(options, { profile: settings.profile, region: settings.region });
      return {
        $metadata: {},
        metrics: { latencyMs: 1 },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        stopReason: 'end_turn',
        output: { message: { role: 'assistant', content: [{ text: draft }] } },
      };
    },
  });
  const save = exchange(settings, { path: '/api/llm/config' });
  await handler(save.req, save.res);
  assert.equal(save.result().status, 200);
  const invalid = exchange({ ...settings, region: 'invalid region' }, { path: '/api/llm/config' });
  await handler(invalid.req, invalid.res);
  assert.equal(invalid.result().status, 400);
  const generation = exchange({ provider: 'bedrock', messages });
  await handler(generation.req, generation.res);
  assert.equal(generation.result().status, 200);
  assert.equal(testEnv.AWS_PROFILE, 'original');
  assert.equal(testEnv.AWS_REGION, 'us-east-1');
});
function exchange(
  value: unknown,
  overrides: { method?: string; origin?: string; host?: string; path?: string; raw?: string } = {},
) {
  const req = Object.assign(Readable.from([overrides.raw ?? JSON.stringify(value)]), {
    url: overrides.path ?? '/api/llm/complete',
    method: overrides.method ?? 'POST',
    headers: {
      host: overrides.host ?? '127.0.0.1:5195',
      origin: overrides.origin ?? 'http://127.0.0.1:5195',
      'content-type': 'application/json',
    },
  });
  let status = 0,
    body = '';
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false,
    destroyed: false,
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(value: string) {
      body = value;
      this.writableEnded = true;
    },
  });
  return {
    req: req as unknown as IncomingMessage,
    res: res as unknown as ServerResponse,
    result: () => ({ status, body, value: body ? JSON.parse(body) : undefined }),
  };
}
it('設定公開はAPIキーを含まず、未設定のプロバイダーは呼び出さない', async () => {
  const handler = createLLMHandler({ env });
  const status = exchange({}, { path: '/api/llm/status', method: 'GET' });
  await handler(status.req, status.res);
  assert.equal(status.result().status, 200);
  assert.equal(status.result().value.providers.length, 2);
  assert.doesNotMatch(status.result().body, /test-secret/);
  assert.equal(status.result().value.providers[0].baseURL, env.INFRA_LLM_API_BASE_URL);
  const absent = exchange({ provider: 'api', messages });
  await createLLMHandler({
    env: {},
    fetcher: async () => {
      throw new Error('Must not call');
    },
  })(absent.req, absent.res);
  assert.equal(absent.result().status, 400);
  for (const baseURL of [
    'http://remote.test/v1',
    'https://user:secret@remote.test/v1',
    'https://remote.test/v1?key=secret',
    'file:///tmp/test',
  ])
    assert.equal(remoteConfigurations({ ...env, INFRA_LLM_API_BASE_URL: baseURL }).api, undefined);
  assert.ok(
    remoteConfigurations({ ...env, INFRA_LLM_API_BASE_URL: 'http://127.0.0.1:11434/v1' }).api,
  );
});
it('互換APIにサーバーのキーだけを渡し、完全なJSONと実トークン数を返す', async () => {
  const handler = createLLMHandler({
    env,
    fetcher: async (url, init) => {
      assert.equal(url, 'https://api.example.test/v1/chat/completions');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-secret');
      assert.equal(init?.redirect, 'error');
      const input = JSON.parse(String(init?.body));
      assert.equal(input.messages[0].role, 'system');
      assert.equal(input.messages[1].role, 'user');
      assert.match(input.messages[1].content, /Current DSL/);
      assert.equal(input.max_tokens, 4096);
      assert.deepEqual(input.response_format, { type: 'json_object' });
      assert.doesNotMatch(String(init?.body), /test-secret/);
      return Response.json({
        choices: [{ message: { content: draft }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 123, completion_tokens: 45 },
      });
    },
  });
  const request = exchange({ provider: 'api', messages });
  await handler(request.req, request.res);
  assert.equal(request.result().status, 200);
  assert.equal(validateDraft(JSON.parse(request.result().value.text)).diagram.resources.length, 1);
  assert.equal(request.result().value.outputTokens, 45);
});
it('Bedrockの入出力をConverse形式へ変換し、会話をuserから交互に並べる', async () => {
  const handler = createLLMHandler({
    env,
    converse: async (input, signal) => {
      assert.equal(signal.aborted, false);
      assert.equal(input.modelId, 'example-bedrock');
      assert.equal(input.inferenceConfig?.maxTokens, 4096);
      assert.ok(input.system?.[0].text?.includes('JSON'));
      const example = input.system?.[0].text?.split('Response shape example: ')[1];
      assert.ok(example);
      const responseData = JSON.parse(example);
      assert.deepEqual(Object.keys(responseData), ['message', 'dsl', 'warnings']);
      assert.equal(typeof responseData.dsl, 'string');
      assert.ok(Array.isArray(responseData.warnings));
      assert.deepEqual(
        input.messages?.map((message) => message.role),
        ['user', 'assistant', 'user'],
      );
      assert.match(input.messages?.[0].content?.[0].text ?? '', /Current DSL/);
      assert.match(input.messages?.[1].content?.[0].text ?? '', /Previous/);
      return {
        $metadata: {},
        metrics: { latencyMs: 100 },
        stopReason: 'end_turn',
        output: { message: { role: 'assistant', content: [{ text: draft }] } },
        usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
      };
    },
  });
  const request = exchange({
    provider: 'bedrock',
    messages: [
      messages[0],
      messages[1],
      { role: 'assistant', content: 'More context' },
      messages[2],
      { role: 'assistant', content: 'Previous' },
      messages[2],
    ],
  });
  await handler(request.req, request.res);
  assert.equal(request.result().status, 200);
  assert.equal(request.result().value.inputTokens, 20);
});
it('外部Origin・異なるHost・不正入力・認証情報の上書きは呼び出し前に拒否する', async () => {
  let calls = 0;
  const handler = createLLMHandler({
    env,
    fetcher: async () => {
      calls++;
      throw new Error('Must not call');
    },
  });
  for (const request of [
    exchange({ provider: 'api', messages }, { origin: 'https://evil.test' }),
    exchange(
      { provider: 'api', messages },
      { host: 'evil.test:5195', origin: 'http://evil.test:5195' },
    ),
    exchange({ provider: 'api', messages }, { method: 'GET' }),
    exchange({ provider: 'api', messages }, { path: '/api/llm/status' }),
    exchange({ provider: 'api', messages, apiKey: 'browser-secret' }),
    exchange({ provider: 'api', messages: [{ role: 'tool', content: 'data' }, messages[2]] }),
    exchange({}, { raw: 'x'.repeat(128001) }),
    exchange({}, { raw: 'invalid json' }),
  ]) {
    await handler(request.req, request.res);
    assert.ok(request.result().status >= 400);
  }
  assert.equal(calls, 0);
});
it('上限到達・不完全な応答を拒否し、認証エラー本文とSDKの秘密を応答へ出さない', async () => {
  for (const response of [
    Response.json({ key: 'test-secret' }, { status: 401 }),
    Response.json({ choices: [{ message: { content: draft }, finish_reason: 'length' }] }),
    Response.json({ choices: [{ message: { content: draft }, finish_reason: 'tool_calls' }] }),
  ]) {
    const request = exchange({ provider: 'api', messages });
    await createLLMHandler({ env, fetcher: async () => response })(request.req, request.res);
    assert.equal(request.result().status, 502);
    assert.doesNotMatch(request.result().body, /test-secret/);
  }
  const request = exchange({ provider: 'bedrock', messages });
  await createLLMHandler({
    env,
    converse: async () => {
      throw new Error('AWS_SECRET_ACCESS_KEY=test-secret');
    },
  })(request.req, request.res);
  assert.equal(request.result().status, 502);
  assert.doesNotMatch(request.result().body, /test-secret/);
});
it('中止をAPIへ伝播し、同時生成を拒否し、中止後に次の生成を許可する', async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const handler = createLLMHandler({
    env,
    fetcher: async (_url, init) => {
      entered();
      await new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('Abort')), { once: true }),
      );
      throw new Error('Abort');
    },
  });
  const first = exchange({ provider: 'api', messages });
  const running = handler(first.req, first.res);
  await started;
  const second = exchange({ provider: 'api', messages });
  await handler(second.req, second.res);
  assert.equal(second.result().status, 429);
  first.res.emit('close');
  await running;
  assert.equal(first.result().status, 408);
  const third = exchange({ provider: 'api', messages, apiKey: 'bad' });
  await handler(third.req, third.res);
  assert.equal(third.result().status, 400);
});
