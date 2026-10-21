import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'

import { managedPorts } from './scripts/lib/playwright-ports'

const suite = process.env['FORGE_WEB_PLAYWRIGHT_SUITE']

const IPAD_VIEWPORT = { width: 1024, height: 1366 }

const standaloneConfig = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
    // 2× for retina-quality screenshots
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /screenshots\.spec\.ts/,
      use: { browserName: 'chromium', channel: 'chromium' },
    },
    {
      name: 'ipad',
      testMatch: /screenshots\.spec\.ts/,
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        viewport: IPAD_VIEWPORT,
      },
    },
    {
      // Specs navigate relative to `baseURL`; against an already-running stack
      // that is Leyline serving the built bundle rather than the Vite port.
      name: 'gre',
      testMatch:
        /gre-(?:play|prompts|optional-shuffle|mulligan|recovery|priority|sounds|cost-choice|equip-cost|repeatable-cost|alternate-life-cost|modal-cancel|search-owner|library-permissions|partner-decks|known-opponent-hand|warp|player-counters|mana-payment|protection-mixed|proliferate)\.spec\.ts/,
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:8080',
      },
    },
  ],
  // Expect servers already running.
  webServer: undefined,
})

function makeSmokeConfig({
  name,
  testMatch,
  timeout,
  frontendPort,
  webPort,
  invalidCardDb = false,
  builtFrontendPort,
}: {
  name: string
  testMatch: string | RegExp
  timeout: number
  frontendPort: number
  webPort: number
  invalidCardDb?: boolean
  builtFrontendPort?: number
}): PlaywrightTestConfig {
  if (suite === name) {
    const ports = managedPorts({
      frontend: frontendPort,
      backend: webPort,
      ...(builtFrontendPort ? { preview: builtFrontendPort } : {}),
    })
    frontendPort = ports.frontend
    webPort = ports.backend
    builtFrontendPort = ports.preview
  }
  // Env names are ServerConfigResolver's mechanical section.field -> LEYLINE_SECTION_FIELD
  // mapping (e.g. web.port -> LEYLINE_WEB_PORT). paths.state isolates each suite's
  // player.db under a throwaway directory instead of the shared dev state dir.
  const stateDir =
    process.env['FORGE_WEB_PLAYWRIGHT_STATE_DIR'] ??
    `/tmp/forge-web-${name}-${webPort}-${process.pid}-${Date.now()}-state`
  const cardDb = invalidCardDb ? 'LEYLINE_CARD_DB=/dev/null/forge-card-db.sqlite ' : ''
  const serverCommand = process.env['FORGE_WEB_SERVER_DIST']
    ? 'bash scripts/run-ci-server.sh'
    : './leyline/gradlew :server:run'
  const serverLog = `/tmp/forge-web-${name}-${webPort}-${process.pid}-web.log`
  const webCommand = `bash -lc 'set -o pipefail; ${cardDb}LEYLINE_WEB_PORT=${webPort} LEYLINE_WEB_LOGIN_CODE=123456 LEYLINE_WEB_ALLOW_FIXED_LOGIN_CODE=true LEYLINE_WEB_DEV_TOOLS=true LEYLINE_WEB_AUTH_SECRET=forge-web-${name}-test-secret-1234567890 LEYLINE_WEB_REPLAY_OPERATOR_TOKEN=forge-web-${name}-operator-secret-1234567890 LEYLINE_PATHS_STATE="${stateDir}" ${serverCommand} 2>&1 | tee ${serverLog} >&2'`

  return defineConfig({
    metadata: { serverLog },
    testDir: './e2e',
    testMatch,
    timeout,
    retries: 0,
    reporter: process.env['FORGE_CI_REPORT_DIR']
      ? [
          ['line'],
          ['junit', { outputFile: `${process.env['FORGE_CI_REPORT_DIR']}/${name}/junit.xml` }],
          ['json', { outputFile: `${process.env['FORGE_CI_REPORT_DIR']}/${name}/timings.json` }],
        ]
      : [['list']],
    use: {
      baseURL: `http://127.0.0.1:${frontendPort}`,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      trace: 'retain-on-failure',
    },
    projects: [
      {
        name: 'chromium',
        use: { browserName: 'chromium', channel: 'chromium' },
      },
    ],
    webServer: [
      {
        command: webCommand,
        url: `http://127.0.0.1:${webPort}/openapi.json`,
        timeout: 120_000,
        reuseExistingServer: false,
      },
      {
        command: `LEYLINE_WEBDOOR_URL=http://127.0.0.1:${webPort} node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${frontendPort} --strictPort`,
        url: `http://127.0.0.1:${frontendPort}`,
        timeout: 60_000,
        reuseExistingServer: false,
      },
      ...(builtFrontendPort
        ? [
            {
              command: `${process.env['FORGE_WEB_FRONTEND_DIST'] ? '' : 'bun run build && '}LEYLINE_WEBDOOR_URL=http://127.0.0.1:${webPort} node node_modules/vite/bin/vite.js preview --outDir ${process.env['FORGE_WEB_FRONTEND_DIST'] ?? 'dist'} --host 127.0.0.1 --port ${builtFrontendPort} --strictPort`,
              url: `http://127.0.0.1:${builtFrontendPort}`,
              timeout: 60_000,
              reuseExistingServer: false,
            },
          ]
        : []),
    ],
  })
}

