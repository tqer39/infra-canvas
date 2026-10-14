import { test, expect } from '@playwright/test';

const remoteDraft = JSON.stringify({
  message: '外部LLMの候補',
  dsl: 'diagram "Remote" {\n external.service remote_worker "Workers" icon=saas.cloudflare\n external.service remote_db "Turso" icon=saas.turso\n remote_worker -> remote_db kind=dependency\n}',
  warnings: [],
});
async function remoteStatus(page: import('@playwright/test').Page, configured = true) {
  await page.route('**/api/llm/status', (route) =>
    route.fulfill({
      json: {
        providers: [
          { provider: 'api', configured, model: configured ? 'test-api-model' : '' },
          { provider: 'bedrock', configured, model: configured ? 'test-bedrock-model' : '' },
        ],
      },
    }),
  );
}

test('接続テストは保存済み設定だけを送信し、結果表示・編集時の無効化・中止ができる', async ({
  page,
}) => {
  await remoteStatus(page);
  let calls = 0;
  await page.route('**/api/llm/test', (route) => {
    expect(route.request().postDataJSON()).toEqual({ provider: 'api' });
    calls++;
    return route.fulfill({ json: { model: 'test-api-model', durationMs: 500 } });
  });
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('combobox', { name: 'LLM接続先' }).selectOption('api');
  const nodes = await page.locator('.react-flow__node').count();
  await page.getByRole('button', { name: '接続テスト', exact: true }).click();
  await expect(page.getByLabel('接続テスト結果')).toContainText('接続成功');
  expect(calls).toBe(1);
  await expect(page.locator('.react-flow__node')).toHaveCount(nodes);
  await page.screenshot({ path: 'artifacts/connection-test.png' });
  await page.getByLabel('APIモデル名', { exact: true }).fill('changed');
  await expect(page.getByRole('button', { name: '接続テスト', exact: true })).toBeDisabled();
  await expect(page.getByLabel('接続テスト結果')).toHaveCount(0);
  await page.getByLabel('APIモデル名', { exact: true }).fill('test-api-model');
  await page.unroute('**/api/llm/test');
  let release!: () => void;
  const delay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/llm/test', async (route) => {
    await delay;
    await route
      .fulfill({ json: { model: 'test-api-model', durationMs: 10 } })
      .catch(() => undefined);
  });
  await page.getByRole('button', { name: '接続テスト', exact: true }).click();
  await page.getByRole('button', { name: '接続テストを中止', exact: true }).click();
  release();
  await expect(page.getByLabel('接続テスト結果')).toContainText('中止');
  await expect(page.locator('.react-flow__node')).toHaveCount(nodes);
});

test('Bedrock接続テストの認証失敗を表示する', async ({ page }) => {
  await remoteStatus(page);
  await page.route('**/api/llm/test', (route) => {
    expect(route.request().postDataJSON()).toEqual({ provider: 'bedrock' });
    return route.fulfill({
      status: 401,
      json: { error: 'AWS認証・SSOログインを確認してください。' },
    });
  });
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('combobox', { name: 'LLM接続先' }).selectOption('bedrock');
  await page.getByRole('button', { name: '接続テスト', exact: true }).click();
  await expect(page.getByLabel('接続テスト結果')).toContainText('接続失敗');
  await expect(page.getByLabel('接続テスト結果')).toContainText('SSO');
});

