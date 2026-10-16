import { PLAYWRIGHT_CLI, playwrightEnv } from './lib/playwright-env'

const proc = Bun.spawn({
  cmd: ['node', PLAYWRIGHT_CLI, 'test', ...process.argv.slice(2)],
  cwd: import.meta.dir + '/..',
  stdout: 'inherit',
  stderr: 'inherit',
  stdin: 'inherit',
  env: playwrightEnv('react-challenge'),
})

process.exit(await proc.exited)
