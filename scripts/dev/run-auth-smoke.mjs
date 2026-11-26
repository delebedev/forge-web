import { spawn } from 'node:child_process'

const cleanFlag = '--clean-env'

if (!process.argv.includes(cleanFlag)) {
  const cleanEnv = {
    HOME: process.env.HOME,
    JAVA_HOME: process.env.JAVA_HOME,
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
    TMPDIR: process.env.TMPDIR,
    USER: process.env.USER,
    FORGE_PROVIDER_DIR: process.env.FORGE_PROVIDER_DIR,
  }
  const child = spawn(process.execPath, [process.argv[1], cleanFlag], {
    stdio: 'inherit',
    env: Object.fromEntries(Object.entries(cleanEnv).filter((entry) => entry[1] != null)),
  })
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })
} else {
  const child = spawn(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--project=chromium'],
    {
      stdio: 'inherit',
      env: { ...process.env, FORGE_WEB_PLAYWRIGHT_SUITE: 'auth' },
    },
  )

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })
}
