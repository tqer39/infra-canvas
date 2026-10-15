import { toggleArrowShape, toggleMembership } from './display-controls';
import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const offline of [false, true])
  test(`P2/P3の表示・注釈・集合の復元・SVG/PNG/PDF出力 (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.addInitScript(() => {
      window.print = () => {
        (window as Window & { printed?: boolean }).printed = true;
      };
    });
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/expressions.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    if (!offline)
      await page
        .getByRole('combobox', { name: 'サンプル', exact: true })
        .selectOption('expressions');
    await expect(page.locator('.canvas-footer')).toContainText('9 接続');
    await expect(page.locator('[data-note-id]')).toHaveCount(2);
    await expect(page.locator('[data-id="api_a"]')).toContainText('非公開');
    await expect(page.locator('[data-id="api_a"]')).toContainText('観測');
    await expect(page.locator('[data-id="api"]')).toContainText('×2–6');
    await expect(page.locator('[data-id="api_c"] [data-change]')).toHaveAttribute(
      'data-change',
      'add',
    );
    await expect(page.locator('[data-id="database"] [data-appearance]')).toHaveAttribute(
      'data-appearance',
      'database',
    );
    await expect(page.locator('[data-id="office"]')).toContainText('社内拠点');
    await page.getByRole('button', { name: 'AZ A / API 実体を折りたたむ', exact: true }).click();
    await expect(page.locator('[data-id="api_a"]')).toHaveCount(0);
    await expect(page.locator('[data-id="az_a"]')).toContainText('×2');
    await page.getByRole('button', { name: 'AZ A / API 実体を展開', exact: true }).click();
    await expect(page.locator('[data-id="api_a"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'ダウンロード・印刷', exact: true }).click();
    const svgDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'SVG をダウンロード', exact: true }).click();
    const svg = readFileSync((await (await svgDownload).path())!, 'utf8');
    expect(svg).toContain('data-note-id="rollout"');
    expect(svg).toContain('台数');
    expect(svg).not.toContain('foreignObject');
    await page.getByRole('combobox', { name: '縮尺', exact: true }).selectOption('0.5');
    const pngDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PNG をダウンロード', exact: true }).click();
    const png = readFileSync((await (await pngDownload).path())!);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await page.getByRole('combobox', { name: '用紙', exact: true }).selectOption('A3');
    await page.getByRole('combobox', { name: '印刷方式', exact: true }).selectOption('tile');
    await page.getByRole('combobox', { name: '縮尺', exact: true }).selectOption('2');
    const popupEvent = page.waitForEvent('popup');
    await page.getByRole('button', { name: '印刷 / PDF を保存', exact: true }).click();
    const popup = await popupEvent;
    await expect(popup.locator('.sheet')).not.toHaveCount(1);
    await expect
      .poll(() => popup.evaluate(() => (window as Window & { printed?: boolean }).printed))
      .toBe(true);
    expect(await popup.locator('style').textContent()).toContain('size:A3 landscape');
    await popup.close();
    await expect(page.locator('.diagnostics')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(readFileSync('artifacts/expressions-cli.pdf').subarray(0, 5).toString()).toBe('%PDF-');
    if (!offline) {
      await page.getByRole('button', { name: 'ダウンロード・印刷', exact: true }).click();
      await page.screenshot({ path: 'artifacts/expressions-viewer.png' });
    }
  });
test('信頼境界のラベルはズーム・折りたたみ後も見出しや他のラベルと重ならない', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('combobox', { name: 'サンプル', exact: true }).selectOption('architecture');
  await expect(page.locator('.membership-overlay')).toHaveCount(0);
  await toggleMembership(page);
  await expect(page.locator('.membership-overlay')).toHaveCount(2);
  for (const fold of [false, true]) {
    if (fold) await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
    await expect(page.locator('.layout-status')).toHaveCount(0);
    const rectangles = await page
      .locator('.membership-overlay > span, .resource-heading')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const r = element.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            label: element.closest('.membership-overlay') !== null,
          };
        }),
      );
    for (const [index, box] of rectangles.entries()) {
      if (!box.label) continue;
      for (const [j, other] of rectangles.entries()) {
        if (j === index) continue;
        expect(
          box.x + box.width <= other.x ||
            box.x >= other.x + other.width ||
            box.y + box.height <= other.y ||
            box.y >= other.y + other.height,
        ).toBe(true);
      }
    }
  }
  await page.getByRole('button', { name: 'すべて展開する', exact: true }).click();
  await expect(page.locator('.layout-status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click();
  await page.screenshot({ path: 'artifacts/trust-boundary-fixed.png' });
});

test('曲線や跨る囲みの背後のノードをクリックでき、AWSアイコンを設定・保存できる', async ({
  page,
}) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  const source = `diagram "hit testing" {
    account prod "本番" provider=aws {
      external.node a x=24 y=100 fixed=true
      external.node b x=900 y=100 fixed=true
      external.node db "背後のDB" x=450 y=100 fixed=true
    }
    overlay crossed "跨る囲み" members=[a,b]
    a -> b
  }`;
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'hit.infra', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.locator('.layout-status')).toHaveCount(0);
  await expect(page.locator('[data-id="prod"] .resource-type')).toHaveText('AWS アカウント');
  await expect(page.locator('[data-id="prod"] .service-icon')).toHaveCount(1);
  await toggleArrowShape(page);
  await toggleMembership(page);
  const crossesCard = await page.locator('.react-flow__edge-path').evaluateAll((paths) => {
    const rectangles = ['a', 'b', 'db'].map((id) =>
      document.querySelector(`[data-id="${id}"] .resource-card`)!.getBoundingClientRect(),
    );
    return paths.some((element) => {
      const path = element as SVGPathElement;
      const matrix = path.getScreenCTM()!;
      const length = path.getTotalLength();
      for (let t = 0; t <= length; t += 2) {
        const p = path.getPointAtLength(t).matrixTransform(matrix);
        if (
          rectangles.some(
            (rect) =>
              p.x > rect.left + 2 &&
              p.x < rect.right - 2 &&
              p.y > rect.top + 2 &&
              p.y < rect.bottom - 2,
          )
        )
          return true;
      }
      return false;
    });
  });
  expect(crossesCard).toBe(false);
  await page.locator('[data-id="db"] .resource-card').click({ position: { x: 90, y: 43 } });
  await expect(page.locator('.detail-panel h2')).toHaveText('背後のDB');
  await page.locator('[data-id="prod"] .resource-heading').click();
  await page.getByLabel('表示アイコンを検索', { exact: true }).fill('aws.organization-account');
  await page.getByRole('button', { name: 'aws.organization-account', exact: true }).click();
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'DSL 入力' })).toHaveValue(
    /icon="aws.organization-account"/,
  );
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  await page.getByRole('button', { name: '本番を折りたたむ', exact: true }).click();
  await expect(page.locator('[data-id="prod"] .service-icon')).toHaveCount(1);
  await page.getByRole('button', { name: '本番を展開', exact: true }).click();
  await page.locator('[data-id="db"] .resource-card').click({ position: { x: 90, y: 43 } });
  await expect(page.locator('.detail-panel h2')).toHaveText('背後のDB');
  await page.screenshot({ path: 'artifacts/overlay-click-fixed.png' });
});

test('矢印トグル・囲み・配置移動の操作が図の位置を維持し説明を表示する', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('combobox', { name: 'サンプル', exact: true }).selectOption('architecture');
  await expect(page.getByRole('combobox', { name: '構成の詳しさ', exact: true })).toBeVisible();
  await expect(page.locator('.layout-status')).toHaveCount(0);
  const before = await page.locator('.react-flow__viewport').evaluate(async (el) => {
    for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
    return el.getAttribute('style');
  });
  const shape = page.getByRole('combobox', {
    name: '矢印の形',
    exact: true,
    includeHidden: true,
  });
  await toggleArrowShape(page);
  await expect(shape).toHaveValue('bezier');
  await toggleArrowShape(page);
  await expect(shape).toHaveValue('orthogonal');
  await expect(page.locator('.membership-overlay')).toHaveCount(0);
  await toggleMembership(page);
  await expect(page.locator('.membership-overlay')).toHaveCount(2);
  await expect(
    page.getByRole('checkbox', { name: '追加の囲み', exact: true, includeHidden: true }),
  ).toBeChecked();
  expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(before);
  await page.getByRole('button', { name: '配置を移動', exact: true }).click();
  await expect(page.locator('.layout-help')).toContainText('カードをドラッグ');
  await page.getByRole('button', { name: '移動を完了', exact: true }).click();
  await expect(page.locator('.layout-help')).toHaveCount(0);
  await page.locator('[data-id="prod"] .resource-heading').click();
  await expect(page.locator('[data-id="api_a"] .resource-card')).not.toHaveClass(/muted/);
  await expect(page.locator('[data-id="api_c"] .resource-card')).not.toHaveClass(/muted/);
  await expect(page.locator('[data-id="primary"] .resource-card')).not.toHaveClass(/muted/);
  await expect(
    page.locator('.react-flow__edge[data-id="edge-2"] .react-flow__edge-path'),
  ).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: '詳細へ移動', exact: true }).click();
  await page.locator('.react-flow__viewport').evaluate(async () => {
    for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
  });
  const toolbar = await page.locator('.canvas-toolbar').boundingBox();
  const heading = await page.locator('[data-id="prod"] .resource-heading').boundingBox();
  expect(heading!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height);
});

test('一直線の端点でも曲線が実際に膨らみ、直線へ戻せる', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.locator('input[type=file]').setInputFiles({
    name: 'curve.infra',
    mimeType: 'text/plain',
    buffer: Buffer.from(`diagram "curve" {
    external.node a x=24 y=200 fixed=true
    external.node b x=700 y=200 fixed=true
    a -> b
  }`),
  });
  await expect(page.locator('.layout-status')).toHaveCount(0);
  const path = page.locator('.react-flow__edge-path');
  const original = await path.getAttribute('d');
  await toggleArrowShape(page);
  const bend = await path.evaluate((element) => {
    const p = element as SVGPathElement;
    const start = p.getPointAtLength(0),
      end = p.getPointAtLength(p.getTotalLength());
    const middle = p.getPointAtLength(p.getTotalLength() / 2);
    return Math.abs(middle.y - (start.y + end.y) / 2);
  });
  expect(bend).toBeGreaterThan(40);
  await toggleArrowShape(page);
  await expect(path).toHaveAttribute('d', original!);
  await toggleArrowShape(page);
  await page.screenshot({ path: 'artifacts/curve-toggle-fixed.png' });
});
