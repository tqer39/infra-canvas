import { setDisplayOptions, selectDetail, selectSavedView } from './display-controls';
import { test, expect, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDSL } from '../../src/core/parser';

async function setArrowShape(page: Page, shape: string): Promise<void> {
  await setDisplayOptions(page, true);
  const toggle = page.getByRole('combobox', {
    name: '矢印の形',
    exact: true,
    includeHidden: true,
  });
  await toggle.selectOption(shape);
  await setDisplayOptions(page, false);
}

async function blurEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

for (const offline of [false, true]) {
  test(`自動選択された実際のアイコンの分類だけ初期展開する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const picker = page.getByRole('group', { name: '表示アイコン', exact: true });
    for (const [id, type, group] of [
      ['api', 'aws.ecs', 'AWS'],
      ['tokyo', 'aws.region', 'AWS'],
      ['prod', 'aws.account', 'AWS'],
      ['db', 'aws.rds', 'AWS'],
      ['repository', 'github.repository', 'GitHub'],
      ['users', 'external.user', '利用者・外部リソース'],
    ]) {
      const node = page.locator(`.react-flow__node[data-id="${id}"]`);
      await node.locator('.resource-label').click();
      await expect(picker.locator('.icon-group[open] summary')).toHaveText([
        new RegExp(`^${group}`),
      ]);
      const candidate = picker.getByRole('button', { name: type, exact: true });
      await expect
        .poll(() =>
          candidate.evaluate((button) => {
            const browser = button.closest('.icon-browser')!;
            const viewport = browser.getBoundingClientRect();
            const target = button.getBoundingClientRect();
            const heading = button
              .closest('details')!
              .querySelector('summary')!
              .getBoundingClientRect();
            return target.top >= viewport.top + heading.height && target.bottom <= viewport.bottom;
          }),
        )
        .toBe(true);

      await expect(node.locator('.service-icon')).toHaveAttribute(
        'src',
        (await candidate.locator('img').getAttribute('src'))!,
      );
      await expect(
        picker.getByRole('button', { name: '種別から自動選択', exact: true }),
      ).toHaveAttribute('aria-pressed', id === 'prod' ? 'false' : 'true');
    }
    await page.locator('input[type=file]').setInputFiles({
      name: 'selected.infra',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'diagram "明示指定" {\n external.service selected "選択済み" icon=saas.zenn\n view service level=resource\n}',
      ),
    });
    await page.locator('[data-id="selected"] .resource-label').click();
    const selected = picker.getByRole('button', { name: 'saas.zenn', exact: true });
    await expect
      .poll(() =>
        selected.evaluate((button) => {
          const browser = button.closest('.icon-browser')!;
          const viewport = browser.getBoundingClientRect();
          const target = button.getBoundingClientRect();
          return (
            browser.scrollTop > 0 && target.top >= viewport.top && target.bottom <= viewport.bottom
          );
        }),
      )
      .toBe(true);
    const panelScroll = await page.locator('.detail-panel').evaluate((panel) => panel.scrollTop);
    await page.getByLabel('表示アイコンを検索', { exact: true }).fill('zenn');
    await page.getByLabel('表示アイコンを検索', { exact: true }).fill('');
    await expect
      .poll(() =>
        selected.evaluate((button) => {
          const viewport = button.closest('.icon-browser')!.getBoundingClientRect();
          const target = button.getBoundingClientRect();
          return target.top >= viewport.top && target.bottom <= viewport.bottom;
        }),
      )
      .toBe(true);
    await expect(page.locator('.detail-panel')).toHaveJSProperty('scrollTop', panelScroll);
    const githubGroup = picker.locator('.icon-group').filter({ hasText: /^GitHub/ });
    await githubGroup.locator('summary').click();
    await expect(githubGroup).toHaveAttribute('open');
    await expect
      .poll(() =>
        githubGroup.locator('summary').evaluate((heading) => {
          const viewport = heading.closest('.icon-browser')!.getBoundingClientRect();
          const target = heading.getBoundingClientRect();
          return target.top >= viewport.top && target.bottom <= viewport.bottom;
        }),
      )
      .toBe(true);

    await page.locator('input[type=file]').setInputFiles({
      name: 'fallback.infra',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        'diagram "代替アイコン" {\n external.service unknown "汎用サービス"\n view service level=resource\n}',
      ),
    });
    await page.locator('[data-id="unknown"] .resource-label').click();
    await expect(picker.locator('.icon-group[open]')).toHaveCount(0);
  });
  test(`表示アイコンの検索は選択を変えず、選択は自動反映・Undo/Redoできる (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const node = page.locator('.react-flow__node[data-id="api"]');
    await node.locator('.resource-label').click();
    const form = page.getByRole('form', { name: 'リソース情報の編集' });
    const search = form.getByLabel('表示アイコンを検索', { exact: true });
    const picker = form.getByRole('group', { name: '表示アイコン', exact: true });
    const options = picker.locator('.icon-candidate > span:last-child');
    await expect(form.getByRole('button', { name: '変更を反映', exact: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '表示アイコン', exact: true })).toHaveCount(0);
    const awsGroup = picker
      .locator('.icon-group')
      .filter({ has: page.locator('summary', { hasText: /^AWS/ }) });
    await expect(awsGroup).toHaveCount(1);
    await expect(picker.locator('.icon-group[open] summary')).toHaveText([/AWS/]);
    await expect(awsGroup).toHaveAttribute('open');
    await expect(awsGroup.getByRole('button', { name: 'aws.ec2', exact: true })).toBeVisible();
    await awsGroup.locator('summary').click();
    await expect(awsGroup).not.toHaveAttribute('open');
    await expect(awsGroup.getByRole('button', { name: 'aws.ec2', exact: true })).toBeHidden();
    await search.fill('Google Cloud');
    await expect(picker.locator('.icon-group summary')).toHaveText([/Google Cloud/]);
    await expect(picker.getByRole('button', { name: 'gcp.cloud', exact: true })).toBeVisible();
    await search.fill('');
    await expect(awsGroup).not.toHaveAttribute('open');
    const originalIcon = await node.locator('.service-icon').getAttribute('src');
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'DSL 入力', exact: true });
    const original = await editor.inputValue();
    await form.getByLabel('名前', { exact: true }).focus();
    await blurEditor(page);
    await expect(editor).toHaveValue(original);
    await search.fill('  GITHUB  ');
    await expect(options).toHaveText([
      '種別から自動選択',
      'github.actions',
      'github.repository',
      'saas.github',
    ]);
    await expect(picker.locator('img')).toHaveCount(3);
    await expect
      .poll(() =>
        picker
          .locator('img')
          .evaluateAll((images) =>
            images.every((img) => (img as HTMLImageElement).naturalWidth > 0),
          ),
      )
      .toBe(true);
    await picker.screenshot({
      path: `artifacts/icon-candidates-${offline ? 'offline' : 'dev'}.png`,
    });
    await search.press('Enter');
    await expect(editor).toHaveValue(original);
    await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
    const github = picker.getByRole('button', { name: 'saas.github', exact: true });
    await expect(github.locator('img')).toBeVisible();
    await expect
      .poll(() => github.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await github.focus();
    await github.press('Enter');
    await expect(form.getByAltText('saas.github のプレビュー')).toBeVisible();
    await expect(editor).toHaveValue(/icon="saas.github"/);
    await expect(node.locator('.service-icon')).not.toHaveAttribute('src', originalIcon!);
    const selectedIcon = await node.locator('.service-icon').getAttribute('src');
    const selectedSource = await editor.inputValue();
    await search.fill('no-matching-icon');
    await expect(form).toContainText('該当するアイコンはありません');
    await expect(github).toHaveAttribute('aria-pressed', 'true');
    await expect(options).toHaveText(['種別から自動選択', 'saas.github（現在の選択）']);
    await expect(editor).toHaveValue(selectedSource);
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(editor).toHaveValue(original);
    await expect(node.locator('.service-icon')).toHaveAttribute('src', originalIcon!);
    await page.getByRole('button', { name: 'やり直す', exact: true }).click();
    await expect(node.locator('.service-icon')).toHaveAttribute('src', selectedIcon!);
    await node.locator('.resource-label').click();
    await expect(picker.locator('.icon-group[open] summary')).toHaveText([/外部サービス・SaaS/]);
    await expect(picker.getByRole('button', { name: 'saas.github', exact: true })).toBeVisible();
    await picker.getByRole('button', { name: '種別から自動選択', exact: true }).click();
    await expect(editor).toHaveValue(original);
    await expect(node.locator('.service-icon')).toHaveAttribute('src', originalIcon!);
    await search.fill('aws.cloud');
    const cloud = picker.getByRole('button', { name: 'aws.cloud', exact: true });
    await expect(cloud.locator('img')).toBeVisible();
    const cloudSvg = await cloud
      .locator('img')
      .evaluate(async (img) => (await fetch((img as HTMLImageElement).src)).text());
    expect(cloudSvg).toContain('AWS-Cloud-logo_32');
    await cloud.click();
    await expect(editor).toHaveValue(/icon="aws.cloud"/);
    await expect(node.locator('.service-icon')).toHaveAttribute(
      'src',
      (await cloud.locator('img').getAttribute('src')) ?? '',
    );
    for (const type of ['gcp.cloud', 'azure.cloud']) {
      await search.fill(type);
      const brand = picker.getByRole('button', { name: type, exact: true });
      await expect
        .poll(() => brand.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      await brand.click();
      if (type === 'gcp.cloud') {
        const image = brand.locator('img');
        await expect(image).toHaveAttribute('src', /(?:gcp-cloud\.png|^data:image\/png)/);
        await expect(form.getByAltText('gcp.cloud のプレビュー')).toBeVisible();
      }
      await expect(brand).toHaveAttribute('aria-pressed', 'true');
      await expect(editor).toHaveValue(new RegExp(`icon="${type.replace('.', '\\.')}"`));
      await expect(node.locator('.service-icon')).toHaveAttribute(
        'src',
        (await brand.locator('img').getAttribute('src')) ?? '',
      );
    }
  });

  test(`属性と接続の編集を Undo/Redo で DSL とともに復元し、視点を保持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const node = page.locator('.react-flow__node[data-id="api"]');
    await expect(node).toBeVisible();
    await node.locator('.resource-label').click();
    const form = page.getByRole('form', { name: 'リソース情報の編集' });
    const undo = page.getByRole('button', { name: '元に戻す', exact: true });
    const redo = page.getByRole('button', { name: 'やり直す', exact: true });
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'DSL 入力', exact: true });
    const original = await editor.inputValue();
    // 自動全体表示のアニメーションが完了してから比較する。
    await page.locator('.react-flow__viewport').evaluate(async () => {
      for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
    });
    const viewport = page.locator('.react-flow__viewport');
    const before = await viewport.getAttribute('style');
    await form.getByLabel('名前', { exact: true }).fill('Undo対象API');
    await expect(form.getByLabel('名前', { exact: true })).toBeFocused();
    await expect(node).toContainText('ECS API');
    await expect(editor).toHaveValue(original);
    await blurEditor(page);
    await expect(node).toContainText('Undo対象API');
    const edited = await editor.inputValue();
    expect(edited).not.toBe(original);
    await undo.click();
    await expect(node).toContainText('ECS API');
    await expect(editor).toHaveValue(original);
    await expect(viewport).toHaveAttribute('style', before!);
    await redo.click();
    await expect(node).toContainText('Undo対象API');
    await expect(editor).toHaveValue(edited);
    await expect(viewport).toHaveAttribute('style', before!);
    await node.locator('.resource-label').click();
    await expect(form.getByLabel('名前', { exact: true })).toHaveValue('Undo対象API');
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await page
      .getByRole('button', { name: 'Undo対象API → PostgreSQL: 通信 · tcp · 5432', exact: true })
      .click();
    await page.locator('.connection-editor summary').click();
    const edgeForm = page.locator('.connection-editor form');
    await edgeForm.getByLabel('ポート', { exact: true }).fill('6432');
    await blurEditor(page);
    await expect(
      page.getByRole('button', {
        name: 'Undo対象API → PostgreSQL: 通信 · tcp · 6432',
        exact: true,
      }),
    ).toBeVisible();
    await undo.click();
    await expect(
      page.getByRole('button', {
        name: 'Undo対象API → PostgreSQL: 通信 · tcp · 5432',
        exact: true,
      }),
    ).toBeVisible();
    await redo.click();
    await expect(
      page.getByRole('button', {
        name: 'Undo対象API → PostgreSQL: 通信 · tcp · 6432',
        exact: true,
      }),
    ).toBeVisible();
  });
  test(`Undo/Redo で表示・一括境界操作・詳細範囲を復元する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const undo = page.getByRole('button', { name: '元に戻す', exact: true });
    const redo = page.getByRole('button', { name: 'やり直す', exact: true });
    const footer = page.locator('.canvas-footer');
    const shape = page.getByRole('combobox', {
      name: '矢印の形',
      exact: true,
      includeHidden: true,
    });
    await expect(footer).toContainText('19 要素');
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    await setArrowShape(page, 'bezier');
    await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
    await expect(footer).toContainText('5 要素');
    await undo.click();
    await expect(footer).toContainText('19 要素');
    await expect(shape).toHaveValue('bezier');
    await page.screenshot({ path: `artifacts/undo-redo-${offline ? 'offline' : 'dev'}.png` });
    await undo.click();
    await expect(shape).toHaveValue('orthogonal');
    await expect(undo).toBeDisabled();
    await redo.click();
    await expect(shape).toHaveValue('bezier');
    await redo.click();
    await expect(footer).toContainText('5 要素');
    await expect(redo).toBeDisabled();
    await undo.click();
    await expect(footer).toContainText('19 要素');
    // Undo 後の新しい操作で分岐し、詳細への移動を一操作として復元する。
    await page.locator('.react-flow__node[data-id="main"]').click();
    await page.getByRole('button', { name: '詳細へ移動', exact: true }).click();
    await expect(page.locator('.scope-bar')).toContainText('本番 VPC の詳細');
    await expect(redo).toBeDisabled();
    await undo.click();
    await expect(page.locator('.scope-bar')).toHaveCount(0);
    await expect(footer).toContainText('19 要素');
    await redo.click();
    await expect(page.locator('.scope-bar')).toContainText('本番 VPC の詳細');
    await selectDetail(page, 'subnet');
    await expect(page.getByRole('combobox', { name: '構成の詳しさ', exact: true })).toHaveValue(
      'subnet',
    );
    await undo.click();
    await expect(page.getByRole('combobox', { name: '構成の詳しさ', exact: true })).toHaveValue(
      'service',
    );
    await expect(page.locator('.scope-bar')).toContainText('本番 VPC の詳細');
  });
  test(`Undo/Redo で DSL と読み込んだ図を復元し、解析エラーでは履歴を保持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const undo = page.getByRole('button', { name: '元に戻す', exact: true });
    const redo = page.getByRole('button', { name: 'やり直す', exact: true });
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'DSL 入力', exact: true });
    const original = await editor.inputValue();
    await editor.fill('diagram "変更後" version=1 { aws.ec2 app "新しいサービス" }');
    await page.getByRole('button', { name: '解析して反映', exact: true }).click();
    await expect(page.locator('.document-title')).toHaveText('変更後');
    await expect(page.locator('.canvas-footer')).toContainText('1 要素');
    const applied = await editor.inputValue();
    await undo.click();
    await expect(editor).toHaveValue(original);
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    await editor.fill('diagram "壊れた入力" {');
    await page.getByRole('button', { name: '解析して反映', exact: true }).click();
    await expect(page.locator('.diagnostics')).toBeVisible();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(editor).toHaveValue(applied);
    await expect(page.locator('.diagnostics')).toHaveCount(0);
    // 同じ入力の再反映では履歴を増やさない。
    await page.getByRole('button', { name: '解析して反映', exact: true }).click();
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(editor).toHaveValue(original);
    await page.locator('input[type=file]').setInputFiles('examples/gcp-azure.infra');
    await expect(page.locator('.canvas-footer')).toContainText('12 要素');
    await undo.click();
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    await expect(editor).toHaveValue(original);
    await redo.click();
    await expect(page.locator('.canvas-footer')).toContainText('12 要素');
    const imported = JSON.parse(readFileSync('artifacts/terraform-model.json', 'utf8'));
    await page.locator('input[type=file]').setInputFiles('artifacts/terraform-model.json');
    await expect(page.locator('.document-title')).toHaveText(imported.title);
    await undo.click();
    await expect(page.locator('.canvas-footer')).toContainText('12 要素');
    await redo.click();
    await expect(page.locator('.document-title')).toHaveText(imported.title);
  });
  test(`Undo/Redo ショートカットは入力欄の文字編集を妨げない (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    const detail = page.getByRole('combobox', { name: '構成の詳しさ', exact: true });
    await selectDetail(page, 'subnet');
    await page.keyboard.press('Control+z');
    await expect(detail).toHaveValue('service');
    await page.keyboard.press('Control+y');
    await expect(detail).toHaveValue('subnet');
    await page.keyboard.press('Meta+z');
    await expect(detail).toHaveValue('service');
    await page.keyboard.press('Meta+Shift+z');
    await expect(detail).toHaveValue('subnet');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+z');
    await expect(detail).toHaveValue('subnet');
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'DSL 入力', exact: true });
    const draftBefore = await editor.inputValue();
    await editor.focus();
    await page.keyboard.press('End');
    await page.keyboard.type('x');
    await expect(editor).not.toHaveValue(draftBefore);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(editor).toHaveValue(draftBefore);
    await expect(detail).toHaveValue('subnet');
    await editor.fill('入力途中の草稿');
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(detail).toHaveValue('service');
    await expect(editor).toHaveValue('入力途中の草稿');
    const search = page.getByRole('textbox', { name: 'リソース検索', exact: true });
    await search.focus();
    await page.keyboard.press('Control+y');
    await expect(detail).toHaveValue('service');
  });
  test(`展開済みリソースへの再検索は履歴を増やさず対象へ移動する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await expect(page.locator('.canvas-footer')).toContainText('19 要素');
    const search = page.getByRole('textbox', { name: 'リソース検索', exact: true });
    const focusAPI = async () => {
      await search.fill('ECS API');
      await page.locator('.search-results button').click();
      await expect
        .poll(() =>
          page.locator('.react-flow__node[data-id="api"]').evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const area = node.closest('.canvas-area')!.getBoundingClientRect();
            return (
              rect.left >= area.left &&
              rect.right <= area.right &&
              rect.top >= area.top &&
              rect.bottom <= area.bottom
            );
          }),
        )
        .toBe(true);
    };
    await focusAPI();
    await page.mouse.move(400, 250);
    await page.mouse.wheel(5000, 0);
    await focusAPI();
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
  });
  test(`右ペインで属性と接続を編集し、検証・DSL同期・画面位置の保持ができる (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
    await expect(node('api')).toBeVisible();
    await node('api').locator('.resource-label').click();
    const form = page.getByRole('form', { name: 'リソース情報の編集' });
    const add = async (key: string) => {
      await form.getByLabel('追加する属性', { exact: true }).fill(key);
      await form.getByRole('button', { name: '属性を追加', exact: true }).click();
    };
    await form.getByLabel('名前', { exact: true }).fill('編集したAPI');
    await add('cpu');
    await form.getByLabel('CPU (units)', { exact: true }).fill('2048');
    await add('memory');
    await form.getByLabel('メモリ (MiB)', { exact: true }).fill('-1');
    await blurEditor(page);
    await expect(form.getByRole('alert')).toContainText('memory');
    await expect(node('api')).toContainText('編集したAPI');
    await form.getByLabel('メモリ (MiB)', { exact: true }).fill('4096');
    await form.getByLabel('Subnet の ID', { exact: true }).fill('missing');
    await blurEditor(page);
    await expect(form.getByRole('alert')).toContainText('存在しない参照');
    await form.getByLabel('Subnet の ID', { exact: true }).fill('private_a\nprivate_c');
    const viewport = page.locator('.react-flow__viewport');
    const before = await viewport.getAttribute('style');
    await blurEditor(page);
    await expect(form.getByRole('status')).toHaveText('変更を反映しました');
    await expect(node('api')).toContainText('編集したAPI');
    await expect(node('api')).toContainText('2048 units (2 vCPU)');
    await expect(node('api')).toContainText('4096 MiB (4 GiB)');
    await expect(viewport).toHaveAttribute('style', before!);
    await form.getByLabel('CPU (units)', { exact: true }).fill('1024');
    await blurEditor(page);
    await expect(node('api')).toContainText('1024 units');
    await form.getByLabel('CPU (units)', { exact: true }).fill('2048');
    await blurEditor(page);
    await form.getByRole('button', { name: 'memory を削除', exact: true }).click();
    await blurEditor(page);
    await expect(node('api')).not.toContainText('4096 MiB');
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const dsl = page.getByRole('textbox', { name: 'DSL 入力' });
    expect(await dsl.inputValue()).toContain('cpu=2048');
    expect(await dsl.inputValue()).toContain('"編集したAPI"');
    await dsl.fill((await dsl.inputValue()) + '\n# 未反映の下書き');
    await form.getByLabel('名前', { exact: true }).fill('上書きしない');
    await blurEditor(page);
    await expect(form.getByRole('alert')).toContainText('未反映');
    await page.getByRole('button', { name: '解析して反映', exact: true }).click();
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const edge = page.getByRole('button', {
      name: '編集したAPI → PostgreSQL: 通信 · tcp · 5432',
      exact: true,
    });
    await edge.click();
    await page.locator('.connection-editor summary').click();
    const edgeForm = page.locator('.connection-editor form');
    await edgeForm.getByLabel('ポート', { exact: true }).fill('70000');
    await blurEditor(page);
    await expect(edgeForm.getByRole('alert')).toContainText('65535');
    await edgeForm.getByLabel('ポート', { exact: true }).fill('6432');
    await blurEditor(page);
    await expect(
      page.getByRole('button', {
        name: '編集したAPI → PostgreSQL: 通信 · tcp · 6432',
        exact: true,
      }),
    ).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({
      name: 'state-model.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          title: '取り込み済み',
          resources: [
            {
              id: 'task',
              type: 'aws.ecs-task-definition',
              label: 'Task',
              attributes: { cpu: 512, memory: 1024 },
              provenance: {
                kind: 'state',
                repository: 'example/repo',
                address: 'aws_ecs_task_definition.main',
                file: 'main.tf',
                line: 8,
              },
            },
          ],
          connections: [],
          views: [],
          diagnostics: [],
        }),
      ),
    });
    await expect(node('task')).toBeVisible();
    await node('task').locator('.resource-label').click();
    await form.getByLabel('CPU (units)', { exact: true }).fill('1024');
    await blurEditor(page);
    await expect(page.locator('.detail-panel')).toContainText('design');
    await expect(page.locator('.detail-panel')).toContainText('取り込み元には反映していません');
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    expect(await dsl.inputValue()).toContain('sourceKind="design"');
    expect(await dsl.inputValue()).toContain('address="aws_ecs_task_definition.main"');
    await page.getByRole('button', { name: '解析して反映', exact: true }).click();
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await node('task').locator('.resource-label').click();
    await expect(page.locator('.detail-panel')).toContainText('aws_ecs_task_definition.main');
    await expect(form.getByLabel('CPU (units)', { exact: true })).toHaveValue('1024');
  });
  test(`IAM Role・境界の選択後も矢印ラベルが前面で操作でき、AWS境界アイコンを表示する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
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
      await setArrowShape(page, shape);
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
      offline
        ? 'file://' + resolve('artifacts/observability.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
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
    await setArrowShape(page, 'bezier');
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
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
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
    const shape = page.getByRole('combobox', {
      name: '矢印の形',
      exact: true,
      includeHidden: true,
    });
    await setArrowShape(page, 'bezier');
    await expect.poll(async () => (await paths()).every((p) => p?.includes('C'))).toBe(true);
    expect(await viewport()).toBe(viewBefore);
    expect(await positions()).toEqual(nodesBefore);
    const label = page.getByRole('button', { name: /利用者 → Application Load Balancer/ });
    await label.click();
    await expect(label).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '選択を解除', exact: true }).click();
    await label.focus();
    await expect(label).toHaveAttribute('aria-pressed', 'true');
    await setArrowShape(page, 'orthogonal');
    await expect.poll(paths).toEqual(original);
    await expect(label).toHaveAttribute('aria-pressed', 'true');
    expect(await viewport()).toBe(viewBefore);
    await setArrowShape(page, 'bezier');
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
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
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
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
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
    await selectDetail(page, 'overview');
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
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
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
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/saas.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
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
  test(`主要62サービスのアイコンとブランドカラーを表示する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/service-catalog.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    if (!offline)
      await page.locator('input[type=file]').setInputFiles('examples/service-catalog.infra');
    await expect(page.locator('.canvas-footer')).toContainText('62 要素');
    const images = page.locator('.service-icon');
    await expect(images).toHaveCount(62);
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
    expect(renderedColors).toHaveLength(55);
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
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/saas.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
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
      const notices = page.locator('#infra-canvas-license-notices');
      await expect(notices).toBeHidden();
      await expect(notices).toContainText('MIT License');
      await expect(notices).toContainText('Eclipse Public License');
      await expect(notices).toContainText('TypeScript ThirdPartyNotices');
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
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
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
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await expect(page.locator('.canvas-footer')).toContainText('19 要素');
  await expect(page.locator('.react-flow__minimap-node')).toHaveCount(19);
  await selectDetail(page, 'overview');
  await expect(page.locator('.canvas-footer')).toContainText('5 要素');
  await page.getByRole('button', { name: '本番アカウントを展開', exact: true }).click();
  await expect(page.locator('.canvas-footer')).not.toContainText('5 要素');
  await selectSavedView(page, 'security');
  await expect(page.locator('.canvas-footer')).toContainText('22 要素');
  await page.getByRole('button', { name: '本番 VPCを折りたたむ', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="api"]')).toHaveCount(0);
  await page.getByRole('button', { name: '本番 VPCを展開', exact: true }).click();
  await expect(page.locator('.canvas-footer')).toContainText('22 要素');
  await page.getByRole('textbox', { name: 'リソース検索' }).fill('ECS API');
  await page.getByRole('button', { name: 'ECS API aws.ecs · api' }).click();
  await expect(page.locator('.detail-panel > h2')).toHaveText('ECS API');
  await expect(page.locator('.react-flow__node[data-id="api"]')).toHaveClass(/selected/);
  await expect(page.getByLabel('Subnet の ID', { exact: true })).toHaveValue(
    'private_a\nprivate_c',
  );
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
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
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
  await selectDetail(page, 'overview');
  await expect(page.locator('.canvas-footer')).toContainText('5 要素');
  await page.getByRole('textbox', { name: 'リソース検索' }).fill('PostgreSQL');
  await page.locator('.search-results button').click();
  await expect(page.locator('.detail-panel > h2')).toHaveText('PostgreSQL');
  await expect(page.locator('.react-flow__node[data-id="db"]')).toBeVisible();
  await page.screenshot({ path: 'artifacts/offline-html.png' });
  expect(requests).toEqual([]);
});
test('大規模・GCP Azure・複数クラウドの入力が実際に描画される', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.locator('input[type=file]').setInputFiles('examples/gcp-azure.infra');
  await expect(page.locator('.document-title')).toContainText('Google Cloud');
  await expect(page.locator('.canvas-footer')).toContainText('12 要素');
  await selectDetail(page, 'subnet');
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
      offline
        ? 'file://' + resolve('artifacts/ecs-beanstalk.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
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
      offline
        ? 'file://' + resolve('artifacts/transit-vpn.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
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
    await selectDetail(page, 'overview');
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
      offline
        ? 'file://' + resolve('artifacts/organizations.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
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
    await expect(page.getByLabel('meta.policyType', { exact: true })).toHaveValue(
      'SERVICE_CONTROL_POLICY',
    );
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

for (const offline of [false, true]) {
  test(`Nginx・Envoy のアイコンと設定を安全に表示・編集する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/proxies.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    if (!offline) await page.locator('input[type=file]').setInputFiles('examples/proxies.infra');
    await expect(page.locator('.canvas-footer')).toContainText('4 要素');
    for (const id of ['nginx', 'envoy']) {
      const node = page.locator(`.react-flow__node[data-id="${id}"]`);
      await expect(node.locator('.service-icon')).toHaveCount(1);
      await node.locator('.resource-label').click();
      await expect(page.getByLabel('サービス設定', { exact: true })).toHaveValue(/\n/);
    }
    const content = 'static_resources:\n# <script>window.configExecuted=true</script>\n';
    await page.getByLabel('サービス設定', { exact: true }).fill(content);
    await blurEditor(page);
    await expect(page.getByLabel('サービス設定', { exact: true })).toHaveValue(content);
    await expect(page.locator('.detail-panel script')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).configExecuted),
    ).toBeUndefined();
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    expect(await page.getByLabel('DSL 入力').inputValue()).toContain(JSON.stringify(content));
  });
}

for (const reference of [
  'aws-web',
  'gcp-delivery',
  'azure-private-link',
  'cloudfront-websocket',
  'centralized-inspection',
  'eks-single-account-single-cluster',
  'eks-single-account-multi-cluster',
  'eks-multi-account-single-cluster',
  'eks-multi-account-multi-cluster',
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
    if (reference === 'centralized-inspection') {
      await expect(page.getByRole('table', { name: 'Inspection TGW routes' })).toContainText(
        '10.100.6.0/24',
      );
      await page.getByRole('table', { name: 'Inspection TGW routes' }).click();
      await expect(page.locator('.detail-panel')).toContainText('Inspection TGW routes');
    }
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await page.locator('.react-flow__viewport').evaluate(async () => {
      for (let i = 0; i < 35; i++) await new Promise(requestAnimationFrame);
    });
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
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
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
      await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
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
    // Fit View中も親子の座標を同じフレームで比較する。
    await expect
      .poll(() =>
        meta('tokyo').evaluate((element) => {
          const child = element
            .closest('.react-flow')!
            .querySelector('.react-flow__node[data-id="main"]')!;
          return element.getBoundingClientRect().bottom - child.getBoundingClientRect().top;
        }),
      )
      .toBeLessThan(0);
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
    await selectDetail(page, 'overview');
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

for (const offline of [false, true]) {
  test(`7種類の接続を色と線種で区別し、凡例・矢印・ラベル・編集を同期する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const kinds = [
      'traffic',
      'dependency',
      'auth',
      'deploy',
      'association',
      'replication',
      'failover',
    ];
    const labels = ['通信', '依存', '認証', 'デプロイ', '関連', '複製', '切替'];
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await page.getByRole('textbox', { name: 'DSL 入力' }).fill(`diagram "線種の比較" {
      aws.ecs source "送信元"
      ${kinds.map((kind, i) => `aws.rds target${i} "接続先${i}"\nsource -> target${i} kind=${kind}`).join('\n')}
    }`);
    await page.getByRole('button', { name: '解析して反映', exact: true }).click();
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await expect(page.locator('.connection-label')).toHaveCount(7);
    if (!offline) {
      await page.locator('.react-flow__controls-fitview').click();
      await page.screenshot({ path: 'artifacts/connection-kinds.png' });
    }
    const colors: string[] = [];
    const patterns: string[] = [];
    for (const [index, kind] of kinds.entries()) {
      const label = page.locator(`.connection-label[data-kind="${kind}"]`);
      const legend = page.locator(`.edge-legend [data-kind="${kind}"]`);
      await expect(label).toHaveText(labels[index]!);
      await expect(legend).toHaveText(labels[index]!);
      const color = await legend.evaluate((el) => getComputedStyle(el).color);
      colors.push(color);
      await expect(label).toHaveCSS('color', color);
      await expect(label).toHaveCSS('border-left-color', color);
      const edge = page.locator('.react-flow__edge').filter({
        has: page.locator(`path[style*="${color}"]`),
      });
      await expect(edge).toHaveCount(1);
      const path = edge.locator('.react-flow__edge-path');
      await expect(path).toHaveCSS('stroke', color);
      const dash = await path.evaluate((el) => getComputedStyle(el).strokeDasharray);
      patterns.push(dash);
      const legendDash = await legend
        .locator('path')
        .first()
        .evaluate((el) => getComputedStyle(el).strokeDasharray);
      expect(dash).toBe(legendDash);
      const markerColor = await path.evaluate((el) => {
        const ref = el.getAttribute('marker-end')!;
        const id = ref.slice(ref.indexOf('#') + 1).replace(/["')]/g, '');
        return getComputedStyle(document.getElementById(id)!.querySelector('polyline')!).stroke;
      });
      expect(markerColor).toBe(color);
      await label.click();
      await expect(label).toHaveCSS('color', color);
      await expect(path).toHaveCSS('stroke', color);
    }
    expect(new Set(colors).size).toBe(7);
    expect(new Set(patterns).size).toBe(7);
    await setArrowShape(page, 'bezier');
    await expect(page.locator('.connection-label[data-kind="failover"]')).toHaveCSS(
      'color',
      colors[6]!,
    );
    await page.locator('.connection-editor summary').click();
    const form = page.locator('.connection-editor form');
    await expect(form.getByLabel('接続の種類')).toHaveValue('failover');
    await form.getByLabel('接続の種類').selectOption('replication');
    await blurEditor(page);
    await expect(page.locator('.connection-label[data-kind="replication"]')).toHaveCount(2);
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    const restored = parseDSL(await page.getByRole('textbox', { name: 'DSL 入力' }).inputValue());
    expect(restored.diagnostics).toEqual([]);
    expect(
      restored.diagram!.connections.filter((edge) => edge.kind === 'replication'),
    ).toHaveLength(2);
  });
}

for (const offline of [false, true]) {
  test(`線種の意味をキーボードと狭い画面で参照でき、視点を保持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await expect(page.locator('.connection-label').first()).toBeVisible();
    const viewport = page.locator('.react-flow__viewport');
    await viewport.evaluate(async () => {
      for (let frame = 0; frame < 35; frame++) await new Promise(requestAnimationFrame);
    });
    const before = await viewport.getAttribute('style');
    const summary = page.locator('.connection-help summary');
    const panel = page.getByRole('region', { name: '線種の意味と例' });
    await expect(panel).toBeHidden();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    const labels = ['通信', '依存', '認証', 'デプロイ', '関連', '複製', '切替'];
    const patterns = ['実線', '破線', '一点鎖線', '長い破線', '点線', '二点鎖線', '短い破線'];
    for (const [index, row] of (await panel.locator('dl > div').all()).entries()) {
      await expect(row.locator('dt')).toContainText(labels[index]!);
      await expect(row.locator('dt')).toContainText(patterns[index]!);
      await expect(row.locator('dd')).toContainText('例：');
      const kind = await row.getAttribute('data-kind');
      const legend = page.locator(`.edge-legend [data-kind="${kind}"]`);
      expect(await row.locator('svg path').first().getAttribute('stroke-dasharray')).toBe(
        await legend.locator('svg path').first().getAttribute('stroke-dasharray'),
      );
    }
    await expect(panel.locator('dl > div')).toHaveCount(7);
    await expect(panel).toContainText('通信の成立は示しません');
    await expect(panel).toContainText('実効権限は示しません');
    await expect(viewport).toHaveAttribute('style', before!);
    if (!offline) await page.screenshot({ path: 'artifacts/connection-help.png' });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(summary).toBeFocused();
    await page.setViewportSize({ width: 640, height: 720 });
    await expect(page.locator('.edge-legend')).toBeHidden();
    await expect(summary).toBeVisible();
    await summary.click();
    await expect(panel).toBeVisible();
    await expect(page.locator('.edge-legend')).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(640);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
    await page.setViewportSize({ width: 320, height: 520 });
    const traffic = panel.locator('.edge-legend-item[data-kind="traffic"]');
    await traffic.focus();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('通信やデータの流れ');
    const content = panel.locator('.connection-help-content');
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const tipBounds = (await tooltip.boundingBox())!;
    expect(tipBounds.x).toBeGreaterThanOrEqual(0);
    expect(tipBounds.x + tipBounds.width).toBeLessThanOrEqual(320);
    expect(tipBounds.y + tipBounds.height).toBeLessThanOrEqual(520);
    // 表示領域が小さくても、説明がスクロール領域に切り取られない。
    expect(
      await tooltip.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return [0.1, 0.9].every((ratio) =>
          element.contains(
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height * ratio),
          ),
        );
      }),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
}

for (const offline of [false, true]) {
  test(`凡例の意味をホバーとフォーカスで確認し、Escapeで閉じる (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    await page.getByRole('button', { name: '配置を移動', exact: true }).click();
    const info = page.getByRole('group', { name: '接続・囲み', exact: true });
    const infoBounds = (await info.boundingBox())!;
    const canvasBounds = (await page.locator('.canvas-area > .react-flow').boundingBox())!;
    expect(infoBounds.y + infoBounds.height).toBeLessThanOrEqual(canvasBounds.y);
    const hintBounds = (await page.locator('.layout-help').boundingBox())!;
    expect(hintBounds.y + hintBounds.height).toBeLessThanOrEqual(canvasBounds.y);
    await page.locator('.connection-help summary').click();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveCount(0);
    const meanings = [
      ['traffic', '通信 · 実線', '通信やデータの流れ'],
      ['dependency', '依存 · 破線', 'リソースや設定を必要とする関係'],
      ['auth', '認証 · 一点鎖線', '認証・認可に関する関係'],
      ['deploy', 'デプロイ · 長い破線', '配備・更新する流れ'],
      ['association', '関連 · 点線', '所属・関連付け・設定上の関連'],
      ['replication', '複製 · 二点鎖線', '接続先へ複製する流れ'],
      ['failover', '切替 · 短い破線', '待機系へ切り替える関係'],
    ];
    for (const [kind, heading, meaning] of meanings) {
      const item = page.locator(`.edge-legend-item[data-kind="${kind}"]`);
      await item.hover();
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText(heading!);
      await expect(tooltip).toContainText(meaning!);
      await expect(item).toHaveAttribute('aria-describedby', 'connection-legend-tooltip');
      const bounds = await tooltip.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1440);
      expect(bounds!.y).toBeGreaterThanOrEqual(infoBounds.y + infoBounds.height);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
      // 可視判定だけでは他要素に覆われる不具合を検出できないため、実際の最前面を調べる。
      expect(
        await tooltip.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return [0.2, 0.8].every((ratio) =>
            element.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height * ratio),
            ),
          );
        }),
      ).toBe(true);
      await page.mouse.move(20, 80);
      await expect(tooltip).toHaveCount(0);
      await item.focus();
      await expect(tooltip).toContainText(meaning!);
      await page.keyboard.press('Escape');
      await expect(tooltip).toHaveCount(0);
      await expect(item).toBeFocused();
      await page.getByRole('button', { name: 'DSL を編集', exact: true }).focus();
      await expect(tooltip).toHaveCount(0);
    }
    await page.locator('.edge-legend-item[data-kind="traffic"]').hover();
    await tooltip.hover();
    await expect(tooltip).toContainText('通信 · 実線');
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(20, 80);
    await page.locator('.edge-legend-item[data-kind="traffic"]').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.edge-legend-item[data-kind="dependency"]')).toBeFocused();
    await expect(tooltip).toContainText('依存 · 破線');
    if (!offline) await page.screenshot({ path: 'artifacts/connection-legend-tooltip.png' });
  });
}

