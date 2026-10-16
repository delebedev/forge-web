import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLAYWRIGHT_CLI, playwrightEnv } from './lib/playwright-env'

const stateDir = mkdtempSync(join(tmpdir(), 'forge-web-product-smoke-'))
let code = 1
try {
  const proc = Bun.spawn({
    cmd: ['node', PLAYWRIGHT_CLI, 'test', '--project=chromium', ...Bun.argv.slice(2)],
    cwd: import.meta.dir + '/..',
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
    env: playwrightEnv('product', {
      FORGE_WEB_PLAYWRIGHT_STATE_DIR: stateDir,
      // Independent browser cases briefly retain disconnected matches for reconnect grace.
      FORGE_WEB_MAX_MATCHES: '32',
    }),
  })

  code = await proc.exited
} finally {
  rmSync(stateDir, { recursive: true, force: true })
}
process.exit(code)
