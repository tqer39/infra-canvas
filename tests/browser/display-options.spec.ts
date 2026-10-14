import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { expandDisplaySection, selectDetail, setDisplayOptions } from './display-controls';

for (const offline of [false, true]) {
  test(`表示オプションは外側のクリックで閉じ、内側の操作とボタン開閉を保つ (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const panel = page.getByRole('region', { name: '表示オプション', exact: true });
    const button = page.getByRole('button', { name: '表示オプション', exact: true });
    const viewport = page.locator('.react-flow__viewport');
    await expect(page.locator('.layout-status')).toHaveCount(0);
    await viewport.evaluate(async () => {
      for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
    });
    const position = await viewport.getAttribute('style');
    await button.click();
    await panel.getByRole('combobox', { name: '矢印の形', exact: true }).selectOption('bezier');
    await expect(panel).toBeVisible();
    await expandDisplaySection(page, '保存した表示');
    await panel
      .getByRole('combobox', { name: '保存した表示', exact: true })
      .selectOption('service');
    await expect(panel).toBeVisible();
    await page.locator('.document-title').click();
    await expect(panel).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    if (!offline) await page.screenshot({ path: 'artifacts/display-options-outside-closed.png' });
    expect(await viewport.getAttribute('style')).toBe(position);
    await button.click();
    await expect(panel).toBeVisible();
    await button.click();
    await expect(panel).toBeHidden();
    await button.click();
    const search = page.getByRole('textbox', { name: 'リソース検索', exact: true });
    await search.click();
    await expect(panel).toBeHidden();
    await expect(search).toBeFocused();
    await search.fill('ECS API');
    await expect(page.locator('.search-results')).toContainText('ECS API');
    await search.fill('');
    await button.click();
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
    await expect(panel).toBeHidden();
    expect(await viewport.getAttribute('style')).toBe(position);
  });

  test(`構成の詳しさを常設し、表示オプションの開閉・SG・履歴で視点を保持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const detail = page.getByRole('combobox', { name: '構成の詳しさ', exact: true });
    const options = page.getByRole('region', { name: '表示オプション', exact: true });
    const button = page.getByRole('button', { name: '表示オプション', exact: true });
    await expect(detail).toBeVisible();
    await expect(detail).toHaveValue('service');
    await expect(options).toBeHidden();
    await selectDetail(page, 'subnet');
    await expect(page.locator('.layout-status')).toHaveCount(0);
    const viewport = page.locator('.react-flow__viewport');
    await viewport.evaluate(async () => {
      for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
    });
    const position = await viewport.getAttribute('style');
    await setDisplayOptions(page, true);
    await expect(detail).toBeVisible();
    await expect(options.getByRole('checkbox', { name: '通信', exact: true })).toBeVisible();
    const additions = options.getByRole('group', { name: '追加情報', exact: true });
    await expect(
      additions.getByRole('checkbox', { name: 'セキュリティグループと所属', exact: true }),
    ).toBeVisible();
    await expect(
      additions.getByRole('checkbox', { name: '追加の囲み', exact: true }),
    ).toBeVisible();
    await expect(additions.getByRole('combobox', { name: '矢印の形', exact: true })).toHaveCount(0);
    const additionsBounds = (await additions.boundingBox())!;
    const shapeBounds = (await options
      .getByRole('combobox', { name: '矢印の形', exact: true })
      .boundingBox())!;
    expect(shapeBounds.y).toBeGreaterThanOrEqual(additionsBounds.y + additionsBounds.height);
    await expect(options.getByRole('combobox', { name: '矢印の形', exact: true })).toBeVisible();
    await expect(options.getByRole('combobox', { name: '矢印の形', exact: true })).toHaveValue(
      'orthogonal',
    );
    await expect(
      options.getByRole('checkbox', { name: '追加の囲み', exact: true }),
    ).not.toBeChecked();
    await expect(options.getByRole('checkbox', { name: '追加の囲み', exact: true })).toBeDisabled();
    await expect(page.locator('.saved-views')).not.toHaveAttribute('open');
    await expect(page.locator('.save-view')).not.toHaveAttribute('open');
    await expect(
      options.getByRole('combobox', { name: '保存した表示', exact: true, includeHidden: true }),
    ).toBeHidden();
    await expect(
      options.getByRole('textbox', { name: '保存するビューID', exact: true, includeHidden: true }),
    ).toBeHidden();
    const triggerBounds = (await button.boundingBox())!;
    const panelBounds = (await options.boundingBox())!;
    expect(panelBounds.width).toBeLessThanOrEqual(340);
    expect(panelBounds.height).toBeLessThanOrEqual(380);
    expect(panelBounds.x).toBeCloseTo(triggerBounds.x, 0);
    expect(panelBounds.y).toBeCloseTo(triggerBounds.y + triggerBounds.height + 8, 0);
    if (!offline) await page.screenshot({ path: 'artifacts/display-options-compact.png' });
    expect(await viewport.getAttribute('style')).toBe(position);
    await options
      .getByRole('checkbox', { name: 'セキュリティグループと所属', exact: true })
      .check();
    await expect(page.locator('.react-flow__node[data-id="application"]')).toHaveCount(1);
    await expect(detail).toHaveValue('subnet');
    await expect(page.locator('.layout-status')).toHaveCount(0);
    expect(await viewport.getAttribute('style')).toBe(position);
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await setDisplayOptions(page, true);
    await expect(
      options.getByRole('checkbox', { name: 'セキュリティグループと所属', exact: true }),
    ).not.toBeChecked();
    await expect(detail).toHaveValue('subnet');
    await page.getByRole('button', { name: 'やり直す', exact: true }).click();
    await setDisplayOptions(page, true);
    await expect(
      options.getByRole('checkbox', { name: 'セキュリティグループと所属', exact: true }),
    ).toBeChecked();
    await options.getByRole('combobox', { name: '矢印の形', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(options).toBeHidden();
    await expect(button).toBeFocused();
    await expect(detail).toBeVisible();
    expect(await viewport.getAttribute('style')).toBe(position);
    if (!offline) await page.screenshot({ path: 'artifacts/display-options-closed.png' });
    // 非表示のSGを検索しても、詳しさや選択した保存ビューを変えない。
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(page.locator('.react-flow__node[data-id="observability"]')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'リソース検索', exact: true }).fill('監視 SG');
    await page.locator('.search-results button').click();
    await expect(page.locator('.detail-panel > h2')).toHaveText('監視 SG');
    await expect(detail).toHaveValue('subnet');
    await setDisplayOptions(page, true);
    await expect(
      options.getByRole('checkbox', { name: 'セキュリティグループと所属', exact: true }),
    ).toBeChecked();
    await expandDisplaySection(page, '保存した表示');
    await expect(options.getByRole('combobox', { name: '保存した表示', exact: true })).toHaveValue(
      'service',
    );
  });
}

