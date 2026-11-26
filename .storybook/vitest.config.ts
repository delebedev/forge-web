import { fileURLToPath } from 'node:url'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from '../vite.config'

// Renders every story in headless Chromium and runs its play function; a failing check fails the run.
// Stories make no product requests; without a backend the dev proxy would only log refused image loads.
const { proxy: _proxy, ...server } = viteConfig.server ?? {}

export default mergeConfig(
  { ...viteConfig, server },
  defineConfig({
    plugins: [storybookTest({ configDir: fileURLToPath(new URL('.', import.meta.url)) })],
    test: {
      name: 'storybook',
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({ launchOptions: { channel: 'chromium' } }),
        instances: [{ browser: 'chromium' }],
      },
    },
  }),
)
