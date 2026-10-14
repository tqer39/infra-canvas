import { defineConfig } from '@playwright/test';
const port = process.env.INFRA_TEST_PORT ?? '5188';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  fullyParallel: false,
  use: { viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  outputDir: 'artifacts/browser-results',
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
