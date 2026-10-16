/** Runs the Forge-backed catalog browser proof against isolated product state. */

import { PLAYWRIGHT_CLI, playwrightEnv } from './lib/playwright-env'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateDir = mkdtempSync(join(tmpdir(), 'forge-web-forge-catalog-'))
const outputDir = mkdtempSync(join(tmpdir(), 'forge-web-forge-catalog-artifacts-'))

const proc = Bun.spawn({
  cmd: ['node', PLAYWRIGHT_CLI, 'test', ...process.argv.slice(2)],
  cwd: import.meta.dir + '/..',
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
  env: playwrightEnv('forge-catalog', {
    FORGE_CATALOG_OUTPUT_DIR: outputDir,
    FORGE_WEB_PLAYWRIGHT_STATE_DIR: stateDir,
  }),
})

const exitCode = await proc.exited
if (exitCode === 0 && !existsSync(join(stateDir, 'player.db'))) {
  console.error(`Forge catalog proof did not create ${join(stateDir, 'player.db')}`)
  process.exit(1)
}
console.log(`Forge catalog state: ${stateDir}`)
console.log(`Forge catalog artifacts: ${outputDir}`)
process.exit(exitCode)
