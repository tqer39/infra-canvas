import { test as base, expect } from '@playwright/test';
import { navigateWithNetworkRecovery } from './navigation';

export const test = base.extend({
  page: async ({ page }, use) => {
    const navigate = page.goto.bind(page);
    page.goto = (url, options) => navigateWithNetworkRecovery(page, navigate, url, options);
    await use(page);
  },
});
export { expect };
export type { Page } from '@playwright/test';
