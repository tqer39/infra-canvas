import { test, expect } from './fixtures';
import { selectSavedView } from './display-controls';
import { resolve } from 'node:path';

for (const offline of [false, true]) {
  test(`操作グループが画面幅に応じて折り返し、図や情報欄を覆わない (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await expect(page.locator('.layout-status')).toHaveCount(0);
    const toolbar = page.getByRole('group', { name: '図の操作', exact: true });
    for (const name of ['表示', '境界の一括操作', '配置', '接続・囲み', '検索・選択']) {
      await expect(toolbar.getByRole('group', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('group', { name: 'ファイル', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: '編集・相談', exact: true })).toBeVisible();
    const connections = toolbar.getByRole('group', { name: '接続・囲み', exact: true });
    const legend = connections.locator('.edge-legend');
    await expect(legend).toBeHidden();
    await connections.locator('.connection-help summary').click();
    await expect(legend).toBeVisible();
    await expect(legend.locator('.edge-legend-item')).toHaveCount(7);
    await connections.locator('.connection-help summary').click();
    await expect(legend).toBeHidden();
    await expect(connections.locator('.connection-help summary')).toBeVisible();
    await expect(toolbar.getByRole('group', { name: '構成情報', exact: true })).toBeVisible();
    await expect(page.locator('.canvas-area > .canvas-footer')).toHaveCount(0);
    for (const width of [1440, 900, 640]) {
      await page.setViewportSize({ width, height: 900 });
      const toolbarBounds = (await toolbar.boundingBox())!;
      if (width === 1440) expect(toolbarBounds.height).toBeLessThanOrEqual(100);
      const info = (await page.getByRole('group', { name: '構成情報' }).boundingBox())!;
      const canvas = (await page.locator('.canvas-area > .react-flow').boundingBox())!;
      expect(info.y).toBeGreaterThanOrEqual(toolbarBounds.y);
      expect(toolbarBounds.y + toolbarBounds.height).toBeLessThanOrEqual(canvas.y);
      expect(info.y + info.height).toBeLessThanOrEqual(canvas.y);
      expect(canvas.height).toBeGreaterThan(250);
      const area = (await page.locator('.canvas-area').boundingBox())!;
      for (const control of await toolbar
        .locator('button:visible, input:visible, select:visible')
        .all()) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(area.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.x + area.width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
    // カスタムビューが加わってもグループ内で折り返す。
    await page
      .getByRole('combobox', { name: 'サンプル', exact: true })
      .selectOption('architecture');
    await selectSavedView(page, 'data');
    await expect(page.locator('.canvas-footer')).toContainText('1 接続');
    await page.screenshot({ path: `artifacts/toolbar-${offline ? 'offline' : 'dev'}-narrow.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `artifacts/toolbar-${offline ? 'offline' : 'dev'}.png` });
  });
}
