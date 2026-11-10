import { describe, expect, test } from 'bun:test'
import { managedPorts } from './lib/playwright-ports'
import { playwrightEnv } from './lib/playwright-env'

describe('managed Playwright ports', () => {
  test('disposable fixed-code browser servers explicitly disable production abuse budgets', async () => {
    const previous = process.env['FORGE_WEB_PLAYWRIGHT_SUITE']
    try {
      process.env['FORGE_WEB_PLAYWRIGHT_SUITE'] = 'product'
      const { default: config } = await import('../playwright.config')
      const servers = config.webServer
      expect(Array.isArray(servers)).toBe(true)
      if (!Array.isArray(servers)) {
        throw new Error('Expected managed test servers')
      }
      expect(servers[0]?.command).toContain('LEYLINE_WEB_ALLOW_FIXED_LOGIN_CODE=true')
      expect(servers[0]?.command).toContain('LEYLINE_WEB_RATE_LIMIT_ENABLED=false')
    } finally {
      if (previous === undefined) {
        delete process.env['FORGE_WEB_PLAYWRIGHT_SUITE']
      } else {
        process.env['FORGE_WEB_PLAYWRIGHT_SUITE'] = previous
      }
    }
  })

  test('retains defaults and supports a separate complete stack', () => {
    const defaults = { frontend: 15174, backend: 15184, preview: 15164 }
    expect(managedPorts(defaults, {})).toEqual(defaults)
    expect(
      managedPorts(defaults, {
        FORGE_WEB_PLAYWRIGHT_FRONTEND_PORT: '15214',
        FORGE_WEB_PLAYWRIGHT_BACKEND_PORT: '18214',
        FORGE_WEB_PLAYWRIGHT_PREVIEW_PORT: '15204',
      }),
    ).toEqual({ frontend: 15214, backend: 18214, preview: 15204 })
  })

  test.each(['', '0', '1023', '65536', '1.5', '15214; touch /tmp/unexpected', 'NaN'])(
    'rejects invalid port %j before a command is built',
    (port) => {
      expect(() =>
        managedPorts({ frontend: 15174 }, { FORGE_WEB_PLAYWRIGHT_FRONTEND_PORT: port }),
      ).toThrow('must be an integer')
    },
  )

  test('rejects collisions with overridden and default listeners', () => {
    expect(() =>
      managedPorts(
        { frontend: 15174, backend: 15184 },
        {
          FORGE_WEB_PLAYWRIGHT_FRONTEND_PORT: '15184',
        },
      ),
    ).toThrow('must be distinct')
  })

  test('wrapper forwards managed ports while retaining the environment allowlist', () => {
    const variables = {
      FORGE_WEB_PLAYWRIGHT_FRONTEND_PORT: '15214',
      FORGE_WEB_PLAYWRIGHT_BACKEND_PORT: '18214',
      FORGE_WEB_PLAYWRIGHT_PREVIEW_PORT: '15204',
      PRIORITY_DEMO_VIDEO: '1',
      LEYLINE_WEB_PORT: '9999',
    }
    const original = Object.fromEntries(
      Object.keys(variables).map((key) => [key, process.env[key]]),
    )
    try {
      Object.assign(process.env, variables)
      const env = playwrightEnv('gre')
      for (const [key, value] of Object.entries(variables)) {
        if (key === 'LEYLINE_WEB_PORT') {
          expect(env[key]).toBeUndefined()
        } else {
          expect(env[key]).toBe(value)
        }
      }
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })
})
