/**
 * Runs one managed Playwright suite against its own Leyline and Vite instances.
 *
 * Usage: `bun run e2e <suite> [playwright args]`, for example
 * `bun run e2e deck-import --project=chromium`. Extra arguments pass through to
 * Playwright, so a single case is `bun run e2e gre -- -g "concede shows GRE defeat outcome"`.
 */

import { PLAYWRIGHT_CLI, playwrightEnv } from './lib/playwright-env'

const [suite, ...args] = Bun.argv.slice(2)

if (!suite) {
  console.error('usage: bun scripts/run-e2e.ts <suite> [playwright args]')
  process.exit(2)
}

const proc = Bun.spawn({
  cmd: ['node', PLAYWRIGHT_CLI, 'test', ...args],
  cwd: `${import.meta.dir}/..`,
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
  env: playwrightEnv(suite),
})

process.exit(await proc.exited)
