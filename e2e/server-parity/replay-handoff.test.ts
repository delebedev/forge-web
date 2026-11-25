import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { PARITY_OPERATOR_TOKEN, startServer, tempStateDir, type ParityServer } from './server'
import { deviceId, replayChunk } from './support'

const JVM = process.env['FORGE_WEB_SERVER_DIST']
  ? 'bash scripts/run-ci-server.sh'
  : 'server/build/install/server/bin/server'
const BUN = 'bun server-ts/main.ts'
const operator = { Authorization: `Bearer ${PARITY_OPERATOR_TOKEN}` }
const stateDir = tempStateDir()
const device = deviceId()

afterAll(() => rmSync(stateDir, { recursive: true, force: true }))

async function withServer<T>(cmd: string, use: (server: ParityServer) => Promise<T>): Promise<T> {
  const server = await startServer({ cmd, stateDir })
  try {
    return await use(server)
  } finally {
    await server.stop()
  }
}

async function upload(
  server: ParityServer,
  chunk: ReturnType<typeof replayChunk>,
  afterSeq: number,
) {
  const response = await fetch(`${server.url}/api/browser-replays/${chunk.matchId}/chunks`, {
    method: 'POST',
    headers: { 'X-Device-Id': device, 'X-Replay-After-Seq': String(afterSeq) },
    body: JSON.stringify(chunk),
  })
  return [response.status, await response.text()]
}

const exported = async (server: ParityServer, matchId: string) =>
  (await fetch(`${server.url}/api/operator/replays/${matchId}`, { headers: operator })).text()

const pin = async (server: ParityServer, matchId: string, reportId: string) =>
  (
    await fetch(`${server.url}/api/operator/replays/${matchId}/pin`, {
      method: 'POST',
      headers: { ...operator, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId }),
    })
  ).status

describe.skipIf(!process.env['FORGE_WEB_SERVER_DIST'] && !existsSync(JVM))(
  'replay journals on one state directory',
  () => {
    test('each server continues and exports the journal the other wrote', async () => {
      const [first, second] = [`browser-${crypto.randomUUID()}`, `browser-${crypto.randomUUID()}`]
      const attempt = crypto.randomUUID()
      await withServer(JVM, async (jvm) => {
        expect(await upload(jvm, replayChunk(first, attempt, 0, 2), 0)).toEqual([200, '2'])
      })
      const bunExports = await withServer(BUN, async (bun) => {
        expect(await upload(bun, replayChunk(first, attempt, 2, 1), 2)).toEqual([200, '3'])
        expect(await upload(bun, replayChunk(second, attempt, 0, 2), 0)).toEqual([200, '2'])
        return [await exported(bun, first), await exported(bun, second)]
      })
      const jvmExport = await withServer(JVM, async (jvm) => {
        expect([await exported(jvm, first), await exported(jvm, second)]).toEqual(bunExports)
        expect(await upload(jvm, replayChunk(second, attempt, 2, 1), 2)).toEqual([200, '3'])
        return exported(jvm, second)
      })
      expect(JSON.parse(jvmExport).events).toHaveLength(3)
      await withServer(BUN, async (bun) => expect(await exported(bun, second)).toBe(jvmExport))
    }, 300_000)

    // shortcut: legacy snapshot export, delete after 2026-12-26 when the last pin expires
    test('a legacy snapshot exports the same body from both servers', async () => {
      const [source, legacy] = [`browser-${crypto.randomUUID()}`, `browser-${crypto.randomUUID()}`]
      const snapshot = await withServer(JVM, async (jvm) => {
        await upload(jvm, replayChunk(source, crypto.randomUUID(), 0, 2), 0)
        return JSON.parse(await exported(jvm, source))
      })
      const bundle = {
        ...snapshot,
        matchId: legacy,
        context: { ...snapshot.context, matchId: legacy },
      }
      await Bun.write(
        join(stateDir, 'replays', `${legacy}.browser.json.gz`),
        gzipSync(JSON.stringify(bundle)),
      )
      const bunExport = await withServer(BUN, async (bun) => {
        expect(await pin(bun, legacy, 'report-legacy')).toBe(204)
        expect((await upload(bun, replayChunk(legacy, bundle.context.attemptId, 2, 1), 2))[0]).toBe(
          409,
        )
        return exported(bun, legacy)
      })
      expect(JSON.parse(bunExport).status.reportId).toBe('report-legacy')
      await withServer(JVM, async (jvm) => expect(await exported(jvm, legacy)).toBe(bunExport))
    }, 300_000)
  },
)
