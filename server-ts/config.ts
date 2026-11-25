import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const DEV_WEB_AUTH_SECRET = 'dev-web-auth-secret'

export class ServerConfigError extends Error {}

type Kind = 'int' | 'long' | 'boolean' | 'string'
type Value = number | boolean | string

/** Section, key and kind of every setting in the startup report's order before sorting. */
const SCHEMA: Record<'web' | 'paths', Record<string, [Kind, Value]>> = {
  web: {
    port: ['int', 8080],
    host: ['string', '127.0.0.1'],
    auth_secret: ['string', ''],
    login_code: ['string', ''],
    allow_fixed_login_code: ['boolean', false],
    resend_api_key: ['string', ''],
    resend_from: ['string', 'login@localhost'],
    rate_limit_enabled: ['boolean', true],
    rate_limit: ['int', 5],
    rate_limit_window_ms: ['long', 60_000],
    replay_operator_token: ['string', ''],
    replay_retention_days: ['int', 7],
    replay_pinned_retention_days: ['int', 30],
    replay_max_bytes: ['long', 512 * 1024 * 1024],
    replay_max_match_bytes: ['long', 32 * 1024 * 1024],
  },
  paths: {
    state: ['string', ''],
    artifacts: ['string', 'logs'],
  },
}

const SECRET_PATHS = new Set([
  'web.auth_secret',
  'web.login_code',
  'web.resend_api_key',
  'web.replay_operator_token',
])

export interface WebSettings {
  port: number
  host: string
  authSecret: string
  loginCode: string
  allowFixedLoginCode: boolean
  resendApiKey: string
  resendFrom: string
  rateLimitEnabled: boolean
  rateLimit: number
  rateLimitWindowMs: number
  replayOperatorToken: string
  replayRetentionDays: number
  replayPinnedRetentionDays: number
  replayMaxBytes: number
  replayMaxMatchBytes: number
}

export interface ServerConfig {
  web: WebSettings
  stateDir: string
  artifactsRoot: string
  baseDir: string
  instance: string | null
  report(): string
}

export function playerDatabaseFile(stateDir: string): string {
  return join(stateDir, 'player.db')
}

export function ensureDirectories(config: ServerConfig): void {
  mkdirSync(config.stateDir, { recursive: true })
  mkdirSync(config.artifactsRoot, { recursive: true })
}

function envName(section: string, key: string): string {
  return `LEYLINE_${section.toUpperCase()}_${key.toUpperCase()}`
}

const MAX_INT = 2_147_483_647
const MAX_LONG = 9_223_372_036_854_775_807n

function parseScalar(kind: Kind, raw: string): Value {
  switch (kind) {
    case 'int':
    case 'long': {
      const valid = /^[+-]?\d+$/.test(raw)
      const big = valid ? BigInt(raw) : 0n
      const max = kind === 'int' ? BigInt(MAX_INT) : MAX_LONG
      if (!valid || big > max || big < -max - 1n) {
        throw new Error(`For input string: "${raw}"`)
      }
      return Number(big)
    }
    case 'boolean':
      if (raw === 'true') {
        return true
      }
      if (raw === 'false') {
        return false
      }
      throw new Error(`The string doesn't represent a boolean value: ${raw}`)
    case 'string':
      return raw
  }
}

function validate(web: WebSettings, artifacts: string): void {
  const require = (ok: boolean, message: string) => {
    if (!ok) {
      throw new ServerConfigError(message)
    }
  }
  require(web.port >= 1 && web.port <= 65535, `web.port must be in 1..65535, got ${web.port}`)
  require(web.host.trim() !== '', 'web.host must not be blank')
  require(web.rateLimit > 0, `web.rate_limit must be positive, got ${web.rateLimit}`)
  require(web.rateLimitWindowMs >
    0, `web.rate_limit_window_ms must be positive, got ${web.rateLimitWindowMs}`)
  require(web.replayRetentionDays > 0, 'web.replay_retention_days must be positive')
  require(web.replayPinnedRetentionDays >=
    web.replayRetentionDays, 'web.replay_pinned_retention_days must not be shorter than replay_retention_days')
  require(web.replayMaxBytes >= 64 * 1024, 'web.replay_max_bytes must be at least 65536')
  require(web.replayMaxMatchBytes >= 64 * 1024 &&
    web.replayMaxMatchBytes <=
      web.replayMaxBytes, 'web.replay_max_match_bytes must be between 65536 and replay_max_bytes')
  if (web.replayOperatorToken.trim() !== '') {
    require(web.replayOperatorToken.length >=
      32, 'web.replay_operator_token must be at least 32 characters')
  }
  require(web.authSecret.trim() !== '', 'web.auth_secret is required (set LEYLINE_WEB_AUTH_SECRET)')
  require(web.authSecret !== DEV_WEB_AUTH_SECRET, 'web.auth_secret must not use the dev default')
  require(web.authSecret.length >= 32, 'web.auth_secret must be at least 32 characters')
  if (web.loginCode.trim() !== '') {
    require(web.allowFixedLoginCode, 'web.login_code requires web.allow_fixed_login_code=true')
    require(/^[0-9]{6}$/.test(web.loginCode), 'web.login_code must be a six-digit code')
  }
  require(artifacts.trim() !== '', 'paths.artifacts must not be blank')
}

