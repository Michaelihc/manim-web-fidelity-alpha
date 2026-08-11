import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/integration',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    // This repository is a Vite MPA: `/` intentionally has no index and
    // returns 404, so probe the actual ESAP entrypoint for readiness.
    url: 'http://localhost:5173/examples/esap_review.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
