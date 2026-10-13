import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.beforeAll(() => {
  mkdirSync('artifacts', { recursive: true });
  execFileSync(process.execPath, [
    'dist/cli.js',
    'html',
    'examples/aws.infra',
    '--out',
    'artifacts/aws.html',
  ]);
  execFileSync(process.execPath, [
    'dist/cli.js',
    'html',
    'examples/saas.infra',
    '--out',
    'artifacts/saas.html',
  ]);
  execFileSync(process.execPath, [
    'dist/cli.js',
    'html',
    'examples/service-catalog.infra',
    '--out',
    'artifacts/service-catalog.html',
  ]);
  execFileSync(process.execPath, [
    'dist/cli.js',
    'import',
    'examples/terraform',
    '--json',
    'fixture-plan.json',
    '--out',
    'artifacts/terraform-model.json',
    '--dsl',
    'artifacts/terraform.infra',
  ]);
});
for (const offline of [false, true]) {
  test(`境界を一括で折りたたみ・展開し、詳細範囲とパン・ズームを維持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : 'http://127.0.0.1:5188');
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    await page.getByRole('button', { name: 'DSL を編集' }).click();
    await page
      .getByRole('textbox', { name: 'DSL 入力' })
      .fill(
        'diagram "一括操作" {\naccount west "西アカウント" {\ngroup nested "入れ子" {\nsaas.github a "A"\nsaas.gitlab b "B"\n}\n}\naccount east "東アカウント" {\nsaas.linear c "C"\n}\nsaas.neon external "外部"\na -> c kind=traffic\nb -> external kind=deploy\n}',
      );
    await page.getByRole('button', { name: '解析して反映' }).click();
    await expect(page.locator('.canvas-footer')).toContainText('7 要素');
    await page.getByRole('button', { name: 'DSL を編集' }).click();
    const fold = page.getByRole('button', { name: 'すべて折りたたむ', exact: true });
    const expand = page.getByRole('button', { name: 'すべて展開する', exact: true });
    const viewport = () =>
      page.locator('.react-flow__viewport').evaluate(async (element) => {
        for (let frame = 0; frame < 35; frame++) await new Promise(requestAnimationFrame);
        return getComputedStyle(element).transform;
      });
    await page.mouse.move(400, 250);
    await viewport();
    await page.mouse.wheel(120, 0);
    await page.mouse.wheel(0, 100);
    const before = await viewport();
    await fold.click();
    await expect(page.locator('.canvas-footer')).toContainText('3 要素 ·  2 接続');
    await expect(fold).toBeDisabled();
    expect(await viewport()).toBe(before);
    await expect(
      page.getByRole('button', { name: '西アカウント → 東アカウント: 通信', exact: true }),
    ).toHaveCount(1);
    await expand.click();
    await expect(page.locator('.canvas-footer')).toContainText('7 要素 ·  2 接続');
    await expect(expand).toBeDisabled();
    await expect(page.locator('.collapsed-card')).toHaveCount(0);
    expect(await viewport()).toBe(before);
    await expect(page.getByRole('button', { name: 'A → C: 通信', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: '概要', exact: true }).click();
    await fold.click();
    await expect(page.locator('.canvas-footer')).toContainText('3 要素');
    await expand.click();
    await expect(page.locator('.canvas-footer')).toContainText('7 要素');
    await page.getByRole('textbox', { name: 'リソース検索' }).fill('西アカウント');
    await page.locator('.search-results button').click();
    await page.getByRole('button', { name: '詳細へ移動', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('4 要素');
    await fold.click();
    await expect(page.locator('.canvas-footer')).toContainText('1 要素');
    await expand.click();
    await expect(page.locator('.canvas-footer')).toContainText('4 要素');
    await page.getByRole('button', { name: '← 全体へ戻る', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('7 要素');
    await page.getByRole('button', { name: 'DSL を編集' }).click();
    await page
      .getByRole('textbox', { name: 'DSL 入力' })
      .fill('diagram "境界なし" {\nsaas.github github "GitHub"\n}');
    await page.getByRole('button', { name: '解析して反映' }).click();
    await expect(page.locator('.canvas-footer')).toContainText('1 要素');
    await expect(fold).toBeDisabled();
    await expect(expand).toBeDisabled();
  });
  test(`未選択の全体カラー・選択解除・リージョン国旗 (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : 'http://127.0.0.1:5188');
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    const privateLabel = page.locator(
      '.react-flow__node[data-id="private_c"] .resource-text strong',
    );
    await expect(privateLabel).toHaveText('Private AZ-c');
    expect(await privateLabel.evaluate((label) => label.scrollWidth <= label.clientWidth)).toBe(
      true,
    );
    const headingFits = await privateLabel.evaluate((label) => {
      const heading = label.closest('.resource-heading')!;
      const button = heading.querySelector('button')!;
      return label.getBoundingClientRect().right <= button.getBoundingClientRect().left;
    });
    expect(headingFits).toBe(true);
    const clear = page.getByRole('button', { name: '選択を解除', exact: true });
    const api = page.locator('.react-flow__node[data-id="api"]');
    await api.hover();
    await expect(page.locator('.resource-card.muted')).toHaveCount(0);
    expect(
      await page
        .locator('.react-flow__edge-path')
        .evaluateAll((paths) => paths.every((path) => getComputedStyle(path).opacity === '1')),
    ).toBe(true);
    await expect(clear).toBeDisabled();
    await api.click();
    await expect(page.locator('.resource-card.muted').first()).toBeVisible();
    await expect(clear).toBeEnabled();
    const viewport = () => page.locator('.react-flow__viewport').getAttribute('style');
    const before = await viewport();
    await clear.click();
    await expect(page.locator('.resource-card.muted')).toHaveCount(0);
    await expect(clear).toBeDisabled();
    expect(await viewport()).toBe(before);
    const label = page.getByRole('button', { name: /Application Load Balancer → ECS API/ });
    await label.focus();
    await expect(clear).toBeEnabled();
    await clear.click();
    await expect(page.locator('.connection-label[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('.resource-card.muted')).toHaveCount(0);
    await expect(page.locator('.react-flow__node[data-id="tokyo"] .region-flag')).toHaveAttribute(
      'alt',
      '日本の国旗',
    );
    await page.getByRole('button', { name: 'DSL を編集' }).click();
    const longLabel = '東京と名付けた国を特定できない未知のリージョンの非常に長い表示名';
    await page
      .getByRole('textbox', { name: 'DSL 入力' })
      .fill(
        `diagram "リージョン国旗" {\nregion tokyo "東京" region="ap-northeast-1"\nregion virginia "Virginia" region="us-east-1"\nregion google "Google Cloud 東京" region="asia-northeast1"\nregion azure "Azure 東京" region="japaneast"\nregion unknown "${longLabel}" region="unknown"\nregion global "グローバル" region="global"\n}`,
      );
    await page.getByRole('button', { name: '解析して反映' }).click();
    await expect(page.locator('.canvas-footer')).toContainText('6 要素');
    await expect(page.locator('.resource-card .region-flag')).toHaveCount(4);
    await expect(
      page.locator('.react-flow__node[data-id="virginia"] .region-flag'),
    ).toHaveAttribute('alt', 'アメリカ合衆国の国旗');
    await expect(page.locator('.react-flow__node[data-id="unknown"] .region-flag')).toHaveCount(0);
    await page.getByRole('button', { name: `${longLabel}を折りたたむ`, exact: true }).click();
    const longName = page.locator('.react-flow__node[data-id="unknown"] .resource-text strong');
    await expect(longName).toHaveText(longLabel);
    await expect
      .poll(() =>
        longName.evaluate((label) => {
          const card = label.closest('.resource-card')!;
          const hint = card.querySelector('.collapsed-hint')!;
          return (
            label.scrollWidth <= label.clientWidth &&
            label.getBoundingClientRect().bottom < hint.getBoundingClientRect().top
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator('.resource-card .region-flag')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await page.locator('.react-flow__node[data-id="google"]').click();
    await expect(page.locator('.detail-panel .region-flag')).toHaveAttribute(
      'title',
      '日本 · asia-northeast1',
    );
    await clear.click();
    await page.getByRole('button', { name: 'DSL を編集' }).click();
    await page.screenshot({ path: `artifacts/regions-${offline ? 'offline' : 'dev'}.png` });
    if (offline) {
      expect(requests).toEqual([]);
      expect(readFileSync('artifacts/aws.html', 'utf8')).toContain(
        'Copyright (c) 2013 Panayiotis Lipiridis',
      );
    }
  });
  test(`横ホイールでパンし、接続ラベルをマウス・キーボードで選択する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/saas.html') : 'http://127.0.0.1:5188');
    if (!offline) await page.locator('input[type=file]').setInputFiles('examples/saas.infra');
    await expect(page.locator('.canvas-footer')).toContainText('9 要素');
    const viewport = () =>
      page.locator('.react-flow__viewport').evaluate(async (element) => {
        for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return { x: matrix.e, y: matrix.f, zoom: matrix.a };
      });
    const initial = await viewport();
    await page.mouse.move(400, 300);
    await page.mouse.wheel(120, 0);
    const right = await viewport();
    expect(right.zoom).toBe(initial.zoom);
    expect(right.y).toBe(initial.y);
    expect(right.x).toBeCloseTo(initial.x - 120, 2);
    await page.mouse.wheel(-120, 0);
    expect((await viewport()).x).toBeCloseTo(initial.x, 2);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 80);
    await page.keyboard.up('Shift');
    const shift = await viewport();
    expect(shift.x).toBeCloseTo(initial.x - 80, 2);
    expect(shift.zoom).toBe(initial.zoom);
    await page.mouse.wheel(0, 100);
    expect((await viewport()).zoom).toBeLessThan(initial.zoom);
    await page.getByRole('button', { name: 'Fit View' }).click();
    const label = page.getByRole('button', {
      name: 'Fly.io → Neon: 通信 · postgres · 5432',
      exact: true,
    });
    await label.click();
    await expect(label).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.detail-panel')).toContainText('postgres');
    await expect(page.locator('.detail-panel')).toContainText('5432');
    await expect(page.locator('.react-flow__node[data-id="app"] .related')).toHaveCount(1);
    await expect(page.locator('.react-flow__node[data-id="database"] .related')).toHaveCount(1);
    const deployment = page.getByRole('button', { name: 'GitHub → Fly.io: デプロイ', exact: true });
    await deployment.focus();
    await expect(deployment).toBeFocused();
    await deployment.press('Enter');
    await expect(page.locator('.detail-panel h2')).toHaveText('デプロイ');
    await deployment.press('Space');
    await expect(deployment).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: `artifacts/connection-${offline ? 'offline' : 'dev'}.png` });
    await page.getByRole('button', { name: 'DSL を編集' }).click();
    await page
      .getByRole('textbox', { name: 'DSL 入力' })
      .fill(
        'diagram "集約接続" {\ngroup sources "送信元" {\naws.lambda a "A"\naws.lambda b "B"\n}\naws.rds target "接続先"\na -> target kind=traffic protocol=tcp port=5432\nb -> target kind=traffic protocol=tcp port=5432\n}',
      );
    await page.getByRole('button', { name: '解析して反映' }).click();
    await page.getByRole('button', { name: '送信元を折りたたむ', exact: true }).click();
    const aggregated = page.getByRole('button', {
      name: '送信元 → 接続先: 通信 · tcp · 5432',
      exact: true,
    });
    await aggregated.click();
    await expect(page.locator('.detail-panel')).toContainText('元の接続 2');
    await expect(page.locator('.detail-panel')).toContainText('a → target');
    await expect(page.locator('.detail-panel')).toContainText('b → target');
  });
  test(`主要43サービスのアイコンが読み込める (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    if (offline) await context.setOffline(true);
    await page.goto(
      offline ? 'file://' + resolve('artifacts/service-catalog.html') : 'http://127.0.0.1:5188',
    );
    if (!offline)
      await page.locator('input[type=file]').setInputFiles('examples/service-catalog.infra');
    await expect(page.locator('.canvas-footer')).toContainText('43 要素');
    const images = page.locator('.service-icon');
    await expect(images).toHaveCount(43);
    await expect
      .poll(() =>
        images.evaluateAll((images) =>
          images.every((element) => {
            const image = element as HTMLImageElement;
            return image.complete && image.naturalWidth > 0;
          }),
        ),
      )
      .toBe(true);
    await expect(page.locator('.fallback-icon')).toHaveCount(0);
    if (offline) expect(requests).toEqual([]);
  });
}
for (const offline of [false, true]) {
  test(`SaaS の9アイコン・別名・未知の種別を表示する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/saas.html') : 'http://127.0.0.1:5188');
    if (!offline) await page.locator('input[type=file]').setInputFiles('examples/saas.infra');
    await expect(page.locator('.canvas-footer')).toContainText('9 要素');
    const icons = page.locator('.react-flow__node .service-icon');
    await expect(icons).toHaveCount(9);
    await expect
      .poll(() =>
        icons.evaluateAll((images) =>
          images.every((element) => {
            const image = element as HTMLImageElement;
            return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
          }),
        ),
      )
      .toBe(true);
    await expect(page.locator('.react-flow__node[data-id="app"] a').first()).toHaveAttribute(
      'href',
      'https://fly.io',
    );
    if (offline) {
      expect(
        await icons.evaluateAll((images) =>
          images.every((image) => image.getAttribute('src')?.startsWith('data:image/svg+xml')),
        ),
      ).toBe(true);
      expect(requests).toEqual([]);
    }
    await page.getByRole('button', { name: 'Fit View' }).click();
    await page.screenshot({ path: `artifacts/saas-${offline ? 'offline' : 'dev'}.png` });
    await page.getByRole('button', { name: 'DSL を編集' }).click();
    await page
      .getByRole('textbox', { name: 'DSL 入力' })
      .fill(
        readFileSync('examples/saas.infra', 'utf8').replace(
          /}\s*$/,
          'github.actions actions "GitHub Actions"\ngitlab.ci ci "GitLab CI"\nsaas.unknown unknown "未対応サービス"\n}',
        ),
      );
    await page.getByRole('button', { name: '解析して反映' }).click();
    await expect(page.locator('.canvas-footer')).toContainText('12 要素');
    await expect(icons).toHaveCount(11);
    await expect(page.locator('.react-flow__node[data-id="unknown"] .fallback-icon')).toHaveCount(
      1,
    );
    await expect(page.locator('.react-flow__node[data-id="unknown"] .resource-type')).toHaveText(
      'saas.unknown',
    );
  });
}
for (const offline of [false, true]) {
  test(`境界の展開と折りたたみでパンとズームを維持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : 'http://127.0.0.1:5188');
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    await page.getByRole('textbox', { name: 'リソース検索' }).fill('Public AZ-a');
    await page.getByRole('button', { name: 'Public AZ-a subnet · public_a' }).click();
    const viewport = async () =>
      page.locator('.react-flow__viewport').evaluate(async (element) => {
        // 検索移動・遅延 fitView のアニメーションが完了するまで観測する。
        for (let frame = 0; frame < 35; frame++) await new Promise(requestAnimationFrame);
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return { x: matrix.e, y: matrix.f, zoom: matrix.a };
      });
    const searched = await viewport();
    await page.getByRole('button', { name: 'Zoom Out' }).click();
    const zoomed = await viewport();
    expect(zoomed.zoom).toBeLessThan(searched.zoom);
    await page.mouse.move(550, 400);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(610, 450, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    const panned = await viewport();
    expect(panned.x).not.toBe(zoomed.x);
    expect(panned.y).not.toBe(zoomed.y);
    await page.getByRole('button', { name: 'Public AZ-aを展開', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Public AZ-aを折りたたむ', exact: true }),
    ).toBeVisible();
    expect(await viewport()).toEqual(panned);
    await page.getByRole('button', { name: 'Public AZ-aを折りたたむ', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Public AZ-aを展開', exact: true }),
    ).toBeVisible();
    expect(await viewport()).toEqual(panned);
    await page.getByRole('button', { name: 'Fit View' }).click();
    expect((await viewport()).zoom).toBeLessThan(panned.zoom);
  });
}
test('表示切替・集約復元・検索・強調・ドリルダウン', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5188');
  await expect(page.locator('.canvas-footer')).toContainText('19 要素');
  await expect(page.locator('.react-flow__minimap-node')).toHaveCount(19);
  await page.getByRole('button', { name: '概要', exact: true }).click();
  await expect(page.locator('.canvas-footer')).toContainText('5 要素');
  await page.getByRole('button', { name: '本番アカウントを展開', exact: true }).click();
  await expect(page.locator('.canvas-footer')).not.toContainText('5 要素');
  await page.getByRole('button', { name: 'セキュリティ', exact: true }).click();
  await expect(page.locator('.canvas-footer')).toContainText('22 要素');
  await page.getByRole('button', { name: '本番 VPCを折りたたむ', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="api"]')).toHaveCount(0);
  await page.getByRole('button', { name: '本番 VPCを展開', exact: true }).click();
  await expect(page.locator('.canvas-footer')).toContainText('22 要素');
  await page.getByRole('textbox', { name: 'リソース検索' }).fill('ECS API');
  await page.getByRole('button', { name: 'ECS API aws.ecs · api' }).click();
  await expect(page.locator('.detail-panel h2')).toHaveText('ECS API');
  await expect(page.locator('.react-flow__node[data-id="api"]')).toHaveClass(/selected/);
  await expect(page.locator('.detail-panel')).toContainText('private_a, private_c');
  await expect(page.locator('.react-flow__node[data-id="api"] .related')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'リソース検索' }).fill('本番 VPC');
  await page.getByRole('button', { name: '本番 VPC vpc · main' }).click();
  await page.getByRole('button', { name: '詳細へ移動', exact: true }).click();
  await expect(page.getByRole('button', { name: '← 全体へ戻る' })).toBeVisible();
  await expect(page.locator('.canvas-footer')).toContainText('11 要素');
  await page.getByRole('button', { name: '← 全体へ戻る' }).click();
  await expect(page.locator('.canvas-footer')).toContainText('22 要素');
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.screenshot({ path: 'artifacts/aws-security.png' });
  expect(errors).toEqual([]);
});
test('任意 DSL と取り込みモデルが図へ反映され、エラー時は図を保つ', async ({ page }) => {
  await page.goto('http://127.0.0.1:5188');
  await page.getByRole('button', { name: 'DSL を編集' }).click();
  const editor = page.getByRole('textbox', { name: 'DSL 入力' });
  await editor.fill(
    'diagram "入力反映" {\naws.lambda x "独自 API"\nexternal.service y "依存先"\nx -> y kind=auth\n}',
  );
  await page.getByRole('button', { name: '解析して反映' }).click();
  await expect(page.locator('.canvas-footer')).toContainText('2 要素');
  await expect(page.locator('.document-title')).toHaveText('入力反映');
  await editor.fill('diagram "invalid" {\naws.lambda x subnets=[missing]\n}');
  await page.getByRole('button', { name: '解析して反映' }).click();
  await expect(page.getByRole('alert')).toContainText('missing');
  await expect(page.locator('.document-title')).toHaveText('入力反映');
  await page.locator('input[type=file]').setInputFiles('artifacts/terraform-model.json');
  await expect(page.locator('.document-title')).toHaveText('Terraform infrastructure');
  await expect(editor).toContainText('sourceKind="plan"');
  await page
    .getByRole('textbox', { name: 'リソース検索' })
    .fill('module.network.aws_subnet.private');
  await page.locator('.search-results button').first().click();
  await expect(page.locator('.detail-panel')).toContainText('modules/network/main.tf');
  await expect(page.locator('.detail-panel')).toContainText('plan');
});
test('単一 HTML は file URL でネットワークなしに操作できる', async ({ page, context }) => {
  await context.setOffline(true);
  const requests: string[] = [];
  page.on('request', (req) => {
    if (/^https?:/.test(req.url())) requests.push(req.url());
  });
  await page.goto('file://' + resolve('artifacts/aws.html'));
  await expect(page.locator('.canvas-footer')).toContainText('19 要素');
  await page.getByRole('button', { name: '概要', exact: true }).click();
  await expect(page.locator('.canvas-footer')).toContainText('5 要素');
  await page.getByRole('textbox', { name: 'リソース検索' }).fill('PostgreSQL');
  await page.locator('.search-results button').click();
  await expect(page.locator('.detail-panel h2')).toHaveText('PostgreSQL');
  await expect(page.locator('.react-flow__node[data-id="db"]')).toBeVisible();
  await page.screenshot({ path: 'artifacts/offline-html.png' });
  expect(requests).toEqual([]);
});
test('大規模・GCP Azure・複数クラウドの入力が実際に描画される', async ({ page }) => {
  await page.goto('http://127.0.0.1:5188');
  await page.locator('input[type=file]').setInputFiles('examples/gcp-azure.infra');
  await expect(page.locator('.document-title')).toContainText('Google Cloud');
  await expect(page.locator('.canvas-footer')).toContainText('12 要素');
  await page.getByRole('button', { name: 'ネットワーク', exact: true }).click();
  await page.screenshot({ path: 'artifacts/gcp-azure.png' });
  await page.locator('input[type=file]').setInputFiles('examples/multicloud.infra');
  await expect(page.locator('.canvas-footer')).toContainText('13 要素');
  await page.locator('input[type=file]').setInputFiles('examples/large.infra');
  await expect(page.locator('.canvas-footer')).toContainText('318 要素');
  await page.getByRole('textbox', { name: 'リソース検索' }).fill('service_299');
  await expect(page.locator('.search-results button')).toHaveCount(1);
  await page.locator('.search-results button').click();
  await expect(page.locator('.detail-panel h2')).toBeVisible();
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.screenshot({ path: 'artifacts/large.png' });
});
