import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
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
