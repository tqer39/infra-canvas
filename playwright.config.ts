import { defineConfig } from '@playwright/test';
const port = process.env.INFRA_TEST_PORT ?? '5188';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  globalSetup: './tests/browser/global-setup.ts',
  fullyParallel: true,
  workers: 2,
  use: { viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  outputDir: 'artifacts/browser-results',
  webServer: {
    // Playwrightがサーバーの終了を管理できるようにNodeを直接起動する。
    command: `mise exec -- node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