for (const provider of ['api', 'bedrock'])
  test(`${provider}へ切り替えてWebGPUなしで生成・明示反映しQwenへ戻せる`, async ({ page }) => {
    await remoteStatus(page);
    await page.route('**/api/llm/complete', (route) => {
      const request = route.request().postDataJSON();
      expect(Object.keys(request).sort()).toEqual(['messages', 'provider']);
      expect(request.provider).toBe(provider);
      return route.fulfill({ json: { text: remoteDraft, inputTokens: 1200, outputTokens: 200 } });
    });
    await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
    await page.getByRole('button', { name: 'チャット', exact: true }).click();
    await page.getByRole('combobox', { name: 'LLM接続先' }).selectOption(provider);
    await expect(page.getByRole('combobox', { name: 'ローカルモデル' })).toHaveCount(0);
    await expect(page.locator('.chat-privacy')).toContainText('選択したLLMへ送信');
    await page
      .getByRole('textbox', { name: 'チャットの依頼', exact: true })
      .fill('WorkersとTursoの図を作成');
    await page.getByRole('button', { name: 'DSLを生成', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '生成したDSLの内容', exact: true })).toHaveValue(
      /remote_worker/,
    );
    await expect(page.getByLabel('生成速度')).toContainText('出力200トークン');
    await expect(page.locator('[data-id="remote_worker"]')).toHaveCount(0);
    await page.getByRole('button', { name: '図に反映', exact: true }).click();
    await expect(page.locator('[data-id="remote_worker"]')).toContainText('Workers');
    await page.getByRole('combobox', { name: 'LLM接続先' }).selectOption('local');
    await expect(page.getByRole('combobox', { name: 'ローカルモデル' })).toBeVisible();
    await expect(page.locator('.chat-privacy')).toContainText('外部のLLMへ送信しません');
  });

test('外部LLM未設定では生成を止め、画面から接続設定を入力できる', async ({ page }) => {
  await remoteStatus(page, false);
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('combobox', { name: 'LLM接続先' }).selectOption('api');
  await page.getByText('環境変数で設定する方法', { exact: true }).click();
  await expect(page.getByText(/INFRA_LLM_API_BASE_URL・INFRA_LLM_API_MODEL/)).toBeVisible();
  await page.getByRole('textbox', { name: 'チャットの依頼', exact: true }).fill('作成');
  await expect(page.getByRole('button', { name: 'DSLを生成', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '接続テスト', exact: true })).toBeDisabled();
  await expect(page.locator('input[aria-label="APIキー"]')).toHaveAttribute('type', 'password');
  await page.screenshot({ path: 'artifacts/llm-providers.png' });
});

test('API設定は画面から保存し、キーを消去して保存後に生成を有効にする', async ({ page }) => {
  await remoteStatus(page, false);
  let saved: Record<string, unknown> = {};
  await page.route('**/api/llm/config', (route) => {
    saved = route.request().postDataJSON();
    return route.fulfill({
      json: {
        providers: [
          {
            provider: 'api',
            configured: true,
            model: 'test-model',
            baseURL: 'https://api.example.test/v1',
            hasKey: true,
            settingsSource: 'persisted',
          },
          { provider: 'bedrock', configured: false, model: '' },
        ],
      },
    });
  });
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('combobox', { name: 'LLM接続先' }).selectOption('api');
  await page.getByLabel('API接続先URL', { exact: true }).fill('https://api.example.test/v1');
  await page.getByLabel('APIモデル名', { exact: true }).fill('test-model');
  await page.getByLabel('APIキー', { exact: true }).fill('browser-test-secret');
  await page.getByRole('button', { name: '接続設定を保存', exact: true }).click();
  await expect(page.getByLabel('APIキー', { exact: true })).toHaveValue('');
  expect(saved.apiKey).toBe('browser-test-secret');
  await page.getByRole('textbox', { name: 'チャットの依頼', exact: true }).fill('作成');
  await expect(page.getByRole('button', { name: 'DSLを生成', exact: true })).toBeEnabled();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    ),
  ).not.toContain('browser-test-secret');
  await page.getByRole('combobox', { name: 'LLM接続先' }).selectOption('bedrock');
  await expect(page.getByLabel('AWSプロファイル', { exact: true })).toBeVisible();
  await expect(page.getByLabel('AWSリージョン', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Bedrockモデル名', { exact: true })).toBeVisible();
});

