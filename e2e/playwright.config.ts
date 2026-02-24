import { defineConfig } from '@playwright/test';

const TEST_PORT = 3001;

export default defineConfig({
  testDir: '.',
  timeout: 15_000,
  retries: 0,
  workers: 1, // serial — single test server

  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],

  webServer: {
    command: `npx tsx e2e/test-server.ts`,
    cwd: '..',
    port: TEST_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
