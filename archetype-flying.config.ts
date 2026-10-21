import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  testMatch: /gre-archetype-flying-probe\.spec\.ts/,
  workers: 1,
})
