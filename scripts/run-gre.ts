/**
 * Runs the GRE acceptance suite against its own Leyline and Vite instances.
 *
 * Extra arguments pass through to Playwright, so a single scenario is
 * `bun run gre -- -g "concede shows GRE defeat outcome"`.
 */

import { PLAYWRIGHT_CLI, playwrightEnv } from './lib/playwright-env'

const proc = Bun.spawn({
  cmd: ['node', PLAYWRIGHT_CLI, 'test', ...process.argv.slice(2)],
  cwd: import.meta.dir + '/..',
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
  env: playwrightEnv('gre', {
    PRIORITY_DEMO_VIDEO: process.env['PRIORITY_DEMO_VIDEO'],
  }),
})

process.exit(await proc.exited)
