import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const offline of [false, true]) {
  test(`IAM Role・境界の選択後も矢印ラベルが前面で操作でき、AWS境界アイコンを表示する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : 'http://127.0.0.1:5188');
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
    for (const [id, name] of [
      ['prod', 'AWS-Account'],
      ['dev', 'AWS-Account'],
      ['tokyo', 'Region'],
    ]) {
      const icon = node(id).locator('.service-icon');
      await expect
        .poll(() => icon.evaluate((e) => (e as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      expect(
        await icon.evaluate(async (e) => (await fetch((e as HTMLImageElement).src)).text()),
      ).toContain(name + '_32');
    }
    await expect(node('tokyo').locator('.resource-label')).toContainText('東京');
    await expect(node('tokyo').locator('.region-flag')).toHaveAttribute('width', '20');
    const label = page.getByRole('button', {
      name: 'デプロイ IAM Role → ECS API: サービス更新',
      exact: true,
    });
    const inFront = () =>
      label.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return top === element || (top !== null && element.contains(top));
      });
    for (const shape of ['orthogonal', 'bezier']) {
      await page.getByRole('combobox', { name: '矢印の形状' }).selectOption(shape);
      for (const id of ['deploy_role', 'prod', 'tokyo']) {
        await node(id).locator('.resource-label').click();
        await expect(page.locator('.detail-panel > h2')).toHaveText(
          id === 'deploy_role' ? 'デプロイ IAM Role' : id === 'prod' ? '本番アカウント' : '東京',
        );
        await expect.poll(inFront).toBe(true);
        await label.click();
        await expect(label).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(inFront).toBe(true);
        await page.getByRole('button', { name: '選択を解除', exact: true }).click();
        await label.focus();
        await expect(label).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(inFront).toBe(true);
      }
    }
    // 固定の z-index に戻すと、深い入れ子で再発することも検証する。
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const groups = Array.from({ length: 20 }, (_, i) => `group nested_${i} "階層${i}" {`).join(
      '\n',
    );
    await page
      .getByRole('textbox', { name: 'DSL 入力' })
      .fill(
        `diagram "深い入れ子" {\n${groups}\naws.iam deploy_role "デプロイ IAM Role"\n${'}\n'.repeat(20)}aws.ecs api "ECS API"\ndeploy_role -> api kind=deploy label="サービス更新"\n}`,
      );
    await page.getByRole('button', { name: '解析して反映', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('22 要素');
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await node('deploy_role').locator('.resource-label').click();
    await expect.poll(inFront).toBe(true);
    await label.click();
    await expect(label).toHaveAttribute('aria-pressed', 'true');
  });
  test(`Datadog・New Relicへの送信種類と公式アイコンを表示する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline ? 'file://' + resolve('artifacts/observability.html') : 'http://127.0.0.1:5188',
    );
    if (!offline)
      await page.locator('input[type=file]').setInputFiles('examples/observability.infra');
    await expect(page.locator('.canvas-footer')).toContainText('5 要素 ·  4 接続');
    for (const id of ['datadog', 'newrelic']) {
      const icon = page.locator(`.react-flow__node[data-id="${id}"] .service-icon`);
      await expect(icon).toHaveCount(1);
      await expect
        .poll(() => icon.evaluate((e) => (e as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
    }
    const metric = page.getByRole('button', {
      name: 'OpenTelemetry Collector → Datadog: 通信 · メトリクス · https · 443',
      exact: true,
    });
    const logs = page.getByRole('button', {
      name: 'OpenTelemetry Collector → Datadog: 通信 · ログ · https · 443',
      exact: true,
    });
    await expect(metric).toBeVisible();
    await logs.click();
    await expect(logs).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.detail-panel')).toContainText('送信データログ');
    await metric.focus();
    await expect(metric).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.detail-panel')).toContainText('送信データメトリクス');
    await page.getByRole('combobox', { name: '矢印の形状' }).selectOption('bezier');
    expect(await metric.getAttribute('style')).not.toBe(await logs.getAttribute('style'));
    await logs.click();
    await expect(logs).toHaveAttribute('aria-pressed', 'true');
    await metric.click();
    await expect(metric).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', {
        name: /OpenTelemetry Collector → New Relic: 通信 · メトリクス \/ ログ \/ トレース/,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('4 要素 ·  4 接続');
    await expect(metric).toBeVisible();
    await expect(logs).toBeVisible();
  });
  test(`矢印を曲線へ切り替えても配置・視点・ラベルの選択を保持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : 'http://127.0.0.1:5188');
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    const paths = () =>
      page
        .locator('.react-flow__edge-path')
        .evaluateAll((paths) => paths.map((p) => p.getAttribute('d')));
    const original = await paths();
    const viewport = () =>
      page.locator('.react-flow__viewport').evaluate(async (element) => {
        for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
        return getComputedStyle(element).transform;
      });
    const viewBefore = await viewport();
    const positions = () =>
      page
        .locator('.react-flow__node')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('style')));
    const nodesBefore = await positions();
    const shape = page.getByRole('combobox', { name: '矢印の形状', exact: true });
    await shape.selectOption('bezier');
    await expect.poll(async () => (await paths()).every((p) => p?.includes('C'))).toBe(true);
    expect(await viewport()).toBe(viewBefore);
    expect(await positions()).toEqual(nodesBefore);
    const label = page.getByRole('button', { name: /利用者 → Application Load Balancer/ });
    await label.click();
    await expect(label).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await label.focus();
    await expect(label).toHaveAttribute('aria-pressed', 'true');
    await shape.selectOption('orthogonal');
    await expect.poll(paths).toEqual(original);
    await expect(label).toHaveAttribute('aria-pressed', 'true');
    expect(await viewport()).toBe(viewBefore);
    await shape.selectOption('bezier');
    await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('5 要素');
    await expect.poll(async () => (await paths()).every((p) => p?.includes('C'))).toBe(true);
    await expect(shape).toHaveValue('bezier');
  });
  test(`画面外にある折りたたみ境界を一覧から展開して表示する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : 'http://127.0.0.1:5188');
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    await page.mouse.move(400, 250);
    await page.mouse.wheel(5000, 0);
    await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('5 要素');
    const navigation = page.getByRole('region', { name: '折りたたみ中の境界', exact: true });
    await expect(navigation.getByRole('button')).toHaveCount(2);
    await navigation
      .getByRole('button', { name: '本番アカウントを展開して表示', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: '本番アカウントを折りたたむ', exact: true }),
    ).toBeVisible();
    await expect(
      navigation.getByRole('button', { name: '東京を展開して表示', exact: true }),
    ).toBeVisible();
    await navigation.getByRole('button', { name: '東京を展開して表示', exact: true }).click();
    await expect(
      navigation.getByRole('button', { name: '本番 VPCを展開して表示', exact: true }),
    ).toBeVisible();
    await navigation.getByRole('button', { name: '本番 VPCを展開して表示', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Public AZ-aを展開', exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        page.locator('.react-flow__node[data-id="main"]').evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const canvas = node.closest('.canvas-area')!.getBoundingClientRect();
          return (
            rect.left >= canvas.left &&
            rect.right <= canvas.right &&
            rect.top >= canvas.top &&
            rect.bottom <= canvas.bottom
          );
        }),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'すべて展開する', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    await expect(navigation).toHaveCount(0);
  });
  test(`境界を一括で折りたたみ・展開し、詳細範囲とパン・ズームを維持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(offline ? 'file://' + resolve('artifacts/aws.html') : 'http://127.0.0.1:5188');
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    const boundaryIcon = (id: string) =>
      page.locator(`.react-flow__node[data-id="${id}"] .service-icon`);
    for (const [id, title] of [
      ['main', 'Virtual-private-cloud-VPC'],
      ['public_a', 'Public-subnet'],
      ['private_a', 'Private-subnet'],
    ]) {
      const icon = boundaryIcon(id);
      await expect(icon).toHaveCount(1);
      await expect
        .poll(() => icon.evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      const svg = await icon.evaluate(
        async (element) => await (await fetch((element as HTMLImageElement).src)).text(),
      );
      expect(svg).toContain(title + '_32');
    }
    await page.getByRole('button', { name: 'Public AZ-aを展開', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Public AZ-aを折りたたむ', exact: true }),
    ).toBeVisible();
    await expect(boundaryIcon('public_a')).toHaveCount(1);

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
    // 一括で閉じた境界も、親から順に個別の＋で再展開できる。
    await page.getByRole('button', { name: '西アカウントを展開', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('4 要素');
    await expect(page.getByRole('button', { name: '入れ子を展開', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '入れ子を展開', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('6 要素');
    const controlGap = await page.locator('.react-flow__node[data-id="west"]').evaluate((node) => {
      const label = node.querySelector('.resource-label')!.getBoundingClientRect();
      const button = node.querySelector('.boundary-toggle')!.getBoundingClientRect();
      return (button.left - label.right) / (button.width / 22);
    });
    expect(controlGap).toBeLessThanOrEqual(24);

    await expect(
      page.getByRole('button', { name: 'A → 東アカウント: 通信', exact: true }),
    ).toHaveCount(1);
    await page.getByRole('button', { name: '東アカウントを展開', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('7 要素 ·  2 接続');
    expect(await viewport()).toBe(before);
    await fold.click();
    await expect(page.locator('.canvas-footer')).toContainText('3 要素');
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
    const userNode = page.locator('.react-flow__node[data-id="users"]');
    await expect(userNode.locator('.service-icon')).toHaveCount(1);
    await expect(userNode.locator('.fallback-icon')).toHaveCount(0);
    await expect
      .poll(() =>
        userNode.locator('.service-icon').evaluate((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth > 0;
        }),
      )
      .toBe(true);
    await userNode.click();
    await expect(page.locator('.detail-panel > h2')).toHaveText('利用者');
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
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
    const tokyoName = page.locator('.react-flow__node[data-id="tokyo"] .resource-label');
    await expect(tokyoName.locator('strong')).toHaveText('東京');
    await expect(tokyoName.locator('.region-flag')).toHaveAttribute('width', '20');
    await expect(tokyoName.locator('.region-flag')).toHaveAttribute('height', '15');
    const flagBesideName = (container: Element) => {
      const flag = container.querySelector('.region-flag')!;
      const label = container.querySelector('strong, span')!;
      const f = flag.getBoundingClientRect(),
        l = label.getBoundingClientRect();
      return (
        getComputedStyle(flag).width === '20px' &&
        getComputedStyle(flag).height === '15px' &&
        f.right <= l.left &&
        l.left - f.right < f.width &&
        f.top < l.bottom &&
        l.top < f.bottom &&
        label.scrollWidth <= label.clientWidth
      );
    };
    await expect.poll(() => tokyoName.evaluate(flagBesideName)).toBe(true);
    await page.getByRole('button', { name: '東京を折りたたむ', exact: true }).click();
    await expect(tokyoName.locator('strong')).toHaveText('東京');
    await expect.poll(() => tokyoName.evaluate(flagBesideName)).toBe(true);
    await page.getByRole('button', { name: '東京を展開', exact: true }).click();
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
    await expect(page.locator('.detail-panel > h2')).toHaveText('Google Cloud 東京');
    await expect
      .poll(() => page.locator('.detail-panel > h2 .resource-label').evaluate(flagBesideName))
      .toBe(true);
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
    await expect(page.locator('.detail-panel > h2')).toHaveText('デプロイ');
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
  test(`主要59サービスのアイコンとブランドカラーを表示する (${offline ? 'HTML' : '開発画面'})`, async ({
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
    await expect(page.locator('.canvas-footer')).toContainText('59 要素');
    const images = page.locator('.service-icon');
    await expect(images).toHaveCount(59);
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
    const brandColors = (
      JSON.parse(readFileSync('src/assets/manifest.json', 'utf8')) as {
        type: string;
        brandColor?: string;
      }[]
    )
      .filter((icon) => icon.brandColor)
      .map((icon) => ({ type: icon.type, color: icon.brandColor! }));
    const renderedColors = await images.evaluateAll(
      (elements, brands) =>
        brands.map((brand) => {
          const image = elements.find(
            (element) =>
              element
                .closest('.resource-card')
                ?.querySelector('.resource-type')
                ?.textContent?.trim() === brand.type,
          ) as HTMLImageElement;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 48;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0, 48, 48);
          const pixels = context.getImageData(0, 0, 48, 48).data;
          const rgb = [1, 3, 5].map((offset) =>
            Number.parseInt(brand.color.slice(offset, offset + 2), 16),
          );
          let matching = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (
              pixels[i + 3] > 240 &&
              rgb.every((channel, index) => Math.abs(pixels[i + index] - channel) <= 2)
            )
              matching++;
          return { type: brand.type, matches: matching > 10 };
        }),
      brandColors,
    );
    expect(renderedColors).toHaveLength(53);
    expect(renderedColors.filter((brand) => !brand.matches)).toEqual([]);
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
  await expect(page.locator('.detail-panel > h2')).toHaveText('ECS API');
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
  await expect(page.locator('.detail-panel > h2')).toHaveText('PostgreSQL');
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
  await expect(page.locator('.detail-panel > h2')).toBeVisible();
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.screenshot({ path: 'artifacts/large.png' });
});

for (const offline of [false, true]) {
  test(`ECS・Beanstalk の詳細種別・公式アイコン・境界集約を表示する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline ? 'file://' + resolve('artifacts/ecs-beanstalk.html') : 'http://127.0.0.1:5188',
    );
    if (!offline)
      await page.locator('input[type=file]').setInputFiles('examples/ecs-beanstalk.infra');
    await expect(page.locator('.document-title')).toHaveText('ECS と Elastic Beanstalk の詳細構成');
    await expect(page.locator('.service-icon')).toHaveCount(17);
    await expect
      .poll(() =>
        page
          .locator('.service-icon')
          .evaluateAll((images) =>
            images.every(
              (element) =>
                (element as HTMLImageElement).complete &&
                (element as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
    await expect(node('cluster').locator('.resource-metadata')).toContainText(
      'FARGATE / FARGATE_SPOT',
    );
    await expect(node('definition').locator('.resource-metadata')).toContainText(
      '512 units (0.5 vCPU)',
    );
    await expect(node('definition').locator('.resource-metadata')).toContainText(
      '1024 MiB (1 GiB)',
    );
    await expect(node('service').locator('.resource-metadata')).toContainText('FARGATE');
    await expect(node('service').locator('.resource-metadata')).toContainText('希望タスク数2');
    await expect
      .poll(() =>
        page
          .locator('.detail-boundary-card .resource-text strong')
          .evaluateAll((labels) =>
            labels.every((label) => label.scrollWidth <= label.clientWidth + 1),
          ),
      )
      .toBe(true);

    await page.getByRole('button', { name: 'ECS クラスターを折りたたむ', exact: true }).click();
    await expect(node('task_a')).toHaveCount(0);
    await expect(node('definition')).toHaveCount(1);
    await expect(node('cluster').locator('.resource-metadata')).toContainText(
      'FARGATE / FARGATE_SPOT',
    );
    await page.getByRole('button', { name: 'ECS クラスターを展開', exact: true }).click();
    await expect(node('task_a')).toHaveCount(1);
    await expect(node('service').locator('.resource-type')).toHaveText('aws.ecs-service');
    await page
      .getByRole('button', { name: 'Web 環境（Standard・設計例）を折りたたむ', exact: true })
      .click();
    await expect(node('instance')).toHaveCount(0);
    await expect(node('worker_instance')).toHaveCount(1);
    await page
      .getByRole('button', { name: 'Web 環境（Standard・設計例）を展開', exact: true })
      .click();
    await expect(node('instance')).toHaveCount(1);
    await page.getByRole('button', { name: 'Fit View' }).click();
    await page.screenshot({ path: `artifacts/ecs-beanstalk-${offline ? 'offline' : 'dev'}.png` });
  });
}

for (const offline of [false, true]) {
  test(`TGW・RAM・Google HA VPN の跨る共有とトンネルを表示・集約する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline ? 'file://' + resolve('artifacts/transit-vpn.html') : 'http://127.0.0.1:5188',
    );
    if (!offline)
      await page.locator('input[type=file]').setInputFiles('examples/transit-vpn.infra');
    await expect(page.locator('.canvas-footer')).toContainText('28 要素');
    await expect(page.locator('.service-icon')).toHaveCount(24);
    await expect(
      page.locator('.react-flow__node[data-id="prod_subnet"] .fallback-icon'),
    ).toHaveCount(1);
    await expect(
      page.locator('.react-flow__node[data-id="google_vpc"] .fallback-icon'),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        page
          .locator('.service-icon')
          .evaluateAll((images) =>
            images.every(
              (element) =>
                (element as HTMLImageElement).complete &&
                (element as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await page.getByRole('button', { name: '概要', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('4 要素');
    await page.getByRole('button', { name: 'すべて展開する', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('28 要素');
    await page.getByRole('textbox', { name: 'リソース検索' }).fill('共有 Transit Gateway');
    await page.locator('.search-results button').click();
    await expect(page.locator('.detail-panel > h2')).toHaveText('共有 Transit Gateway');
    await expect(page.locator('.react-flow__node[data-id="prod_attachment"]')).toHaveCount(1);
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await page.getByRole('button', { name: 'Fit View' }).click();
    await page.screenshot({ path: `artifacts/transit-vpn-${offline ? 'offline' : 'dev'}.png` });
  });
}

for (const offline of [false, true]) {
  test(`OrganizationsのOU/accountを展開・集約してポリシーを選択する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline ? 'file://' + resolve('artifacts/organizations.html') : 'http://127.0.0.1:5188',
    );
    if (!offline)
      await page.locator('input[type=file]').setInputFiles('examples/organizations.infra');
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    await expect(page.locator('.react-flow__node[data-id="prod"]')).toBeVisible();
    await expect(page.locator('.react-flow__node[data-id="workloads"]')).toBeVisible();
    await page.locator('.react-flow__node[data-id="workloads"] .boundary-toggle').click();
    await expect(page.locator('.react-flow__node[data-id="prod"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'すべて展開する', exact: true }).click();
    await expect(page.locator('.react-flow__node[data-id="prod"]')).toBeVisible();
    await page.getByRole('textbox', { name: 'リソース検索' }).fill('ワークロード向け SCP');
    await page.locator('.search-results button').click();
    await expect(page.locator('.detail-panel > h2')).toHaveText('ワークロード向け SCP');
    await expect(page.locator('.detail-panel')).toContainText('SERVICE_CONTROL_POLICY');
    await expect
      .poll(() =>
        page
          .locator('.service-icon')
          .evaluateAll((images) =>
            images.every(
              (e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await page.getByRole('button', { name: 'Fit View' }).click();
    await page.screenshot({ path: `artifacts/organizations-${offline ? 'offline' : 'dev'}.png` });
  });
}

for (const reference of [
  'aws-web',
  'gcp-delivery',
  'azure-private-link',
  'classmethod-websocket',
  'serverworks-inspection',
]) {
  test(`公開構成図 ${reference}: オフラインHTMLと折りたたみ後の導線`, async ({ page, context }) => {
    const output = `artifacts/reference-${reference}.html`;
    execFileSync(process.execPath, [
      'dist/cli.js',
      'html',
      `examples/reference/${reference}.infra`,
      '--out',
      output,
    ]);
    await context.setOffline(true);
    await page.goto('file://' + resolve(output));
    await expect(page.locator('.canvas-footer')).toContainText('要素');
    await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
    for (const content of await page.locator('.resource-content').all()) {
      const bounds = await content.evaluate((el) => {
        const c = el.getBoundingClientRect();
        const p = el.closest('.resource-card')!.getBoundingClientRect();
        return {
          bottom: c.bottom,
          parent: p.bottom,
          width: el.clientWidth,
          scroll: el.scrollWidth,
        };
      });
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.parent + 1);
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
    }
    if (reference === 'serverworks-inspection') {
      await expect(page.getByRole('table', { name: 'Inspection TGW routes' })).toContainText(
        '10.100.6.0/24',
      );
      await page.getByRole('table', { name: 'Inspection TGW routes' }).click();
      await expect(page.locator('.detail-panel')).toContainText('Inspection TGW routes');
    }
    await page.screenshot({ path: `artifacts/reference-${reference}.png`, fullPage: true });
    await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
    await page.getByRole('button', { name: 'Fit View' }).click();
    const expand = page.locator('.boundary-toggle').filter({ hasText: '+' }).first();
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(page.locator('.boundary-toggle').filter({ hasText: '−' }).first()).toBeVisible();
  });
}

test('表・リストの長文を折り返し、HTMLを実行せず表示する', async ({ page }) => {
  await page.goto('http://127.0.0.1:5188');
  await page.getByRole('button', { name: 'DSL を編集' }).click();
  const long = '長い設定値の日本語と英数字abcdefghijklmnopqrstuvwxyzを表示します。'.repeat(5);
  const literal = '<img src=x onerror=alert(1)>';
  const source = `diagram "表とリスト" {\ncustom.node table "長文の表" display=table columns=["見出し", "Value"] rows=[${JSON.stringify(long)}, ${JSON.stringify(literal)}]\ncustom.node list "長文のリスト" display=list items=[${JSON.stringify(long)}, ${JSON.stringify(literal)}]\n}`;
  await page.getByRole('textbox', { name: 'DSL 入力' }).fill(source);
  await page.getByRole('button', { name: '解析して反映' }).click();
  await page.getByRole('button', { name: 'DSL を編集' }).click();
  await expect(page.locator('.canvas-footer')).toContainText('2 要素');
  await expect(page.getByRole('table', { name: '長文の表' })).toContainText(literal);
  await expect(page.locator('.resource-list')).toContainText(literal);
  await expect(page.locator('.resource-content img')).toHaveCount(0);
  for (const content of await page.locator('.resource-content').all()) {
    expect(
      await content.evaluate(
        (el) =>
          el.getBoundingClientRect().bottom <=
          el.closest('.resource-card')!.getBoundingClientRect().bottom + 1,
      ),
    ).toBe(true);
    expect(await content.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: 'artifacts/reference-content.png' });
});

for (const offline of [false, true]) {
  test(`アカウント・リージョン・AZを名前と並べ、展開・折りたたみでも識別情報を保持 (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    const output = 'artifacts/identity.html';
    if (offline) {
      await context.setOffline(true);
      await page.goto('file://' + resolve(output));
    } else {
      await page.goto('http://127.0.0.1:5188');
      await page.locator('input[type=file]').setInputFiles('examples/identity.infra');
    }
    await expect(page.locator('.document-title')).toHaveText(
      'アカウント・リージョン・AZの識別情報',
    );
    const meta = (id: string) =>
      page.locator(`.react-flow__node[data-id="${id}"] .resource-metadata`);
    await expect(meta('prod')).toContainText('012345678901');
    await expect(meta('tokyo')).toContainText('ap-northeast-1');
    await expect(page.locator('.react-flow__node[data-id="tokyo"] .resource-label')).toContainText(
      '東京',
    );
    await expect(meta('private_a')).toContainText('ap-northeast-1a');
    await expect(meta('private_a')).toContainText('apne1-az1');
    await expect(meta('google')).toContainText('demo-project');
    await expect(meta('azure')).toContainText('00000000-0000-0000-0000-000000000001');
    for (const el of await page.locator('.resource-metadata').all()) {
      expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      expect(
        await el.evaluate(
          (e) =>
            e.getBoundingClientRect().bottom <
            e.closest('.resource-card')!.getBoundingClientRect().bottom,
        ),
      ).toBe(true);
    }
    const parent = page.locator('.react-flow__node[data-id="tokyo"]');
    const child = page.locator('.react-flow__node[data-id="main"]');
    expect(await meta('tokyo').evaluate((e) => e.getBoundingClientRect().bottom)).toBeLessThan(
      (await child.boundingBox())!.y,
    );
    await page.getByRole('textbox', { name: 'リソース検索' }).fill('アプリ Subnet');
    await page.locator('.search-results button').first().click();
    await page.getByRole('button', { name: 'アプリ Subnetを展開', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'アプリ Subnetを折りたたむ', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'アプリ Subnetを折りたたむ', exact: true }).click();
    await expect(
      page.locator('.react-flow__node[data-id="private_a"] .collapsed-hint'),
    ).toBeVisible();
    await expect(meta('private_a')).toContainText('apne1-az1');
    expect(
      await meta('private_a').evaluate(
        (e) =>
          e.getBoundingClientRect().bottom <=
          e.closest('.resource-card')!.querySelector('.collapsed-hint')!.getBoundingClientRect()
            .top,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'アプリ Subnetを展開', exact: true }).click();
    await expect(meta('private_a')).toContainText('ap-northeast-1a');
    await page.getByRole('button', { name: '概要', exact: true }).click();
    await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
    await expect(meta('prod')).toContainText('012345678901');
    await expect(parent).toHaveCount(0);
    await page.getByRole('textbox', { name: 'リソース検索' }).fill('本番アカウント');
    await page.locator('.search-results button').first().click();
    await expect
      .poll(() => meta('prod').evaluate((e) => e.getBoundingClientRect().width))
      .toBeGreaterThan(200);
    await expect(page.getByText('構成を配置しています…', { exact: true })).toBeHidden();
    await expect
      .poll(() =>
        meta('prod').evaluate((e) => {
          const rect = e.getBoundingClientRect();
          return rect.y > 180 && rect.y < 600;
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `artifacts/identity-${offline ? 'offline' : 'live'}.png` });
  });
}
