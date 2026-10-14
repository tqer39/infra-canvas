import type { Page } from '@playwright/test';

export async function setDisplayOptions(page: Page, open: boolean): Promise<void> {
  const button = page.getByRole('button', { name: '表示オプション', exact: true });
  if ((await button.getAttribute('aria-expanded')) !== String(open)) await button.click();
}

export async function selectDetail(page: Page, level: string): Promise<void> {
  const select = page.getByRole('combobox', { name: '構成の詳しさ', exact: true });
  await select.selectOption(level);
  await select.evaluate((element) => (element as HTMLSelectElement).blur());
}

export async function selectSavedView(page: Page, id: string): Promise<void> {
  const open = await page
    .getByRole('button', { name: '表示オプション', exact: true })
    .getAttribute('aria-expanded');
  await setDisplayOptions(page, true);
  await expandDisplaySection(page, '保存した表示');
  await page.getByRole('combobox', { name: '保存した表示', exact: true }).selectOption(id);
  await setDisplayOptions(page, open === 'true');
}

export async function expandDisplaySection(page: Page, title: string): Promise<void> {
  await setDisplayOptions(page, true);
  const section = page.locator('.display-filters details').filter({
    has: page.locator('summary').filter({ hasText: title }),
  });
  if ((await section.getAttribute('open')) === null) await section.locator('summary').click();
}

export async function toggleArrowShape(page: Page): Promise<void> {
  await setDisplayOptions(page, true);
  const shape = page.getByRole('combobox', { name: '矢印の形', exact: true });
  await shape.selectOption((await shape.inputValue()) === 'bezier' ? 'orthogonal' : 'bezier');
  await setDisplayOptions(page, false);
}

export async function toggleMembership(page: Page): Promise<void> {
  await setDisplayOptions(page, true);
  const membership = page.getByRole('checkbox', { name: '追加の囲み', exact: true });
  await membership.setChecked(!(await membership.isChecked()));
  await setDisplayOptions(page, false);
}
