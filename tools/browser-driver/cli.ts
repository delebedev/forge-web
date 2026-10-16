#!/usr/bin/env node

import { parseArgs } from './config.ts'
import { runBrowserDriver } from './run.ts'

const HELP = `Usage:
  node --experimental-strip-types tools/browser-driver/cli.ts --puzzle ID [--puzzle ID ...] [options]
  node --experimental-strip-types tools/browser-driver/cli.ts --candidate FILE [--candidate FILE ...] [options]
  node --experimental-strip-types tools/browser-driver/cli.ts --ordinary [options]
  node --experimental-strip-types tools/browser-driver/cli.ts --url MATCH_URL [options]

Options:
  --base-url URL             Website origin (default http://127.0.0.1:5173)
  --browser NAME             chromium, chrome, edge, firefox, or webkit
  --headless                 Hide the browser; headed is the default
  --slow-mo-ms N             Pause after each browser action (default 0)
  --skip-engine-check        Skip Try engine before playing a candidate
  --format TYPE              Ordinary game format: constructed or commander
  --deck NAME                Exact visible ordinary-game deck name
  --opponent-deck NAME       Exact visible opponent deck name
  --seed N                   Fixed nonnegative game seed
  --browser-local            Run the ordinary game in Browser (Local)
  --max-actions N            Decision budget (default 200)
  --startup-timeout-ms N     Visible entry-flow budget (default 30000)
  --timeout-ms N             Wall-clock budget per run (default 300000)
  --progress-timeout-ms N    Accepted-progress timeout (default 8000)
  --stall-limit N            Repeated unchanged horizons before stopping (default 2)
  --output DIR               Report and artifact directory
  --no-screenshot            Disable terminal screenshots
  --trace                    Retain a Playwright trace
  --video                    Retain browser video
  --storage-state FILE       Load Playwright cookies/local storage
  --user-data-dir DIR        Use a persistent browser profile
`

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(HELP)
    return
  }
  const parsed = parseArgs(process.argv.slice(2))
  const abort = new AbortController()
  process.once('SIGINT', () => abort.abort())
  process.once('SIGTERM', () => abort.abort())
  const reports = await runBrowserDriver(parsed, abort.signal)
  for (const report of reports) {
    process.stdout.write(
      `${report.input.kind}: ${report.terminal.kind}${report.terminal.classification ? ` (${report.terminal.classification})` : ''} -> ${report.evidence.report}\n`,
    )
  }
  if (
    reports.some(
      (report) =>
        report.terminal.kind === 'failure' ||
        report.terminal.kind === 'budget' ||
        report.terminal.kind === 'interrupted',
    )
  ) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