test('保存済み表示の詳しさ・SG・絞り込みを反映し、調整した表示をDSLに保存できる', async ({
  page,
}) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'DSL 入力', exact: true });
  await editor.fill(`diagram "表示設定の保存" {
    account a {
      subnet s { aws.ec2 app securityGroups=[sg1] }
      sg sg1
    }
    external.user user
    user -> app kind=traffic route=web step=1
    view service level=resource
    view custom label="通信とSG" level=subnet overlay=sg kinds=[traffic] routes=[web]
  }`);
  await page.getByRole('button', { name: '解析して反映', exact: true }).click();
  await expect(page.locator('.document-title')).toHaveText('表示設定の保存');
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  const detail = page.getByRole('combobox', { name: '構成の詳しさ', exact: true });
  await expect(detail).toHaveValue('resource');
  await setDisplayOptions(page, true);
  await expandDisplaySection(page, '保存した表示');
  await page.getByRole('combobox', { name: '保存した表示', exact: true }).selectOption('custom');
  await expect(detail).toHaveValue('subnet');
  const sg = page.getByRole('checkbox', { name: 'セキュリティグループと所属', exact: true });
  await expect(sg).toBeChecked();
  await expect(page.getByRole('combobox', { name: '経路フィルター', exact: true })).toHaveValue(
    'web',
  );
  await selectDetail(page, 'resource');
  await setDisplayOptions(page, true);
  await sg.uncheck();
  await page.getByRole('button', { name: '保存した設定に戻す', exact: true }).click();
  await expect(detail).toHaveValue('subnet');
  await expect(sg).toBeChecked();
  await selectDetail(page, 'resource');
  await setDisplayOptions(page, true);
  await sg.uncheck();
  await expect(page.getByRole('checkbox', { name: '通信', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '関連', exact: true })).not.toBeChecked();
  await expandDisplaySection(page, 'ビューの保存');
  await page.getByRole('textbox', { name: '保存するビューID', exact: true }).fill('adjusted');
  await page.getByRole('button', { name: 'ビューを保存', exact: true }).click();
  await expandDisplaySection(page, '保存した表示');
  await expect(page.getByRole('combobox', { name: '保存した表示', exact: true })).toHaveValue(
    'adjusted',
  );
  await expect(detail).toHaveValue('resource');
  await expect(sg).not.toBeChecked();
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  await expect(editor).toHaveValue(
    /view adjusted level=resource kinds=\["traffic"\] routes=\["web"\]/,
  );
  await setDisplayOptions(page, false);
  await page.getByRole('button', { name: '解析して反映', exact: true }).click();
  await setDisplayOptions(page, true);
  await expandDisplaySection(page, '保存した表示');
  await page.getByRole('combobox', { name: '保存した表示', exact: true }).selectOption('adjusted');
  await expect(detail).toHaveValue('resource');
  await expect(sg).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: '経路フィルター', exact: true })).toHaveValue(
    'web',
  );
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  await setDisplayOptions(page, true);
  await page.screenshot({ path: 'artifacts/display-options-open.png' });
});

test('狭い画面では表示オプションをキャンバス内に収める', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await setDisplayOptions(page, true);
  const options = page.getByRole('region', { name: '表示オプション', exact: true });
  for (const width of [900, 760]) {
    await page.setViewportSize({ width, height: 700 });
    await expect
      .poll(async () => {
        const panel = (await options.boundingBox())!;
        const toolbar = (await page.locator('.canvas-toolbar').boundingBox())!;
        return (
          panel.x >= toolbar.x - 1 &&
          panel.x + panel.width <= toolbar.x + toolbar.width + 1 &&
          panel.y + panel.height <= 700
        );
      })
      .toBe(true);
  }
});