/**
 * Resolves settings from defaults and `LEYLINE_*` overrides: `web.port` reads `LEYLINE_WEB_PORT`.
 * Relative `paths.state` and `paths.artifacts` resolve against `baseDir`.
 */
export function resolveServerConfig(
  env: Record<string, string | undefined>,
  baseDir: string = process.cwd(),
  defaultStateDir: string = join(homedir(), 'Library/Application Support/dev.leyline'),
): ServerConfig {
  const values: Record<string, Value> = {}
  const fromEnv = new Set<string>()
  for (const [section, keys] of Object.entries(SCHEMA)) {
    for (const [key, [kind, fallback]] of Object.entries(keys)) {
      const name = envName(section, key)
      const raw = env[name]
      const path = `${section}.${key}`
      if (raw === undefined || raw.trim() === '') {
        values[path] = fallback
        continue
      }
      try {
        values[path] = parseScalar(kind, raw)
      } catch (cause) {
        throw new ServerConfigError(
          `Invalid value for ${name}: '${raw}' (${(cause as Error).message})`,
        )
      }
      fromEnv.add(path)
    }
  }
  const get = <T extends Value>(path: string) => values[path] as T
  const web: WebSettings = {
    port: get('web.port'),
    host: get('web.host'),
    authSecret: get('web.auth_secret'),
    loginCode: get('web.login_code'),
    allowFixedLoginCode: get('web.allow_fixed_login_code'),
    resendApiKey: get('web.resend_api_key'),
    resendFrom: get('web.resend_from'),
    rateLimitEnabled: get('web.rate_limit_enabled'),
    rateLimit: get('web.rate_limit'),
    rateLimitWindowMs: get('web.rate_limit_window_ms'),
    replayOperatorToken: get('web.replay_operator_token'),
    replayRetentionDays: get('web.replay_retention_days'),
    replayPinnedRetentionDays: get('web.replay_pinned_retention_days'),
    replayMaxBytes: get('web.replay_max_bytes'),
    replayMaxMatchBytes: get('web.replay_max_match_bytes'),
  }
  const state = get<string>('paths.state')
  const artifacts = get<string>('paths.artifacts')
  validate(web, artifacts)
  const instance = env['LEYLINE_INSTANCE']?.trim() ? env['LEYLINE_INSTANCE'] : null
  if (
    instance !== null &&
    (instance === '.' || instance === '..' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(instance))
  ) {
    throw new ServerConfigError(`LEYLINE_INSTANCE must be a simple name, got '${instance}'`)
  }
  const baseState = state.trim() === '' ? defaultStateDir : resolve(baseDir, state)
  const baseArtifacts = resolve(baseDir, artifacts)
  const stateDir = instance ? join(baseState, instance) : baseState
  const artifactsRoot = instance ? join(baseArtifacts, instance) : baseArtifacts

  const report = () => {
    const lines = [
      `Forge Web configuration (instance=${instance ?? 'default'})`,
      `  base: ${baseDir}`,
    ]
    for (const [section, keys] of Object.entries(SCHEMA)) {
      lines.push(`  [${section}]`)
      for (const key of Object.keys(keys).sort()) {
        const path = `${section}.${key}`
        const display = SECRET_PATHS.has(path) ? '<redacted>' : JSON.stringify(values[path])
        lines.push(`    ${path} = ${display} [${fromEnv.has(path) ? 'ENV' : 'DEFAULT'}]`)
      }
    }
    lines.push(
      '  [resolved paths]',
      `    state: ${stateDir}`,
      `    player_db: ${playerDatabaseFile(stateDir)}`,
      `    artifacts: ${artifactsRoot}`,
      `    replays: ${join(stateDir, 'replays')} [enabled]`,
      `    operator_access: ${web.replayOperatorToken.trim() === '' ? 'disabled' : 'enabled'}`,
    )
    return lines.join('\n') + '\n'
  }
  return { web, stateDir, artifactsRoot, baseDir, instance, report }
}
