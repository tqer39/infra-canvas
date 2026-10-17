import { test, expect } from './fixtures';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDSL } from '../../src/core/parser';
import { validateDiagram } from '../../src/core/validate';
import { buildDisplayGraph } from '../../src/core/display';

// ファイル一覧を独立して確認し、追加したサンプルのメニュー登録漏れを検出する。
const samples = readdirSync('examples', { recursive: true })
  .filter((name): name is string => typeof name === 'string' && name.endsWith('.infra'))
  .map((name) => {
    const diagram = validateDiagram(parseDSL(readFileSync(`examples/${name}`, 'utf8')).diagram);
    const id = name === 'subnet-security.infra' ? 'subnetSecurity' : name.replace(/\.infra$/, '');
    const graph = buildDisplayGraph(diagram, { view: 'service' });
    return {
      id,
      title: diagram.title,
      diagnostics: diagram.diagnostics,
      nodes: [...graph.resources, ...(graph.notes ?? [])].map((resource) => resource.id),
    };
  });

for (const offline of [false, true]) {
  for (const sample of samples) {
    test(`サンプルメニュー: ${sample.id} (${offline ? 'オフラインHTML' : '開発画面'})`, async ({
      page,
      context,
      baseURL,
    }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      if (offline) await context.setOffline(true);
      await page.goto(
        offline
          ? 'file://' + resolve('artifacts/aws.html')
          : (baseURL ?? `http://127.0.0.1:${process.env.INFRA_TEST_PORT ?? '5188'}`),
      );
      const picker = page.getByRole('combobox', { name: 'サンプル', exact: true });
      await expect(picker.locator('optgroup')).toHaveCount(7);
      await expect(picker.locator('option')).toHaveCount(samples.length + 1);
      await picker.selectOption(sample.id);
      await expect(page.locator('.document-title')).toHaveText(sample.title);
      await expect(page.locator('.layout-status')).toHaveCount(0);
      await expect(page.locator('.react-flow__node')).toHaveCount(sample.nodes.length);
      expect(
        await page
          .locator('.react-flow__node')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')).sort()),
      ).toEqual([...sample.nodes].sort());
      await expect(picker).toHaveValue('');
      expect(sample.diagnostics).toEqual([]);
      await expect(page.locator('.diagnostics')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}
