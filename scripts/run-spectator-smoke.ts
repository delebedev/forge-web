/** Runs every adjacent spectator pairing through simclient with Forge identities. */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const poolDir = join(root, 'dev', 'spectator-decks')
const decks = readFileSync(join(poolDir, 'pool.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))

if (decks.length < 2) {
  throw new Error('Spectator pool needs at least two decks')
}

const seeds = process.argv[2] ?? '1..5'
const stamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replace(/\.\d{3}Z$/, 'Z')
const outputRoot = join(root, 'test-results', 'spectator-smoke', stamp)
const contentRoot = join(outputRoot, 'content')
const contentDecks = join(contentRoot, 'data', 'decks')
mkdirSync(contentDecks, { recursive: true })

for (const deck of decks) {
  copyFileSync(join(poolDir, `${deck}.txt`), join(contentDecks, `${deck}.txt`))
}

const summaries: unknown[] = []
for (const [index, deck] of decks.entries()) {
  const opponent = decks[(index + 1) % decks.length]!
  const pair = `${deck.replaceAll(' ', '-')}-vs-${opponent.replaceAll(' ', '-')}`
  const outDir = join(outputRoot, pair)
  const summaryPath = join(outDir, 'summary.json')
  mkdirSync(outDir, { recursive: true })
  console.log(`\n${deck} vs ${opponent}, seeds ${seeds}`)

  const proc = Bun.spawn({
    cmd: [
      './leyline/gradlew',
      ':leyline:engine:simclient',
      `--args=--out-dir ${outDir} --summary-json ${summaryPath} --no-exclude-cards-file`,
    ],
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      JAVA_TOOL_OPTIONS:
        `${process.env.JAVA_TOOL_OPTIONS ?? ''} -Dleyline.content.root=${contentRoot}`.trim(),
      SIMCLIENT_CARD_CATALOG: 'forge',
      SIMCLIENT_POLICY: 'forge-ai',
      SIMCLIENT_DECKS: deck,
      SIMCLIENT_OPPONENT_DECK: opponent,
      SIMCLIENT_SEEDS: seeds,
      SIMCLIENT_MAX_TURNS: '200',
      SIMCLIENT_GAME_TIMEOUT_SECONDS: '180',
    },
  })
  const code = await proc.exited
  if (code !== 0) {
    process.exit(code)
  }

  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
    rowsRun: number
    failureClasses: Record<string, number>
  }
  summaries.push({ deck, opponent, ...summary })
  if (
    summary.failureClasses['natural'] !== summary.rowsRun ||
    Object.keys(summary.failureClasses).some((key) => key !== 'natural')
  ) {
    throw new Error(
      `${deck} vs ${opponent} did not finish naturally: ${JSON.stringify(summary.failureClasses)}`,
    )
  }
}

writeFileSync(join(outputRoot, 'pool-summary.json'), `${JSON.stringify(summaries, null, 2)}\n`)
console.log(`\nSpectator pool passed. Evidence: ${outputRoot}`)
