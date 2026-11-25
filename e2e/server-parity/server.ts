import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')

export const PARITY_LOGIN_CODE = '123456'
export const PARITY_OPERATOR_TOKEN = 'forge-web-parity-operator-secret-1234567890'
export const PARITY_RELEASE = 'abcdef1'

/** The server under test. The default runs the product server from source. */
export function defaultServerCommand(): string {
  const configured = process.env['FORGE_WEB_PARITY_SERVER_CMD']
  if (configured) {
    return configured
  }
  if (process.env['FORGE_WEB_SERVER_DIST']) {
    return 'bash scripts/run-ci-server.sh'
  }
  return 'bun server-ts/main.ts'
}

export function tempStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'forge-web-parity-'))
}

export interface StartOptions {
  cmd?: string
  stateDir: string
  env?: Record<string, string>
}

export interface ParityServer {
  readonly url: string
  readonly stateDir: string
  log(): string
  stop(): Promise<void>
  /** Stops the process and starts the same command on the same state dir and port. */
  restart(env?: Record<string, string>): Promise<void>
}

/**
 * Starts a product server by shell command and waits for `/api/health`.
 * The command runs in its own process group so wrappers such as Gradle stop with it.
 */
export async function startServer({
  cmd = defaultServerCommand(),
  stateDir,
  env = {},
}: StartOptions): Promise<ParityServer> {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  let output = ''
  let child: ReturnType<typeof Bun.spawn> | null = null

  const launch = async (overrides: Record<string, string>) => {
    output = ''
    // No `exec`: the command may be any shell syntax, such as a leading environment assignment.
    // The process group still stops every process it starts.
    const proc = Bun.spawn(['bash', '-c', cmd], {
      cwd: ROOT,
      detached: true,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        LEYLINE_WEB_PORT: String(port),
        LEYLINE_WEB_LOGIN_CODE: PARITY_LOGIN_CODE,
        LEYLINE_WEB_ALLOW_FIXED_LOGIN_CODE: 'true',
        LEYLINE_WEB_RATE_LIMIT_ENABLED: 'false',
        LEYLINE_WEB_AUTH_SECRET: 'forge-web-parity-auth-secret-1234567890',
        LEYLINE_WEB_REPLAY_OPERATOR_TOKEN: PARITY_OPERATOR_TOKEN,
        LEYLINE_PATHS_STATE: stateDir,
        LEYLINE_PATHS_ARTIFACTS: join(stateDir, 'logs'),
        SENTRY_RELEASE: PARITY_RELEASE,
        ...env,
        ...overrides,
      },
    })
    child = proc
    void collect(proc.stdout)
    void collect(proc.stderr)
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) {
        throw new Error(`Server exited with ${proc.exitCode}:\n${output}`)
      }
      try {
        if ((await fetch(`${url}/api/health`)).ok) {
          return
        }
      } catch {
        // Not listening yet.
      }
      await Bun.sleep(200)
    }
    await stop()
    throw new Error(`Server did not become healthy:\n${output}`)
  }

  async function collect(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder()
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        return
      }
      output += decoder.decode(value, { stream: true })
    }
  }

  async function stop() {
    const proc = child
    if (!proc) {
      return
    }
    child = null
    // The shell can exit before the server it started, so wait for the whole group to release the port.
    signalGroup(proc.pid, 'SIGTERM')
    const deadline = Date.now() + 15_000
    while (signalGroup(proc.pid, 0)) {
      if (Date.now() > deadline) {
        signalGroup(proc.pid, 'SIGKILL')
      }
      await Bun.sleep(50)
    }
    await proc.exited
  }

  await launch({})
  return {
    url,
    stateDir,
    log: () => output,
    stop,
    restart: async (overrides = {}) => {
      await stop()
      await launch(overrides)
    },
  }
}

/** Signals every process in the group; false once the group has no processes left. */
function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal)
    return true
  } catch {
    return false
  }
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
  const port = server.port
  await server.stop(true)
  if (port === undefined) {
    throw new Error('No free port')
  }
  return port
}
