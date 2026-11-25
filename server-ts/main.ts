import { join } from 'node:path'
import { startHttpServer } from './app.ts'
import { CourseRecordStore } from './course-records.ts'
import { WebAuth, devEmailSender, resendEmailSender } from './auth.ts'
import { CardImageIndex } from './card-images.ts'
import {
  ServerConfigError,
  ensureDirectories,
  playerDatabaseFile,
  resolveServerConfig,
} from './config.ts'
import { openPlayerDatabase } from './db.ts'
import { DeckStore, loadStarterDecks, starterDeckSeeder } from './decks.ts'
import { backendRelease } from './http.ts'
import { Logger, configureLogging } from './log.ts'
import { MatchReplayStore } from './replay-store.ts'
import { installErrorReporting } from './reporting.ts'
import { cardImagesFile, starterDeckFiles } from './resources.ts'

const env = process.env

let config
try {
  config = resolveServerConfig(env)
} catch (cause) {
  if (!(cause instanceof ServerConfigError)) {
    throw cause
  }
  console.error(`Configuration error: ${cause.message}`)
  process.exit(1)
}
ensureDirectories(config)
configureLogging({
  release: env['SENTRY_RELEASE'] || 'unknown',
  directory: env['LEYLINE_LOG_DIR']?.trim() || config.artifactsRoot,
})
await installErrorReporting(env)
console.log(config.report())

const db = openPlayerDatabase(playerDatabaseFile(config.stateDir))
const { web } = config
const decks = new DeckStore(db)
const replays = new MatchReplayStore({
  root: join(config.stateDir, 'replays'),
  retentionDays: web.replayRetentionDays,
  pinnedRetentionDays: web.replayPinnedRetentionDays,
  maxBytes: web.replayMaxBytes,
  maxMatchBytes: web.replayMaxMatchBytes,
})
const auth = new WebAuth({
  db,
  secret: web.authSecret,
  sendEmail: web.resendApiKey.trim()
    ? resendEmailSender(web.resendApiKey, web.resendFrom)
    : devEmailSender,
  rateLimit: {
    enabled: web.rateLimitEnabled,
    loginLimit: web.rateLimit,
    loginWindowMs: web.rateLimitWindowMs,
  },
  fixedLoginCode: web.loginCode.trim() || null,
  onPlayerCreated: starterDeckSeeder(decks, loadStarterDecks(starterDeckFiles)),
})
const server = startHttpServer(
  {
    db,
    auth,
    cardImages: await CardImageIndex.load(cardImagesFile),
    decks,
    courseRecords: new CourseRecordStore(db),
    replays,
    operatorToken: web.replayOperatorToken,
  },
  {
    hostname: web.host,
    port: web.port,
    release: backendRelease(env),
    // Enable only when the backend accepts connections exclusively from its edge proxy.
    trustProxyHeaders: env['FORGE_WEB_TRUST_PROXY_HEADERS'] === 'true',
  },
)
new Logger('io.ktor.server.Application').info(`Responding at http://${web.host}:${server.port}`)
replays.startMaintenance()

const stop = async () => {
  replays.close()
  await server.stop()
  db.close()
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
