#!/usr/bin/env node
// Times draft and sealed on a cold browser-engine worker in desktop Chrome.
// Prerequisite: `bun run browser:assets`. Usage: node tools/limited-timing.mjs [--runs N] [--port N] [--set FDN]
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    port: { type: 'string', default: '15181' },
    set: { type: 'string', default: 'FDN' },
  },
})
const root = fileURLToPath(new URL('../public', import.meta.url))
const types = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html' }

// The page owns the worker; every command is timed from postMessage to reply.
const page = `<!doctype html><script>
let worker, nextId = 0
const pending = new Map()
function command(type, args = {}) {
  const id = ++nextId
  const started = performance.now()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, started })
    worker.postMessage({ type, id, ...args })
  })
}
async function coldWorker() {
  const release = await (await fetch('/browser-engine/release.json', { cache: 'no-store' })).json()
  worker?.terminate()
  worker = new Worker(release.assets.find((asset) => asset.path === 'web/engine-worker.js').url)
  worker.onmessage = ({ data }) => {
    if (data.event !== 'reply') return
    const request = pending.get(data.data.id)
    pending.delete(data.data.id)
    const ms = performance.now() - request.started
    data.data.error ? request.reject(new Error(data.data.error)) : request.resolve({ ms, result: data.data.result })
  }
  return command('initialize', { release, generation: 1 })
}
async function limitedTiming(set, seed) {
  const init = await coldWorker()
  const catalogVersion = init.result
  const draft = (picks) => command('draft', { request: { set, seed, picks, catalogVersion } })
  const start = await draft([])
  let state = start.result
  const picks = []
  while (!state.complete) {
    const pick = await draft([...state.pool, state.pack[0]])
    picks.push(pick.ms)
    state = pick.result
  }
  const complete = await command('draft-complete', { request: { set, seed, picks: state.pool, catalogVersion } })
  const warmSealed = await command('sealed', { request: { set, seed, catalogVersion } })
  // A fresh worker must rebuild the same draft from its picks.
  const resumeInit = await coldWorker()
  const resumed = await command('draft-complete', { request: { set, seed, picks: state.pool, catalogVersion } })
  await coldWorker()
  const sealed = await command('sealed', { request: { set, seed, catalogVersion } })
  return {
    coldStartMs: init.ms,
    firstStartMs: start.ms,
    picks,
    completeMs: complete.ms,
    sealedMs: sealed.ms,
    warmSealedMs: warmSealed.ms,
    resumeColdStartMs: resumeInit.ms,
    resumeCompleteMs: resumed.ms,
    pool: state.pool.length,
    botDeckSizes: complete.result.botDecks.map((deck) => deck.length),
    sealedPool: sealed.result.pool.length,
    resumedIdentical:
      JSON.stringify(resumed.result) === JSON.stringify(complete.result) &&
      JSON.stringify(sealed.result) === JSON.stringify(warmSealed.result),
  }
}
</script>`

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  if (path === '/') {
    response.writeHead(200, { 'content-type': 'text/html' }).end(page)
    return
  }
  const file = normalize(join(root, decodeURIComponent(path)))
  if (!file.startsWith(root)) {
    response.writeHead(403).end()
    return
  }
  try {
    const body = await readFile(file)
    response
      .writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      .end(body)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(Number(values.port), '127.0.0.1', resolve))

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
const ms = (value) => `${Math.round(value)}`
const browser = await chromium.launch({ channel: 'chrome' })
const rows = []
try {
  for (let run = 1; run <= Number(values.runs); run++) {
    const context = await browser.newContext()
    const tab = await context.newPage()
    await tab.goto(`http://127.0.0.1:${values.port}/`)
    const result = await tab.evaluate(`limitedTiming(${JSON.stringify(values.set)}, ${run})`)
    await context.close()
    const sorted = [...result.picks].sort((a, b) => a - b)
    rows.push({
      run,
      ...result,
      firstPickMs: result.picks[0],
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted.at(-1),
    })
    console.error(
      `run ${run}: ${JSON.stringify({ ...result, picks: result.picks.map(Math.round) })}`,
    )
  }
} finally {
  await browser.close()
  server.close()
}

console.log(
  `| Run | Cold start | Draft start | First pick | Pick p50 | Pick p95 | Pick max | Complete (7 bot decks) | Sealed, cold worker | Sealed, after draft | Resume to complete, cold worker | Identical on a new worker |`,
)
console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|`)
for (const row of rows) {
  console.log(
    `| ${row.run} | ${ms(row.coldStartMs)} | ${ms(row.firstStartMs)} | ${ms(row.firstPickMs)} | ${ms(row.p50)} | ${ms(row.p95)} | ${ms(row.max)} | ${ms(row.completeMs)} | ${ms(row.sealedMs)} | ${ms(row.warmSealedMs)} | ${ms(row.resumeCompleteMs)} | ${row.resumedIdentical} |`,
  )
}
if (rows.some((row) => !row.resumedIdentical || row.pool !== 42 || row.botDeckSizes.length !== 7)) {
  process.exitCode = 1
}