test('Bedrockのモデル・プロファイル・リージョンを画面から保存できる', async ({ page }) => {
  await remoteStatus(page, false);
  let saved: Record<string, unknown> = {};
  await page.route('**/api/llm/config', (route) => {
    saved = route.request().postDataJSON();
    return route.fulfill({
      json: {
        providers: [
          {
            provider: 'bedrock',
            configured: true,
            model: 'test-model',
            profile: 'diagram-profile',
            region: 'ap-northeast-1',
            settingsSource: 'persisted',
          },
        ],
      },
    });
  });
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('combobox', { name: 'LLM接続先' }).selectOption('bedrock');
  await page.getByLabel('Bedrockモデル名', { exact: true }).fill('test-model');
  await page.getByLabel('AWSプロファイル', { exact: true }).fill('diagram-profile');
  await page.getByLabel('AWSリージョン', { exact: true }).fill('ap-northeast-1');
  await page.getByRole('button', { name: '接続設定を保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '起動時の設定に戻す', exact: true })).toBeVisible();
  expect(saved).toEqual({
    provider: 'bedrock',
    model: 'test-model',
    profile: 'diagram-profile',
    region: 'ap-northeast-1',
  });
  await page.screenshot({ path: 'artifacts/bedrock-settings.png' });
});

test('外部LLMの構文エラーは1回修正し、失敗・中止では元の図を保持する', async ({ page }) => {
  await remoteStatus(page);
  let calls = 0;
  await page.route('**/api/llm/complete', (route) => {
    calls++;
    return route.fulfill({
      json: {
        text: JSON.stringify({
          message: '',
          dsl: 'diagram "Bad" {\n missing -> nope\n}',
          warnings: [],
        }),
      },
    });
  });
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  const nodes = await page.locator('.react-flow__node').count();
  await page.getByRole('combobox', { name: 'LLM接続先' }).selectOption('api');
  await page.getByRole('textbox', { name: 'チャットの依頼', exact: true }).fill('変更');
  await page.getByRole('button', { name: 'DSLを生成', exact: true }).click();
  await expect(page.locator('.chat-error')).toBeVisible();
  expect(calls).toBe(2);
  await expect(page.locator('.react-flow__node')).toHaveCount(nodes);
  await page.unroute('**/api/llm/complete');
  let release!: () => void;
  const delay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/llm/complete', async (route) => {
    await delay;
    await route.fulfill({ json: { text: remoteDraft } }).catch(() => undefined);
  });
  await page.getByRole('button', { name: 'DSLを生成', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'LLM接続先' })).toBeDisabled();
  await page.getByRole('button', { name: '生成を中止', exact: true }).click();
  release();
  await expect(page.locator('.chat-status')).toContainText('生成を中止');
  await expect(page.getByRole('textbox', { name: '生成したDSLの内容', exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('.react-flow__node')).toHaveCount(nodes);
});

async function localStub(page: import('@playwright/test').Page, invalid = false) {
  await page.route('**/src/assistant/local-model.ts*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
    export const localModels=[{id:'test',label:'テスト'}];
    export class LocalModel {
      static supported(){return true;}
      async initialize(id,progress){progress('完了',1);}
      async complete(messages,progress){globalThis.__assistantInput=messages;progress?.(100,{inputTokens:1000,outputTokens:100,firstTokenSeconds:1.2,tokensPerSecond:20});return JSON.stringify({message:'SubnetにAPIを追加しました',dsl:${JSON.stringify(invalid ? 'diagram "Bad" {\n missing -> nope\n}' : 'diagram "チャットで作成" {\n vpc v "VPC" {\n subnet s "Private" private {\n aws.ec2 created_api "API" evidence=observed securityGroups=[sg_api]\n }\n sg sg_api "API SG" ingress=["tcp 443 10.0.0.0/16"] egress=[]\n }\n view service level=resource\n}')},warnings:[]});}
      interrupt(){}
    }`,
    }),
  );
}

test('Subnet実体とSGをサンプルから表示する', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page
    .getByRole('combobox', { name: 'サンプル', exact: true })
    .selectOption('subnetSecurity');
  await expect(page.locator('[data-id="api"]')).toContainText('app_sg / monitoring_sg');
  await expect(page.locator('[data-id="private_a"]')).toContainText('Private Subnet');
  await page.locator('.react-flow__viewport').evaluate(async () => {
    for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
  });
  await page.screenshot({ path: 'artifacts/subnet-security.png' });
  await page.getByRole('button', { name: 'セキュリティ', exact: true }).click();
  await expect(page.locator('[data-id="app_sg"]')).toContainText('sg:web_sg');
  await expect(page.locator('[data-id="app_sg"]')).toContainText('8080');
});
test('ローカル生成を検証して候補にし、明示反映する', async ({ page }) => {
  await localStub(page);
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('button', { name: 'モデルを読み込む', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'チャットの依頼', exact: true })
    .fill('Private SubnetにAPIを追加');
  await page.getByRole('button', { name: 'DSLを生成', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '生成したDSLの内容', exact: true })).toHaveValue(
    /subnet s/,
  );
  await expect(page.locator('[data-id="created_api"]')).toHaveCount(0);
  await expect(page.getByLabel('生成速度')).toContainText('20.0トークン/秒');
  await page.getByRole('button', { name: '図に反映', exact: true }).click();
  await expect(page.locator('[data-id="created_api"]')).toContainText('API');
});

test('モデルの品質・速度の選択肢とモデル不要の概要作成を案内する', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  const models = page.getByRole('combobox', { name: 'ローカルモデル' });
  await expect(models).toContainText('3B（品質優先）');
  await expect(models).toContainText('1.5B（速度優先・小さな図向け）');
  await expect(
    page.getByText('速度重視なら1.5Bを選んで読み込んでください。', { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/generation-speed.png' });
});
test('古い生成候補を反映しない', async ({ page }) => {
  await localStub(page);
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('button', { name: 'モデルを読み込む', exact: true }).click();
  await page.getByRole('textbox', { name: 'チャットの依頼', exact: true }).fill('APIを追加');
  await page.getByRole('button', { name: 'DSLを生成', exact: true }).click();
  await expect(page.getByRole('button', { name: '図に反映', exact: true })).toBeEnabled();
  await page
    .getByRole('combobox', { name: 'サンプル', exact: true })
    .selectOption('subnetSecurity');
  await expect(page.getByRole('button', { name: '図に反映', exact: true })).toBeDisabled();
  await expect(
    page.getByText('生成後に現在のDSLが変更されました。再生成してください。'),
  ).toBeVisible();
});
test('生成失敗でも図を保持する', async ({ page }) => {
  await localStub(page, true);
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('button', { name: 'モデルを読み込む', exact: true }).click();
  await page.getByRole('textbox', { name: 'チャットの依頼', exact: true }).fill('作成');
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  const before = await page.getByRole('textbox', { name: 'DSL 入力', exact: true }).inputValue();
  await page.getByRole('button', { name: 'DSLを生成', exact: true }).click();
  await expect(page.locator('.chat-status')).toContainText('現在の図は保持');
  await expect(page.getByRole('button', { name: '図に反映', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'DSL 入力', exact: true })).toHaveValue(before);
});
test('リポジトリ内のDSLを検証して候補として読み込む', async ({ page }) => {
  await page.route('**/api/repository/status', (r) => r.fulfill({ json: { available: true } }));
  await page.route('**/api/repository', (r) =>
    r.fulfill({
      json: {
        url: 'https://github.com/example/infra',
        name: 'example/infra',
        ref: 'main',
        commit: 'a'.repeat(40),
        files: [
          { path: 'diagram.infra', content: 'diagram "Repo" {\n external.service app "App"\n}' },
        ],
        warnings: [],
      },
    }),
  );
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByText('リポジトリURLから作成', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'リポジトリURL', exact: true })
    .fill('https://github.com/example/infra');
  await page.getByRole('button', { name: 'リポジトリを読み込む', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '生成したDSLの内容', exact: true })).toHaveValue(
    /external.service app/,
  );
  await expect(page.locator('[data-id="app"]')).toHaveCount(0);
  await page.getByRole('button', { name: '図に反映', exact: true }).click();
  await expect(page.locator('[data-id="app"]')).toContainText('App');
});

test('リポジトリから生成した候補にcommitを記録し、観測済みと誤表示しない', async ({ page }) => {
  await localStub(page);
  await page.route('**/api/repository/status', (r) => r.fulfill({ json: { available: true } }));
  await page.route('**/api/repository', (r) =>
    r.fulfill({
      json: {
        url: 'https://github.com/example/infra',
        name: 'example/infra',
        ref: 'main',
        commit: 'a'.repeat(40),
        files: [{ path: 'infra/main.tf', content: 'resource "aws_instance" "api" {}' }],
        warnings: [],
      },
    }),
  );
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('button', { name: 'モデルを読み込む', exact: true }).click();
  await page.getByText('リポジトリURLから作成', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'リポジトリURL', exact: true })
    .fill('https://github.com/example/infra');
  await page.getByRole('button', { name: 'リポジトリを読み込む', exact: true }).click();
  await page.getByRole('button', { name: 'LLMで概要を補足', exact: true }).click();
  const proposal = page.getByRole('textbox', { name: '生成したDSLの内容', exact: true });
  await expect(proposal).toHaveValue(/sourceKind="static"/);
  await expect(proposal).toHaveValue(/repository="https:\/\/github.com\/example\/infra"/);
  await expect(proposal).toHaveValue(/evidence="inferred"/);
  await expect(proposal).not.toHaveValue(/observed/);
});

test('別のリポジトリの取得に失敗しても古い根拠を再利用しない', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/repository/status', (r) => r.fulfill({ json: { available: true } }));
  await page.route('**/api/repository', (r) =>
    r.fulfill(
      ++reads === 1
        ? {
            json: {
              url: 'https://github.com/example/infra',
              name: 'example/infra',
              ref: 'main',
              commit: 'a'.repeat(40),
              files: [{ path: 'infra/main.tf', content: 'resource "aws_instance" "api" {}' }],
              warnings: [],
            },
          }
        : { status: 404, json: { error: 'notfound' } },
    ),
  );
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  const title = await page.locator('.document-title').innerText();
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByText('リポジトリURLから作成', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'リポジトリURL', exact: true })
    .fill('https://github.com/example/infra');
  await page.getByRole('button', { name: 'リポジトリを読み込む', exact: true }).click();
  await expect(page.locator('.repository-result')).toContainText('example/infra');
  await page
    .getByRole('textbox', { name: 'リポジトリURL', exact: true })
    .fill('https://github.com/example/missing');
  await page.getByRole('button', { name: 'リポジトリを読み込む', exact: true }).click();
  await expect(page.locator('.chat-error')).toContainText('notfound');
  await expect(page.locator('.repository-result')).toHaveCount(0);
  await expect(page.locator('.document-title')).toHaveText(title);
});

test('モデル未起動でもWranglerの宣言から概要候補を作り明示反映する', async ({ page }) => {
  await page.route('**/api/repository/status', (r) => r.fulfill({ json: { available: true } }));
  await page.route('**/api/repository', (r) =>
    r.fulfill({
      json: {
        url: 'https://github.com/example/infra',
        name: 'example/infra',
        ref: 'main',
        commit: 'a'.repeat(40),
        warnings: [],
        files: [
          {
            path: 'wrangler.jsonc',
            content:
              '{"name":"app","main":"src/index.ts","queues":{"producers":[{"binding":"Q","queue":"jobs"}]}}',
          },
        ],
      },
    }),
  );
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByText('リポジトリURLから作成', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'リポジトリURL', exact: true })
    .fill('https://github.com/example/infra');
  await page.getByRole('button', { name: 'リポジトリを読み込む', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '生成したDSLの内容', exact: true })).toHaveValue(
    /repo_cf_app/,
  );
  await expect(page.locator('[data-id="repo_cf_app"]')).toHaveCount(0);
  await page.getByRole('button', { name: '図に反映', exact: true }).click();
  await expect(page.locator('[data-id="repo_cf_app"]')).toContainText('Workersアプリ');
});

test('groupにTursoサービスアイコンを指定してDSLへ保存できる', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.locator('input[type=file]').setInputFiles({
    name: 'group.infra',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'diagram "Groups" {\n group db "Turso" icon=saas.turso {\n external.service instance "DB" icon=saas.turso\n }\n view service level=resource\n}',
    ),
  });
  const group = page.locator('[data-id="db"]');
  await expect(group.locator('.service-icon')).toHaveCount(1);
  const before = await group.locator('.service-icon').getAttribute('src');
  await group.getByText('Turso', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: '表示アイコン', exact: true })).toHaveValue(
    'saas.turso',
  );
  await page
    .getByRole('combobox', { name: '表示アイコン', exact: true })
    .selectOption('saas.discord');
  await expect(group.locator('.service-icon')).not.toHaveAttribute('src', before!);
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'DSL 入力', exact: true })).toHaveValue(
    /icon="saas.discord"/,
  );
});

test('リポジトリのデプロイ・Turso・シークレット取得を別の関係として表示する', async ({ page }) => {
  await page.route('**/api/repository/status', (r) => r.fulfill({ json: { available: true } }));
  await page.route('**/api/repository', (r) =>
    r.fulfill({
      json: {
        url: 'https://github.com/example/infra',
        name: 'example/infra',
        ref: 'main',
        commit: 'a'.repeat(40),
        warnings: [],
        files: [
          {
            path: '.github/workflows/release.yml',
            content:
              'jobs:\n  release:\n    steps:\n      - run: node scripts/release.mjs\n      - uses: 1password/load-secrets-action@v5\n        env:\n          KEY: op://private/item/field',
          },
          { path: 'scripts/release.mjs', content: 'command("npx", ["wrangler", "deploy"]);' },
          {
            path: 'wrangler.jsonc',
            content:
              '{"name":"app","main":"src/worker/index.ts","vars":{"DATABASE_BACKEND":"turso","TURSO_DATABASE_URL":"https://example.turso.io"}}',
          },
          {
            path: 'src/worker/index.ts',
            content:
              'import { TursoDatabase } from "./database"; new TursoDatabase(env.TURSO_DATABASE_URL!, env.TURSO_AUTH_TOKEN);',
          },
          {
            path: 'src/worker/database.ts',
            content: 'import {openHttp} from "@libsql/hrana-client"; openHttp(url,token);',
          },
        ],
      },
    }),
  );
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByText('リポジトリURLから作成', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'リポジトリURL', exact: true })
    .fill('https://github.com/example/infra');
  await page.getByRole('button', { name: 'リポジトリを読み込む', exact: true }).click();
  const proposal = page.getByRole('textbox', { name: '生成したDSLの内容', exact: true });
  await expect(proposal).toHaveValue(/repo_cloudflare_deployment/);
  await expect(proposal).toHaveValue(/repo_turso_connection/);
  await expect(proposal).toHaveValue(/repo_secret_supply/);
  await expect(proposal).not.toHaveValue(/op:\/\//);
  await page.getByRole('button', { name: '図に反映', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await expect(page.locator('[data-id="repo_onepassword"]')).toContainText('1Password');
});

test('1PasswordからWorkersへの同期をActions経由の線として反映する', async ({ page }) => {
  await page.route('**/api/repository/status', (r) => r.fulfill({ json: { available: true } }));
  await page.route('**/api/repository', (r) =>
    r.fulfill({
      json: {
        url: 'https://github.com/example/infra',
        name: 'example/infra',
        ref: 'main',
        commit: 'a'.repeat(40),
        warnings: [],
        files: [
          {
            path: '.github/workflows/sync.yml',
            content:
              'jobs:\n  worker:\n    steps:\n      - uses: 1password/load-secrets-action@v5\n        env:\n          KEY: op://PRIVATE/item/key\n      - run: node scripts/sync-worker-secrets.mjs',
          },
          {
            path: 'scripts/sync-worker-secrets.mjs',
            content:
              'const names=["KEY"];const secrets=Object.fromEntries(names.map(name=>[name,env[name]]));const wrangler=fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js",import.meta.url));run(process.execPath,[wrangler,"secret","bulk"],{input:JSON.stringify(secrets)});',
          },
          { path: 'wrangler.jsonc', content: '{"name":"app","main":"src/index.ts"}' },
        ],
      },
    }),
  );
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByText('リポジトリURLから作成', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'リポジトリURL', exact: true })
    .fill('https://github.com/example/infra');
  await page.getByRole('button', { name: 'リポジトリを読み込む', exact: true }).click();
  const proposal = page.getByRole('textbox', { name: '生成したDSLの内容', exact: true });
  await expect(proposal).toHaveValue(/repo_worker_secret_sync/);
  await expect(proposal).not.toHaveValue(/op:\/\/|PRIVATE/);
  await page.getByRole('button', { name: '図に反映', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /1Password.*Workers.*シークレット同期/ }),
  ).toHaveCount(1);
});

test('LLMにファイルの抜粋だけでなくASTで検出した関係と根拠を渡す', async ({ page }) => {
  await localStub(page);
  await page.route('**/api/repository/status', (r) => r.fulfill({ json: { available: true } }));
  await page.route('**/api/repository', (r) =>
    r.fulfill({
      json: {
        url: 'https://github.com/example/infra',
        name: 'example/infra',
        ref: 'main',
        commit: 'a'.repeat(40),
        warnings: [],
        files: [
          {
            path: '.github/workflows/ship.yml',
            content: 'jobs: {ship: {steps: [{run: "node tools/entry.mjs"}]}}',
          },
          {
            path: 'tools/entry.mjs',
            content: 'import {go as upload} from "../ops/custom.mjs"; upload();',
          },
          {
            path: 'ops/custom.mjs',
            content: 'export function go(){ execute("npx",["wrangler","deploy"]); }',
          },
          { path: 'wrangler.jsonc', content: '{"name":"app","main":"src/index.ts"}' },
        ],
      },
    }),
  );
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('button', { name: 'モデルを読み込む', exact: true }).click();
  await page.getByText('リポジトリURLから作成', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'リポジトリURL', exact: true })
    .fill('https://github.com/example/infra');
  await page.getByRole('button', { name: 'リポジトリを読み込む', exact: true }).click();
  await page.getByRole('button', { name: 'LLMで概要を補足', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '生成したDSLの内容', exact: true })).toHaveValue(
    /created_api/,
  );
  const messages = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __assistantInput: { content: string }[] })
        .__assistantInput,
  );
  const evidence =
    messages.find((message) => message.content.includes('STRUCTURED STATIC EVIDENCE'))?.content ??
    '';
  expect(evidence).toContain('ops/custom.mjs');
  expect(evidence).toContain('"kind":"deployment"');
  expect(evidence).toContain('"line":');
  expect(evidence).toContain('"caller":"go"');
});

test('TOML・paths・引数伝播からデプロイとTurso接続を検出しLLMへ渡す', async ({ page }) => {
  await localStub(page);
  await page.route('**/api/repository/status', (r) => r.fulfill({ json: { available: true } }));
  const files = [
    {
      path: '.github/workflows/ship.yml',
      content: 'jobs: {ship: {steps: [{run: "node tools/entry.mjs"}]}}',
    },
    { path: 'tsconfig.json', content: '{"compilerOptions":{"paths":{"@ops/*":["ops/*"]}}}' },
    {
      path: 'tools/entry.mjs',
      content:
        'import {send} from "@ops/runner";const routes={ship:send.bind(null,"npx")};const selected="ship";const verb=choose(true);routes[selected](["wrangler",verb]);function choose(flag){if(flag)return "deploy";return "help";}',
    },
    {
      path: 'ops/runner.ts',
      content:
        'import {spawnSync as execute} from "node:child_process";export function send(binary,args){execute(binary,args);}',
    },
    {
      path: 'wrangler.toml',
      content: 'name="app"\nmain="src/edge.mjs"\n[vars]\nURL="https://example.turso.io"',
    },
    {
      path: 'src/edge.mjs',
      content: 'import {createClient as open} from "@libsql/client";open({url:env.URL});',
    },
  ];
  await page.route('**/api/repository', (r) =>
    r.fulfill({
      json: {
        url: 'https://github.com/example/infra',
        name: 'example/infra',
        ref: 'main',
        commit: 'a'.repeat(40),
        warnings: [],
        files,
      },
    }),
  );
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'チャット', exact: true }).click();
  await page.getByRole('button', { name: 'モデルを読み込む', exact: true }).click();
  await page.getByText('リポジトリURLから作成', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'リポジトリURL', exact: true })
    .fill('https://github.com/example/infra');
  await page.getByRole('button', { name: 'リポジトリを読み込む', exact: true }).click();
  const proposal = page.getByRole('textbox', { name: '生成したDSLの内容', exact: true });
  await expect(proposal).toHaveValue(/repo_cloudflare_deployment/);
  await expect(proposal).toHaveValue(/repo_turso_connection/);
  await page.getByRole('button', { name: 'LLMで概要を補足', exact: true }).click();
  await expect(proposal).toHaveValue(/created_api/);
  const messages = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __assistantInput: { content: string }[] })
        .__assistantInput,
  );
  const evidence =
    messages.find((m) => m.content.includes('STRUCTURED STATIC EVIDENCE'))?.content ?? '';
  expect(evidence).toContain('"flows"');
  expect(evidence).toContain('ops/runner.ts');
});
