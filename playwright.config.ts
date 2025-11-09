import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/system',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
