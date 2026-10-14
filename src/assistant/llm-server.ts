import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ChatMessage } from './contract.js';
import type { ProviderStatus, RemoteProvider, RemoteResult } from './remote-contract.js';
import {
  PersistentSettings,
  settingsDirectory,
  type SettingsStore,
  type Settings,
} from './settings-store.js';

export interface Configuration {
  model: string;
  maxTokens: number;
  baseURL?: string;
  apiKey?: string;
  jsonMode?: boolean;
  profile?: string;
  region?: string;
}
export function remoteConfigurations(
  env: NodeJS.ProcessEnv = process.env,
): Record<RemoteProvider, Configuration | undefined> {
  const maxTokens = Number(env.INFRA_LLM_MAX_TOKENS ?? 4096);
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 16384)
    return { api: undefined, bedrock: undefined };
  const model = (value: string | undefined) =>
    value?.trim() && value.length <= 512 ? value.trim() : undefined;
  let api: Configuration | undefined;
  try {
    const url = new URL(env.INFRA_LLM_API_BASE_URL ?? '');
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      )
    )
      throw new Error();
    const id = model(env.INFRA_LLM_API_MODEL),
      key = env.INFRA_LLM_API_KEY?.trim();
    if (id && key && !/[\r\n]/.test(key))
      api = {
        model: id,
        maxTokens,
        baseURL: url.href.replace(/\/$/, ''),
        apiKey: key,
        jsonMode: env.INFRA_LLM_API_JSON_MODE !== 'off',
      };
  } catch {
    /* An incomplete or invalid config is unavailable, never echoed. */
  }
  const bedrockModel = model(env.INFRA_LLM_BEDROCK_MODEL);
  return {
    api,
    bedrock: bedrockModel
      ? {
          model: bedrockModel,
          maxTokens,
          profile: env.AWS_PROFILE || undefined,
          region: env.AWS_REGION || undefined,
        }
      : undefined,
  };
}
interface Dependencies {
  settings?: SettingsStore;
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  converse?: (
    input: ConverseCommandInput,
    signal: AbortSignal,
    options: { profile?: string; region?: string },
  ) => Promise<ConverseCommandOutput>;
}
class PublicError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const tokenCount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
function boundedMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 16)
    throw new PublicError(400, 'メッセージの件数を確認してください。');
  if (
    !value.every(
      (item) =>
        item &&
        ['user', 'assistant'].includes(item.role) &&
        typeof item.content === 'string' &&
        item.content.length > 0 &&
        item.content.length <= 25000,
    )
  )
    throw new PublicError(400, 'メッセージの形式・長さを確認してください。');
  if (value.reduce((sum, item) => sum + item.content.length, 0) > 100000)
    throw new PublicError(400, '入力が長すぎます。');
  return value.map((item) => ({ role: item.role, content: item.content }));
}
async function complete(
  provider: RemoteProvider,
  config: Configuration,
  messages: ChatMessage[],
  signal: AbortSignal,
  dependencies: Dependencies,
  purpose: 'generate' | 'test' = 'generate',
): Promise<RemoteResult> {
  const system =
    purpose === 'test'
      ? 'Connection check. Reply only with the JSON object {"ok":true}.'
      : messages[0].content +
        '\nReturn the response data itself, with exactly these top-level fields: message (Japanese string), dsl (complete DSL string), warnings (Japanese string array). Do not return a JSON schema or wrap the fields in properties. Escape all quotes and newlines inside strings. Response shape example: ' +
        JSON.stringify({
          message: '構成図を生成しました。',
          dsl: 'diagram "Example" version=1 {\n external.service app "App"\n view service level=resource\n}',
          warnings: [],
        });
  // Converse models may require a user first and alternating turns.
  const conversation: ChatMessage[] = [];
  let sawUser = false;
  for (const message of messages.slice(1)) {
    const role = sawUser ? message.role : 'user';
    if (message.role === 'user') sawUser = true;
    const last = conversation.at(-1);
    if (last?.role === role) last.content += '\n\n' + message.content;
    else conversation.push({ role, content: message.content });
  }
  if (provider === 'api') {
    const response = await (dependencies.fetcher ?? fetch)(config.baseURL + '/chat/completions', {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: system }, ...conversation],
        max_tokens: config.maxTokens,
        stream: false,
        ...(config.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new PublicError(
        502,
        response.status === 401 || response.status === 403
          ? 'APIキー・モデルの利用権限を確認してください。'
          : response.status === 429
            ? '接続先の利用上限に達しました。時間を置いて再試行してください。'
            : 'APIへの接続に失敗しました。URL・モデル・JSONモードの設定を確認してください。',
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new PublicError(502, 'LLMの応答が空です。');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1000000) throw new PublicError(502, 'LLMの応答が上限を超えています。');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const choice = result.choices?.[0];
    if (choice?.finish_reason === 'length')
      throw new PublicError(
        502,
        purpose === 'test'
          ? 'モデルには到達しましたが、短いテスト応答が出力上限内で完了しませんでした。'
          : '生成が出力上限に達しました。図や依頼を小さくしてください。',
      );
    if (choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string')
      throw new PublicError(502, '完全なテキスト応答を取得できませんでした。');
    return {
      text: choice.message.content,
      inputTokens: tokenCount(result.usage?.prompt_tokens),
      outputTokens: tokenCount(result.usage?.completion_tokens),
    };
  }
  const input: ConverseCommandInput = {
    modelId: config.model,
    system: [{ text: system }],
    messages: conversation.map((message) => ({
      role: message.role,
      content: [{ text: message.content }],
    })),
    inferenceConfig: { maxTokens: config.maxTokens },
  };
  let client: BedrockRuntimeClient | undefined;
  try {
    const result = dependencies.converse
      ? await dependencies.converse(input, signal, {
          profile: config.profile,
          region: config.region,
        })
      : await (client = new BedrockRuntimeClient({
          maxAttempts: 1,
          profile: config.profile,
          region: config.region,
        })).send(new ConverseCommand(input), { abortSignal: signal });
    if (result.stopReason === 'max_tokens')
      throw new PublicError(
        502,
        purpose === 'test'
          ? 'モデルには到達しましたが、短いテスト応答が出力上限内で完了しませんでした。'
          : '生成が出力上限に達しました。図や依頼を小さくしてください。',
      );
    if (result.stopReason !== 'end_turn' && result.stopReason !== 'stop_sequence')
      throw new PublicError(502, 'Bedrockから完全なテキスト応答を取得できませんでした。');
    return {
      text: result.output?.message?.content?.map((item) => item.text ?? '').join('') ?? '',
      inputTokens: tokenCount(result.usage?.inputTokens),
      outputTokens: tokenCount(result.usage?.outputTokens),
    };
  } finally {
    client?.destroy();
  }
}

function screenConfiguration(
  value: Record<string, unknown>,
  previous: Configuration | undefined,
  maxTokens: number,
): Configuration {
  const allowed =
    value.provider === 'api'
      ? ['provider', 'model', 'baseURL', 'apiKey']
      : ['provider', 'model', 'profile', 'region'];
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new PublicError(400, '設定の項目を確認してください。');
  const text = (key: string, limit: number) => {
    const item = value[key];
    if (item === undefined) return '';
    if (
      typeof item !== 'string' ||
      item.length > limit ||
      [...item].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new PublicError(400, '設定の形式・長さを確認してください。');
    return item.trim();
  };
  const model = text('model', 512);
  if (!model) throw new PublicError(400, 'モデル名を入力してください。');
  if (value.provider === 'api') {
    const baseURL = text('baseURL', 2048);
    const normalized = remoteConfigurations({
      INFRA_LLM_API_BASE_URL: baseURL,
      INFRA_LLM_API_MODEL: model,
      INFRA_LLM_API_KEY: 'validation-placeholder',
      INFRA_LLM_MAX_TOKENS: String(maxTokens),
    }).api;
    if (!normalized)
      throw new PublicError(
        400,
        '接続先URLはHTTPS、またはlocalhostのHTTPを指定してください。認証情報・クエリー付きURLは利用できません。',
      );
    const key = text('apiKey', 8192);
    if (!key && normalized.baseURL !== previous?.baseURL)
      throw new PublicError(400, '接続先URLを変更するときはAPIキーも入力してください。');
    if (!key && !previous?.apiKey) throw new PublicError(400, 'APIキーを入力してください。');
    return { ...normalized, apiKey: key || previous?.apiKey, jsonMode: previous?.jsonMode ?? true };
  }
  const profile = text('profile', 128),
    region = text('region', 64);
  if (region && !/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/.test(region))
    throw new PublicError(400, 'AWSリージョンの形式を確認してください。');
  return { model, maxTokens, profile: profile || undefined, region: region || undefined };
}

/** Loopback only. API keys live in the OS credential store and never reach responses. */
export function createLLMHandler(dependencies: Dependencies = {}) {
  let busy = false;
  const settings =
    dependencies.settings ?? new PersistentSettings(settingsDirectory(dependencies.env));
  const statuses = (
    configs: Record<RemoteProvider, Configuration | undefined>,
    saved: Settings,
  ): ProviderStatus[] => {
    return (['api', 'bedrock'] as const).map((provider) => ({
      provider,
      configured: Boolean(configs[provider]),
      model: configs[provider]?.model ?? '',
      ...(provider === 'api'
        ? { baseURL: configs.api?.baseURL ?? '', hasKey: Boolean(configs.api?.apiKey) }
        : { profile: configs.bedrock?.profile ?? '', region: configs.bedrock?.region ?? '' }),
      settingsSource: saved[provider] ? 'persisted' : 'environment',
    }));
  };
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const pathname = (req.url ?? '').split('?')[0];
    if (
      !['/api/llm/status', '/api/llm/complete', '/api/llm/config', '/api/llm/test'].includes(
        pathname,
      )
    )
      return false;
    const reply = (status: number, value: unknown) => {
      if (!res.destroyed && !res.writableEnded)
        res
          .writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          .end(JSON.stringify(value));
    };
    const host = req.headers.host,
      origin = req.headers.origin;
    if (
      !/^(?:127\.0\.0\.1|localhost):\d+$/.test(host ?? '') ||
      (origin !== undefined && origin !== `http://${host}`)
    ) {
      reply(403, { error: 'ローカル画面からの利用だけを許可しています。' });
      return true;
    }
    let saved: Settings = {},
      storageError = '';
    try {
      saved = await settings.load();
    } catch {
      storageError =
        '保存済み設定を読み込めません。OSの資格情報ストアのロック・権限や設定ファイルを確認してください。';
    }
    const configs = { ...remoteConfigurations(dependencies.env), ...saved };
    if (res.destroyed) return true;
    if (pathname === '/api/llm/status' && req.method === 'GET') {
      reply(200, {
        providers: storageError ? [] : statuses(configs, saved),
        ...(storageError ? { storageError } : {}),
      });
      return true;
    }
    if (!['/api/llm/complete', '/api/llm/config', '/api/llm/test'].includes(pathname)) {
      reply(405, { error: 'GETだけを許可しています。' });
      return true;
    }
    if (
      req.method !== 'POST' ||
      origin !== `http://${host}` ||
      String(req.headers['content-type'] ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase() !== 'application/json'
    ) {
      reply(403, { error: 'ローカル画面からのJSONリクエストだけを許可しています。' });
      return true;
    }
    if (busy) {
      reply(429, { error: '別の生成が実行中です。完了または中止後に再試行してください。' });
      return true;
    }
    busy = true;
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), pathname === '/api/llm/test' ? 30000 : 120000);
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    req.on('aborted', () => controller.abort());
    controller.signal.addEventListener(
      'abort',
      () => {
        if (!req.readableEnded) req.destroy(new Error('Request aborted'));
      },
      { once: true },
    );
    try {
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > (pathname === '/api/llm/config' ? 16000 : 128000))
          throw new PublicError(400, '入力が長すぎます。');
        chunks.push(buffer);
      }
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new PublicError(400, 'JSON入力を確認してください。');
      }
      if (pathname === '/api/llm/config') {
        let warning: string | undefined;
        if (
          !value ||
          typeof value !== 'object' ||
          !['api', 'bedrock'].includes(String(value.provider))
        )
          throw new PublicError(400, '接続先を選択してください。');
        const provider = value.provider as RemoteProvider;
        if (
          value.reset === true &&
          Object.keys(value).every((key) => ['provider', 'reset'].includes(key))
        ) {
          try {
            warning = await settings.reset(provider);
          } catch {
            throw new PublicError(
              503,
              '保存済み設定を解除できません。設定ファイルやOSの資格情報ストアの権限を確認してください。',
            );
          }
          delete saved[provider];
          configs[provider] = remoteConfigurations(dependencies.env)[provider];
        } else {
          const config = screenConfiguration(
            value,
            configs[provider],
            configs[provider]?.maxTokens ?? 4096,
          );
          try {
            warning = await settings.save(provider, config);
          } catch {
            throw new PublicError(
              503,
              '設定を安全に保存できません。OSの資格情報ストアのロック・権限・対応状況と保存先を確認してください。APIキーの平文保存は行いません。',
            );
          }
          saved[provider] = config;
          configs[provider] = config;
        }
        reply(200, { providers: statuses(configs, saved), ...(warning ? { warning } : {}) });
        return true;
      }
      if (storageError) throw new PublicError(503, storageError);
      if (pathname === '/api/llm/test') {
        if (
          !value ||
          typeof value !== 'object' ||
          !['api', 'bedrock'].includes(String(value.provider)) ||
          Object.keys(value).some((key) => key !== 'provider')
        )
          throw new PublicError(400, '接続テストには接続先だけを指定してください。');
        const provider = value.provider as RemoteProvider,
          config = configs[provider];
        if (!config) throw new PublicError(400, '先に接続設定を保存してください。');
        const started = performance.now();
        const result = await complete(
          provider,
          { ...config, maxTokens: 64 },
          [
            { role: 'user', content: 'Connection check' },
            { role: 'user', content: 'Reply with {"ok":true}.' },
          ],
          controller.signal,
          dependencies,
          'test',
        );
        if (!result.text.trim())
          throw new PublicError(502, '接続先からテキスト応答を取得できませんでした。');
        reply(200, {
          provider,
          model: config.model,
          checkedAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - started),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
        return true;
      }
      if (
        !value ||
        typeof value !== 'object' ||
        !['api', 'bedrock'].includes(String(value.provider)) ||
        Object.keys(value).some((key) => !['provider', 'messages'].includes(key))
      )
        throw new PublicError(400, '接続先とメッセージだけを指定してください。');
      const provider = value.provider as RemoteProvider,
        config = configs[provider];
      if (!config)
        throw new PublicError(
          400,
          '接続先が未設定です。サーバーの環境変数を設定して再起動してください。',
        );
      const result = await complete(
        provider,
        config,
        boundedMessages(value.messages),
        controller.signal,
        dependencies,
      );
      if (!result.text || result.text.length > 100000)
        throw new PublicError(502, 'LLMの応答が空か、上限を超えています。');
      reply(200, result);
    } catch (error) {
      if (controller.signal.aborted)
        reply(408, {
          error:
            pathname === '/api/llm/test'
              ? '接続テストを中止したか、制限時間を超えました。'
              : '生成を中止したか、制限時間を超えました。',
        });
      else if (error instanceof PublicError) reply(error.status, { error: error.message });
      else if (
        pathname === '/api/llm/test' &&
        [
          'CredentialsProviderError',
          'TokenProviderError',
          'ExpiredTokenException',
          'UnrecognizedClientException',
          'InvalidClientTokenId',
        ].includes((error as Error)?.name)
      )
        reply(401, {
          error:
            'AWS認証を取得・使用できませんでした。プロファイルとSSOログイン・認証情報の期限を確認してください。',
        });
      else if (pathname === '/api/llm/test' && (error as Error)?.name === 'AccessDeniedException')
        reply(403, {
          error:
            'Bedrockのモデル呼び出しが拒否されました。IAM権限・モデルの利用権限を確認してください。',
        });
      else
        reply(502, {
          error:
            'LLMへの接続に失敗しました。API設定またはAWS認証・リージョン・モデルの利用権限を確認してください。',
        });
    } finally {
      clearTimeout(timeout);
      busy = false;
    }
    return true;
  };
}
export const handleLLMRequest = createLLMHandler();
