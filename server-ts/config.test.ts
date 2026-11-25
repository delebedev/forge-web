import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureDirectories, playerDatabaseFile, resolveServerConfig } from './config.ts'

const SECRET = 'a-32-char-secret-for-tests-0123456789'
const root = () => mkdtempSync(join(tmpdir(), 'forge-web-config-'))
const resolve = (
  base: string,
  env: Record<string, string> = {},
  state = join(base, 'default-state'),
) => resolveServerConfig({ LEYLINE_WEB_AUTH_SECRET: SECRET, ...env }, base, state)

describe('resolveServerConfig', () => {
  test('missing configuration uses product defaults', () => {
    const base = root()
    const config = resolve(base)
    expect(config.web.port).toBe(8080)
    expect(config.web.host).toBe('127.0.0.1')
    expect(config.web.rateLimit).toBe(5)
    expect(config.web.rateLimitEnabled).toBe(true)
    expect(config.stateDir).toBe(join(base, 'default-state'))
    expect(config.artifactsRoot).toBe(join(base, 'logs'))
    expect(config.report()).toContain('web.host = "127.0.0.1" [DEFAULT]')
  })

  test('unset state uses the existing user state directory', () => {
    const config = resolveServerConfig({ LEYLINE_WEB_AUTH_SECRET: SECRET }, root())
    expect(config.stateDir).toBe(join(homedir(), 'Library/Application Support/dev.leyline'))
  })

  test('environment overrides every product web policy', () => {
    const config = resolve(root(), {
      LEYLINE_WEB_PORT: '9090',
      LEYLINE_WEB_HOST: 'localhost',
      LEYLINE_WEB_LOGIN_CODE: '123456',
      LEYLINE_WEB_ALLOW_FIXED_LOGIN_CODE: 'true',
      LEYLINE_WEB_RESEND_API_KEY: 're_secret',
      LEYLINE_WEB_RESEND_FROM: 'env@example.test',
      LEYLINE_WEB_RATE_LIMIT_ENABLED: 'false',
      LEYLINE_WEB_RATE_LIMIT: '7',
      LEYLINE_WEB_RATE_LIMIT_WINDOW_MS: '60000',
    })
    expect(config.web).toMatchObject({
      port: 9090,
      host: 'localhost',
      authSecret: SECRET,
      loginCode: '123456',
      allowFixedLoginCode: true,
      resendApiKey: 're_secret',
      resendFrom: 'env@example.test',
      rateLimitEnabled: false,
      rateLimit: 7,
      rateLimitWindowMs: 60_000,
    })
    expect(config.report()).toContain('web.port = 9090 [ENV]')
  })

  test('relative paths anchor to the base directory and are created', () => {
    const base = root()
    const config = resolve(base, {
      LEYLINE_PATHS_STATE: 'state',
      LEYLINE_PATHS_ARTIFACTS: 'out/logs',
    })
    ensureDirectories(config)
    expect(config.stateDir).toBe(join(base, 'state'))
    expect(config.artifactsRoot).toBe(join(base, 'out/logs'))
    expect(existsSync(config.stateDir) && existsSync(config.artifactsRoot)).toBe(true)
    expect(playerDatabaseFile(config.stateDir)).toBe(join(base, 'state/player.db'))
  })

  test('instance isolates state and artifacts and rejects traversal', () => {
    const base = root()
    const config = resolve(base, { LEYLINE_INSTANCE: 'second' })
    expect(config.instance).toBe('second')
    expect(config.stateDir).toBe(join(base, 'default-state/second'))
    expect(config.artifactsRoot).toBe(join(base, 'logs/second'))
    expect(() => resolve(base, { LEYLINE_INSTANCE: '../escape' })).toThrow('LEYLINE_INSTANCE')
  })

  test('malformed environment values identify the override', () => {
    expect(() => resolve(root(), { LEYLINE_WEB_PORT: 'abc' })).toThrow('LEYLINE_WEB_PORT')
    expect(() => resolve(root(), { LEYLINE_WEB_RATE_LIMIT_ENABLED: 'yes' })).toThrow(
      'LEYLINE_WEB_RATE_LIMIT_ENABLED',
    )
  })

  test('auth secret and fixed code rules are enforced', () => {
    const resolveSecret = (secret: string) =>
      resolveServerConfig({ LEYLINE_WEB_AUTH_SECRET: secret }, root(), root())
    expect(() => resolveSecret('')).toThrow(
      'web.auth_secret is required (set LEYLINE_WEB_AUTH_SECRET)',
    )
    expect(() => resolveSecret('dev-web-auth-secret')).toThrow(
      'web.auth_secret must not use the dev default',
    )
    expect(() => resolveSecret('short')).toThrow('web.auth_secret must be at least 32 characters')
    expect(() => resolve(root(), { LEYLINE_WEB_LOGIN_CODE: '123456' })).toThrow(
      'web.login_code requires web.allow_fixed_login_code=true',
    )
    expect(() =>
      resolve(root(), {
        LEYLINE_WEB_LOGIN_CODE: '12345',
        LEYLINE_WEB_ALLOW_FIXED_LOGIN_CODE: 'true',
      }),
    ).toThrow('web.login_code must be a six-digit code')
    expect(() => resolve(root(), { LEYLINE_WEB_REPLAY_OPERATOR_TOKEN: 'short' })).toThrow(
      'web.replay_operator_token must be at least 32 characters',
    )
  })

  test('web secrets are redacted', () => {
    const report = resolve(root(), {
      LEYLINE_WEB_LOGIN_CODE: '123456',
      LEYLINE_WEB_ALLOW_FIXED_LOGIN_CODE: 'true',
      LEYLINE_WEB_RESEND_API_KEY: 're_secret',
    }).report()
    expect(report).toContain('web.auth_secret = <redacted> [ENV]')
    expect(report).toContain('web.login_code = <redacted> [ENV]')
    expect(report).toContain('web.resend_api_key = <redacted> [ENV]')
    expect(report).toContain('web.replay_operator_token = <redacted> [DEFAULT]')
    for (const secret of [SECRET, '123456', 're_secret']) {
      expect(report).not.toContain(secret)
    }
  })
})
