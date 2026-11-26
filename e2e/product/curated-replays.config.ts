import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'curated-replays.spec.ts',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:14231',
    viewport: { width: 1440, height: 900 },
    browserName: 'chromium',
    channel: 'chromium',
    colorScheme: 'dark',
  },
  webServer: {
    command: 'bun run preview --host 127.0.0.1 --port 14231 --strictPort',
    url: 'http://127.0.0.1:14231',
    reuseExistingServer: false,
  },
})