for (const offline of [false, true]) {
  test(`凡例で接続種別を切り替え、フィルター・保存ビューと同期し視点を保持する (${offline ? 'HTML' : '開発画面'})`, async ({
    page,
    context,
  }) => {
    if (offline) await context.setOffline(true);
    await page.goto(
      offline
        ? 'file://' + resolve('artifacts/aws.html')
        : `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`,
    );
    const kinds = [
      'traffic',
      'dependency',
      'auth',
      'deploy',
      'association',
      'replication',
      'failover',
    ];
    const labels = ['通信', '依存', '認証', 'デプロイ', '関連', '複製', '切替'];
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await page.getByRole('textbox', { name: 'DSL 入力' }).fill(`diagram "凡例のフィルター" {
      aws.ecs source "送信元"
      ${kinds.map((kind, index) => `aws.rds target${index} "接続先${index}"\n${index === 0 ? 'source' : `target${index - 1}`} -> target${index} kind=${kind} route=web step=${index + 1} purpose=application`).join('\n')}
      aws.rds other "別経路"
      source -> other route=other step=1 purpose=data
      view saved label="保存した通信経路" level=resource kinds=[traffic] routes=[web] purposes=[application]
    }`);
    await page.getByRole('button', { name: '解析して反映', exact: true }).click();
    await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
    await expect(page.locator('.diagnostics')).toHaveCount(0);
    await expect(page.locator('.connection-label[data-kind="association"]')).toHaveCount(1);
    await expect(page.locator('.connection-label')).toHaveCount(8);
    const viewport = page.locator('.react-flow__viewport');
    await viewport.evaluate(async () => {
      for (let frame = 0; frame < 35; frame++) await new Promise(requestAnimationFrame);
    });
    await page.locator('.react-flow__controls-zoomout').click();
    await page.mouse.move(600, 400);
    await page.mouse.wheel(100, 0);
    const before = await viewport.getAttribute('style');
    await page.locator('.connection-help summary').click();
    for (const [index, kind] of kinds.entries()) {
      const button = page
        .locator('.edge-legend')
        .getByRole('button', { name: labels[index]!, exact: true });
      const checkbox = page.getByRole('checkbox', {
        name: labels[index]!,
        exact: true,
        includeHidden: true,
      });
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await page.locator('.connection-help summary').click();
      await page.locator(`.connection-label[data-kind="${kind}"]`).first().click();
      await expect(page.locator('.connection-editor')).toBeVisible();
      await page.locator('.connection-help summary').click();
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(checkbox).not.toBeChecked();
      await expect(page.locator(`.connection-label[data-kind="${kind}"]`)).toHaveCount(0);
      await expect(page.locator('.connection-editor')).toHaveCount(0);
      await expect(viewport).toHaveAttribute('style', before!);
      await button.press(index % 2 === 0 ? 'Enter' : 'Space');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(checkbox).toBeChecked();
      await expect(page.locator('.connection-label')).toHaveCount(8);
      await expect(viewport).toHaveAttribute('style', before!);
    }
    const traffic = page.locator('.edge-legend').getByRole('button', { name: '通信', exact: true });
    await setDisplayOptions(page, true);
    await page.getByRole('checkbox', { name: '通信', exact: true }).uncheck();
    await setDisplayOptions(page, false);
    await expect(traffic).toHaveAttribute('aria-pressed', 'false');
    await traffic.click();
    await expect(
      page.getByRole('checkbox', { name: '通信', exact: true, includeHidden: true }),
    ).toBeChecked();
    for (const label of labels)
      await page.locator('.edge-legend').getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('.connection-label')).toHaveCount(0);
    await expect(page.locator('.canvas-footer')).toContainText('0 接続');
    await traffic.click();
    await expect(page.locator('.connection-label')).toHaveCount(2);
    await selectSavedView(page, 'saved');
    await expect(page.locator('.connection-label')).toHaveCount(1);
    const replication = page
      .locator('.edge-legend')
      .getByRole('button', { name: '複製', exact: true });
    await expect(replication).toHaveAttribute('aria-pressed', 'false');
    await replication.click();
    await expect(page.locator('.connection-label')).toHaveCount(2);
    await expect(page.locator('.connection-label[data-kind="replication"]')).toHaveCount(1);
    await traffic.click();
    await expect(page.locator('.connection-label')).toHaveCount(1);
    await selectSavedView(page, 'service');
    await expect(page.locator('.connection-label')).toHaveCount(8);
    for (const label of labels)
      await expect(
        page.locator('.edge-legend').getByRole('button', { name: label, exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
    if (!offline) {
      await traffic.click();
      await page.mouse.move(20, 80);
      await page.screenshot({ path: 'artifacts/connection-legend-filter.png' });
    }
  });
}
