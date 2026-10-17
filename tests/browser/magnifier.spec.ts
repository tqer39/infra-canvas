import { resolve } from 'node:path';
import { test, expect, type Page } from './fixtures';

const viewportSelector = '.react-flow__renderer .react-flow__viewport';

async function viewport(page: Page) {
  return page.locator(viewportSelector).evaluate(async (element) => {
    for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}

for (const offline of [false, true]) {
  test(`ルーペで局所拡大し、起動中は縮尺を固定する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await expect(page.locator(`${viewportSelector} .resource-label`).first()).toBeVisible();
    const initial = await viewport(page);
    const toggle = page.getByRole('button', { name: 'ルーペ', exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Zoom In', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Zoom Out', exact: true })).toBeDisabled();

    const original = page.locator(`${viewportSelector} [data-id="api"]`);
    await original.hover();
    const lens = page.locator('.magnifier');
    await expect(lens).toBeVisible();
    const copy = lens.locator('[data-id="api"]');
    await expect(copy).toHaveCount(1);
    const originalBounds = (await original.boundingBox())!;
    const copyBounds = (await copy.boundingBox())!;
    expect(copyBounds.width).toBeCloseTo(originalBounds.width * 2, 1);
    expect(copyBounds.height).toBeCloseTo(originalBounds.height * 2, 1);
    await expect(lens).toHaveAttribute('inert', '');
    expect(await viewport(page)).toEqual(initial);

    const canvasBounds = (await page.locator('.canvas-area > .react-flow').boundingBox())!;
    for (const [x, y] of [
      [canvasBounds.x + 10, canvasBounds.y + 10],
      // 右下のReact Flow帰属表示を避け、図の表示領域で確認する。
      [canvasBounds.x + canvasBounds.width - 10, canvasBounds.y + canvasBounds.height - 40],
      [originalBounds.x + originalBounds.width / 2, originalBounds.y + originalBounds.height / 2],
    ]) {
      await page.mouse.move(x, y);
      // 端でルーペの位置が補正されても、ポインターを中心に2倍になる。
      await expect
        .poll(async () => {
          const source = await original.boundingBox();
          const enlarged = await copy.boundingBox();
          if (!source || !enlarged) return Infinity;
          return Math.max(
            Math.abs(enlarged.x - (x + (source.x - x) * 2)),
            Math.abs(enlarged.y - (y + (source.y - y) * 2)),
          );
        })
        .toBeLessThan(0.1);
      const bounds = (await lens.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(canvasBounds.x);
      expect(bounds.y).toBeGreaterThanOrEqual(canvasBounds.y);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(canvasBounds.x + canvasBounds.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(canvasBounds.y + canvasBounds.height);
    }

    await page.mouse.wheel(0, 200);
    expect(await viewport(page)).toEqual(initial);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -150);
    await page.keyboard.up('Control');
    expect(await viewport(page)).toEqual(initial);
    await original.dblclick();
    expect((await viewport(page)).zoom).toBe(initial.zoom);
    // ルーペはクリックを遮らず、選択の変化も拡大表示に反映する。
    await expect(page.locator('.detail-panel')).toContainText('api');
    await expect(copy).toHaveClass(/selected/);

    await page.mouse.wheel(100, 0);
    const panned = await viewport(page);
    expect(panned.zoom).toBe(initial.zoom);
    expect(panned.x).toBeCloseTo(initial.x - 100, 2);
    const minimap = page.locator('.react-flow__minimap');
    await minimap.hover();
    await page.mouse.wheel(0, 200);
    expect((await viewport(page)).zoom).toBe(initial.zoom);
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    expect((await viewport(page)).zoom).toBe(initial.zoom);

    await page.getByRole('textbox', { name: 'リソース検索', exact: true }).fill('api');
    await page.locator('.search-results button').first().click();
    const searchZooms = await page.locator(viewportSelector).evaluate(async (element) => {
      const values: number[] = [];
      for (let i = 0; i < 50; i++) {
        await new Promise(requestAnimationFrame);
        values.push(new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
      }
      return values;
    });
    for (const zoom of searchZooms) expect(zoom).toBeCloseTo(initial.zoom, 5);

    await original.hover();
    await expect(lens).toBeVisible();
    await page.screenshot({ path: `artifacts/magnifier-${offline ? 'offline' : 'dev'}.png` });
    await toggle.hover();
    await expect(lens).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(lens).toHaveCount(0);
    await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
    expect((await viewport(page)).zoom).toBeLessThan(initial.zoom);
    // ボタンでの終了と再起動も、現在の縮尺を基準にする。
    await toggle.click();
    await original.hover();
    await expect(lens).toBeVisible();
    await page.getByRole('button', { name: 'ルーペ', exact: true }).click();
    await expect(lens).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
