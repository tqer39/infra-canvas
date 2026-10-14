import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const samples = [
  {
    name: 'gcp-web',
    title: 'Google Cloud・Cloud Run Web アプリ',
    target: 'web',
    label: 'Cloud Run Web API',
  },
  {
    name: 'gcp-analytics',
    title: 'Google Cloud・イベント分析',
    target: 'warehouse',
    label: 'BigQuery イベントテーブル',
  },
  {
    name: 'azure-web',
    title: 'Azure・App Service Web アプリ',
    target: 'web',
    label: 'App Service Web API',
  },
  {
    name: 'azure-functions',
    title: 'Azure・Blob アップロードの非同期処理',
    target: 'resize',
    label: 'Azure Functions 画像変換',
  },
];

for (const sample of samples) {
  for (const offline of [false, true]) {
    test(`${sample.name}: 読み込み・ビュー切替・検索 (${offline ? 'HTML' : '開発画面'})`, async ({
      page,
      context,
      baseURL,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      if (offline) await context.setOffline(true);
      await page.goto(
        offline
          ? 'file://' + resolve(`artifacts/${sample.name}.html`)
          : (baseURL ?? 'http://127.0.0.1:5188'),
      );
      if (!offline)
        await page.locator('input[type=file]').setInputFiles(`examples/${sample.name}.infra`);
      await expect(page.locator('.document-title')).toHaveText(sample.title);
      await expect(page.locator(`.react-flow__node[data-id="${sample.target}"]`)).toBeVisible();
      for (const view of ['概要', 'サービス', 'ネットワーク', 'セキュリティ']) {
        await page.getByRole('button', { name: view, exact: true }).click();
        await expect(page.locator('.react-flow__node')).not.toHaveCount(0);
      }
      await page.getByRole('button', { name: 'すべて折りたたむ', exact: true }).click();
      await expect(page.locator(`.react-flow__node[data-id="${sample.target}"]`)).toHaveCount(0);
      await page.getByRole('textbox', { name: 'リソース検索' }).fill(sample.label);
      await page.locator('.search-results button').click();
      await expect(page.locator('.detail-panel > h2')).toHaveText(sample.label);
      await expect(page.locator(`.react-flow__node[data-id="${sample.target}"]`)).toBeVisible();
      await page.getByRole('button', { name: 'Fit View' }).click();
      await page.screenshot({
        path: `artifacts/${sample.name}-${offline ? 'html' : 'dev'}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  }
}