const challengeVideoBase = makeSmokeConfig({
  name: 'challenge-video',
  testMatch: /mobile-challenge-video\.spec\.ts/,
  timeout: 90_000,
  frontendPort: 4173,
  webPort: 8173,
})

const reactChallengeBase = makeSmokeConfig({
  name: 'react-challenge',
  testMatch: /react-challenge\.spec\.ts/,
  timeout: 90_000,
  frontendPort: 15175,
  webPort: 15185,
})

const greBase = makeSmokeConfig({
  name: 'gre',
  testMatch:
    /gre-(?:play|prompts|optional-shuffle|mulligan|recovery|priority|sounds|cost-choice|affinity-cost|combat-assignments|equip-cost|repeatable-cost|alternate-life-cost|modal-cancel|search-owner|library-permissions|partner-decks|known-opponent-hand|warp|player-counters|mana-payment|protection-mixed|proliferate)\.spec\.ts/,
  // Managed runs serve the app from Vite rather than a built bundle, so the
  // first scenarios absorb on-demand transforms on top of engine warmup.
  timeout: 90_000,
  frontendPort: 15176,
  webPort: 15186,
})

const screenshotsBase = makeSmokeConfig({
  name: 'screenshots',
  testMatch: /screenshots\.spec\.ts/,
  timeout: 60_000,
  frontendPort: 15177,
  webPort: 15187,
})

const forgeCatalogBase = makeSmokeConfig({
  name: 'forge-catalog',
  testMatch: /forge-catalog\.spec\.ts/,
  timeout: 120_000,
  frontendPort: 15179,
  webPort: 15189,
  invalidCardDb: true,
})

const browserAlphaBase = makeSmokeConfig({
  name: 'browser-alpha',
  testMatch: /browser-alpha(?:-(?:commander|demo|diagnostics|emblems|telemetry))?\.spec\.ts/,
  timeout: 300_000,
  frontendPort: 15183,
  webPort: 15193,
})

const transportPort = managedPorts(
  { frontend: 15182 },
  suite === 'transport' ? process.env : {},
).frontend

