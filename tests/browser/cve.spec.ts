import { test, expect } from './fixtures';

test('CVE 一覧を保存し、未反映の下書きを守りながら根拠付きの図を開く', async ({ page }) => {
  await page.route('https://services.nvd.nist.gov/rest/json/cves/2.0**', async (route) => {
    await route.fulfill({
      json: {
        totalResults: 1,
        startIndex: 0,
        vulnerabilities: [
          {
            cve: {
              id: 'CVE-2026-12345',
              published: '2026-10-30T00:00:00.000',
              lastModified: '2026-10-30T12:00:00.000',
              vulnStatus: 'Awaiting Analysis',
              descriptions: [{ lang: 'en', value: 'A vulnerability in Example Library.' }],
              affected: [
                {
                  source: 'CNA',
                  affectedData: [
                    {
                      vendor: 'Example',
                      product: 'Library',
                      versions: [{ version: '1.0', status: 'affected' }],
                    },
                  ],
                },
              ],
              references: [{ url: 'https://example.org/advisory' }],
            },
          },
        ],
      },
    });
  });
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: '脆弱性情報', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '脆弱性情報' });
  await panel.getByRole('button', { name: '直近7日間を取得' }).click();
  await expect(panel).toContainText('1 件（このブラウザーに保存）');
  await page.reload();
  await page.getByRole('button', { name: '脆弱性情報', exact: true }).click();
  await panel.getByRole('button', { name: /CVE-2026-12345/ }).click();
  await expect(panel).toContainText('A vulnerability in Example Library.');
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'DSL 入力' });
  const draft = (await editor.inputValue()) + '\n# 下書き';
  await editor.fill(draft);
  await panel.getByRole('button', { name: 'この情報の図を開く' }).click();
  await expect(page.getByRole('alert')).toContainText('未反映の変更');
  await expect(editor).toHaveValue(draft);
  await editor.fill(draft.replace('\n# 下書き', ''));
  await panel.getByRole('button', { name: 'この情報の図を開く' }).click();
  await expect(page.locator('.document-title')).toContainText('CVE-2026-12345');
  await expect(page.locator('.react-flow__node[data-id="product_0"]')).toContainText(
    'Example / Library',
  );
  await expect(page.locator('.annotation-card')).toContainText(
    'A vulnerability in Example Library.',
  );
  await expect(editor).toHaveValue(/nvd\.nist\.gov\/vuln\/detail\/CVE-2026-12345/);
});

test('保存済み一覧を読み込み、不正なファイルは現在の一覧を維持する', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: '脆弱性情報', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '脆弱性情報' });
  const input = panel.locator('input[type=file]');
  await input.setInputFiles({
    name: 'snapshot.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        start: 'start',
        end: 'end',
        fetchedAt: 'now',
        records: [
          {
            id: 'CVE-2026-12345',
            published: 'date',
            modified: 'date',
            status: 'Published',
            description: 'Test',
            products: [],
            references: [],
          },
        ],
      }),
    ),
  });
  await expect(panel).toContainText('CVE-2026-12345');
  await input.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"records":[]}'),
  });
  await expect(panel.getByRole('status')).toContainText('形式');
  await expect(panel).toContainText('CVE-2026-12345');
});

test('対象 CVE の確認済み事例を一覧から開き、条件と出典を表示できる', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: '脆弱性情報', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '脆弱性情報' });
  await panel.locator('input[type=file]').setInputFiles({
    name: 'snapshot.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        start: 'start',
        end: 'end',
        fetchedAt: 'now',
        records: [
          {
            id: 'CVE-2026-115188',
            published: 'date',
            modified: 'date',
            status: 'Published',
            description: 'test',
            products: [],
            references: [],
          },
        ],
      }),
    ),
  });
  await panel.getByRole('button', { name: /CVE-2026-115188/ }).click();
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'DSL 入力' });
  const original = await editor.inputValue();
  await editor.fill(original + '\n# 下書き');
  await panel.getByRole('button', { name: '根拠付きの攻撃経路を開く' }).click();
  await expect(page.getByRole('alert')).toContainText('未反映の変更');
  await expect(editor).toHaveValue(original + '\n# 下書き');
  await editor.fill(original);
  await page.getByRole('button', { name: '診断を閉じる' }).click();
  await panel.getByRole('button', { name: '根拠付きの攻撃経路を開く' }).click();
  await expect(page.locator('.document-title')).toContainText('CVE-2026-115188');
  await expect(page.locator('.react-flow__node[data-id="media"]')).toContainText(
    '公開メディア領域',
  );
  await expect(page.locator('.annotation-card[data-note-id="assumptions"]')).toContainText(
    'コード実行には',
  );
  await expect(editor).toHaveValue(/GHSA-mxjf-pghx-h299/);
  await expect(editor).toHaveValue(/実行可能な構成の場合/);
});

test('別リポジトリの GHSA 一覧を読み込み、CVE 以外を出典付きで図にする', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`);
  await page.getByRole('button', { name: '脆弱性情報', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '脆弱性情報' });
  await panel.locator('input[type=file]').setInputFiles({
    name: 'catalog.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schema: 'vulnerability-catalog/v1',
        start: '2026-10-24',
        end: '2026-10-31',
        exportedAt: '2026-10-31',
        dateField: 'published',
        records: [
          {
            id: 'GHSA-aaaa-bbbb-cccc',
            source: 'github',
            sourceUrl: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
            aliases: [],
            published: '2026-10-25',
            modified: '2026-10-26',
            status: 'reviewed',
            description: 'Package issue',
            products: [
              {
                vendor: '',
                product: 'example-package',
                ecosystem: 'npm',
                versions: ['影響範囲: < 2'],
                source: 'GitHub Advisory Database',
              },
            ],
            references: ['https://example.org/advisory'],
          },
        ],
      }),
    ),
  });
  await panel.getByRole('button', { name: /GHSA-aaaa-bbbb-cccc/ }).click();
  await expect(panel).toContainText('情報源: github');
  await expect(panel.getByRole('link', { name: '情報源の原資料' })).toHaveAttribute(
    'href',
    'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
  );
  await panel.getByRole('button', { name: 'この情報の図を開く' }).click();
  await expect(page.locator('.document-title')).toContainText('GHSA-aaaa-bbbb-cccc');
  await expect(page.locator('.react-flow__node[data-id="product_0"]')).toContainText(
    'example-package',
  );
  await page.getByRole('button', { name: 'DSL を編集', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'DSL 入力' })).toHaveValue(
    /github\.com\/advisories\/GHSA-aaaa-bbbb-cccc/,
  );
});
