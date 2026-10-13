import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  globalSetup: './tests/browser/global-setup.ts',
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
  use: { viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  outputDir: 'artifacts/browser-results',
  webServer: {
    // タスクランナーの子プロセス分離を避け、Playwright がサーバー全体を終了できるようにする。
    command: 'mise exec -- node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5188',
    url: 'http://127.0.0.1:5188',
    reuseExistingServer: false,
  },
});