const managedConfigs: Record<string, PlaywrightTestConfig> = {
  transport: defineConfig({
    testDir: './e2e',
    testMatch: /(?:(?:gre-prompt|draft)-transport|match-route|course-result)\.spec\.ts/,
    timeout: 30_000,
    retries: 0,
    use: {
      baseURL: `http://127.0.0.1:${transportPort}`,
      viewport: { width: 1280, height: 800 },
      trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium', channel: 'chromium' } }],
    reporter: process.env['FORGE_CI_REPORT_DIR']
      ? [
          ['line'],
          ['junit', { outputFile: `${process.env['FORGE_CI_REPORT_DIR']}/transport/junit.xml` }],
          ['json', { outputFile: `${process.env['FORGE_CI_REPORT_DIR']}/transport/timings.json` }],
        ]
      : [['list']],
    webServer: {
      command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${transportPort} --strictPort`,
      url: `http://127.0.0.1:${transportPort}`,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  }),
  auth: makeSmokeConfig({
    name: 'auth',
    testMatch: /auth-passwordless\.spec\.ts/,
    timeout: 30_000,
    frontendPort: 15173,
    webPort: 15183,
  }),
  'deck-import': makeSmokeConfig({
    name: 'deck-import',
    testMatch: /deck-import\.spec\.ts/,
    timeout: 30_000,
    frontendPort: 15178,
    webPort: 15188,
  }),
  'forge-catalog': defineConfig({
    ...forgeCatalogBase,
    outputDir: process.env['FORGE_CATALOG_OUTPUT_DIR'],
    preserveOutput: 'always',
  }),
  gre: greBase,
  screenshots: defineConfig({
    ...screenshotsBase,
    projects: [
      {
        name: 'chromium',
        use: { browserName: 'chromium', channel: 'chromium' },
      },
      {
        name: 'ipad',
        use: {
          browserName: 'chromium',
          channel: 'chromium',
          viewport: IPAD_VIEWPORT,
        },
      },
    ],
  }),
  product: makeSmokeConfig({
    name: 'product',
    testMatch:
      /(?:auth-passwordless|bootstrap|deck-import|decks|draft|product-smoke|react-challenge|whats-new)\.spec\.ts$/,
    timeout: 60_000,
    frontendPort: 15174,
    webPort: 15184,
    builtFrontendPort: 15164,
  }),
  'react-challenge': defineConfig({
    ...reactChallengeBase,
    projects: [
      {
        name: 'desktop',
        use: {
          browserName: 'chromium',
          channel: 'chromium',
          viewport: { width: 1440, height: 960 },
          deviceScaleFactor: 1,
        },
      },
      {
        name: 'mobile',
        use: {
          ...devices['iPhone 13'],
          browserName: 'chromium',
          channel: 'chromium',
        },
      },
    ],
  }),
  'challenge-video': defineConfig({
    ...challengeVideoBase,
    outputDir: process.env['CHALLENGE_VIDEO_OUTPUT_DIR'],
    use: {
      ...challengeVideoBase.use,
      ...devices['iPhone 13'],
      browserName: 'chromium',
      channel: 'chromium',
      colorScheme: 'dark',
    },
    projects: [
      {
        name: 'iphone',
        use: { browserName: 'chromium', channel: 'chromium' },
      },
    ],
  }),
  'browser-alpha': defineConfig({
    ...browserAlphaBase,
    outputDir: process.env['BROWSER_ALPHA_OUTPUT_DIR'],
    preserveOutput: 'always',
    projects: [
      {
        name: 'chrome',
        use: {
          browserName: 'chromium',
          channel: 'chrome',
          launchOptions: {
            args: ['--host-resolver-rules=MAP forgeweb.app 127.0.0.1'],
          },
          viewport: { width: 1280, height: 720 },
          deviceScaleFactor: 1,
          video: process.env['BROWSER_ALPHA_VIDEO'] === '1' ? 'on' : 'off',
        },
      },
    ],
  }),
}

if (suite && !managedConfigs[suite]) {
  throw new Error(`Unknown FORGE_WEB_PLAYWRIGHT_SUITE: ${suite}`)
}

export default suite ? managedConfigs[suite]! : standaloneConfig
