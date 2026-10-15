import {
  expandDisplaySection,
  setDisplayOptions,
  selectSavedView,
  toggleMembership,
} from './display-controls';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const offline of [false, true])
  test(`構成図のフィルター・経路・囲み・接続口・冗長化 (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/architecture.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    if (!offline)
      await page.locator('input[type=file]').setInputFiles('examples/architecture.infra');
    await expect(page.locator('.canvas-footer')).toContainText('8 接続');
    await expect(page.locator('.membership-overlay')).toHaveCount(0);
    await toggleMembership(page);
    await expect(page.locator('.membership-overlay')).toHaveCount(2);
    await expect(page.locator('[data-id="api_a"]')).toContainText('Active');
    await expect(page.locator('[data-id="api_a"] [data-handleid="source:backend"]')).toHaveCount(1);
    await selectSavedView(page, 'data');
    await expect(page.locator('.canvas-footer')).toContainText('1 接続');
    await selectSavedView(page, 'web_path');
    await expect(page.locator('.canvas-footer')).toContainText('6 接続');
    await setDisplayOptions(page, true);
    await expect(page.getByRole('list', { name: '選択経路の通過順' })).toContainText(
      '往路 1: user → alb',
    );
    await expect(page.getByRole('list', { name: '選択経路の通過順' })).toContainText(
      '復路 3: alb → user',
    );
    await page.getByRole('checkbox', { name: '通信', exact: true }).uncheck();
    await expect(page.locator('.canvas-footer')).toContainText('0 接続');
    await page.getByRole('checkbox', { name: '通信', exact: true }).check();
    await expandDisplaySection(page, 'ビューの保存');
    await page.getByRole('textbox', { name: '保存するビューID' }).fill('saved_path');
    await page.getByRole('button', { name: 'ビューを保存', exact: true }).click();
    await expandDisplaySection(page, '保存した表示');
    await expect(page.getByRole('combobox', { name: '保存した表示', exact: true })).toHaveValue(
      'saved_path',
    );
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'DSL 入力' })).toHaveValue(
      /view saved_path.*routes=\["web"\]/,
    );
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await setDisplayOptions(page, false);
    await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('2 接続');
    await expect(page.locator('.membership-overlay')).toHaveCount(2);
    await page.getByRole('button', { name: 'すべて展開する', exact: true }).click();
    await expect(page.locator('.canvas-footer')).toContainText('6 接続');
    await expect(page.locator('.diagnostics')).toHaveCount(0);
    expect(errors).toEqual([]);
    if (!offline) await page.screenshot({ path: 'artifacts/architecture.png' });
  });
test('配置の移動をDSLに保存し、再読込・フィルター変更でも位置を維持', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.locator('input[type=file]').setInputFiles('examples/architecture.infra');
  await expect(page.locator('.canvas-footer')).toContainText('8 接続');
  await page.locator('.react-flow__viewport').evaluate(async () => {
    for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
  });
  await page.getByRole('button', { name: '配置を移動', exact: true }).click();
  const node = page.locator('.react-flow__node[data-id="user"]');
  const before = await node.getAttribute('style');
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 55, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: '固定を解除', exact: true })).toBeEnabled();
  await expect(page.locator('.layout-status')).toHaveCount(0);
  expect(await node.getAttribute('style')).not.toBe(before);
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  const saved = await page.getByRole('textbox', { name: 'DSL 入力' }).inputValue();
  expect(saved).toMatch(/external.user user.*fixed=true/);
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  const position = await node.getAttribute('style');
  await selectSavedView(page, 'data');
  await expect(page.locator('.canvas-footer')).toContainText('1 接続');
  expect(await node.getAttribute('style')).toBe(position);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'DSL を保存', exact: true }).click();
  const file = await download;
  expect(readFileSync((await file.path())!, 'utf8')).toBe(saved);
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'saved.infra', mimeType: 'text/plain', buffer: Buffer.from(saved) });
  await expect(page.locator('.canvas-footer')).toContainText('8 接続');
  expect(await node.getAttribute('style')).toBe(position);
  await page.getByRole('button', { name: '固定を解除', exact: true }).click();
  await expect(page.getByRole('button', { name: '固定を解除', exact: true })).toBeDisabled();
  await expect(page.locator('.layout-status')).toHaveCount(0);
});

test('暗黙のサービス表示を保存しても表示粒度を維持する', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.locator('input[type=file]').setInputFiles('examples/architecture.infra');
  await expect(page.locator('.canvas-footer')).toContainText('8 接続');
  const before = await page.locator('.react-flow__node[data-id="subnet_a"]').getAttribute('style');
  await setDisplayOptions(page, true);
  await expandDisplaySection(page, 'ビューの保存');
  await page.getByRole('textbox', { name: '保存するビューID' }).fill('saved_service');
  await page.getByRole('button', { name: 'ビューを保存', exact: true }).click();
  await expandDisplaySection(page, '保存した表示');
  await expect(page.getByRole('combobox', { name: '保存した表示', exact: true })).toHaveValue(
    'saved_service',
  );
  await expect(page.locator('.layout-status')).toHaveCount(0);
  expect(await page.locator('.react-flow__node[data-id="subnet_a"]').getAttribute('style')).toBe(
    before,
  );
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'DSL 入力' })).toHaveValue(
    /view saved_service level=service/,
  );
});
