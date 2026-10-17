import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import type { RunConfig, RunInput } from './types.ts'

export type ParsedConfig = {
  config: RunConfig
  inputs: RunInput[]
}

function positive(flag: string, value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

function nonnegative(flag: string, value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a nonnegative integer`)
  }
  return parsed
}

function required(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

export function parseArgs(
  args: string[],
  readCandidate: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): ParsedConfig {
  let baseUrl = 'http://127.0.0.1:5173'
  let browser: RunConfig['browser'] = 'chromium'
  let headed = true
  let slowMoMs = 0
  let maxActions = 200
  let startupTimeoutMs = 240_000
  let timeoutMs = 300_000
  let progressTimeoutMs = 8_000
  let stallLimit = 2
  let outputDir = resolve('test-results/browser-driver')
  let screenshot = true
  let trace = false
  let video = false
  let userDataDir: string | undefined
  let storageState: string | undefined
  const puzzles: string[] = []
  const candidates: string[] = []
  let skipEngineCheck = false
  let url: string | undefined
  let ordinary = false
  let browserLocal = false
  let ordinaryFormat: 'constructed' | 'commander' = 'constructed'
  let ordinaryDeck: string | undefined
  let ordinaryOpponentDeck: string | undefined
  let ordinarySeed: number | undefined

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!
    const next = () => required(flag, args[++index])
    switch (flag) {
      case '--base-url':
        baseUrl = next()
        break
      case '--browser': {
        const requested = next()
        if (!['chromium', 'chrome', 'edge', 'firefox', 'webkit'].includes(requested)) {
          throw new Error('--browser must be chromium, chrome, edge, firefox, or webkit')
        }
        browser = requested as RunConfig['browser']
        break
      }
      case '--puzzle':
        puzzles.push(next())
        break
      case '--candidate':
        candidates.push(resolve(next()))
        break
      case '--skip-engine-check':
        skipEngineCheck = true
        break
      case '--url':
        url = next()
        break
      case '--ordinary':
        ordinary = true
        break
      case '--browser-local':
        browserLocal = true
        break
      case '--format': {
        const format = next()
        if (format !== 'constructed' && format !== 'commander') {
          throw new Error('--format must be constructed or commander')
        }
        ordinaryFormat = format
        break
      }
      case '--deck':
        ordinaryDeck = next()
        break
      case '--opponent-deck':
        ordinaryOpponentDeck = next()
        break
      case '--seed':
        ordinarySeed = nonnegative(flag, next())
        break
      case '--headless':
        headed = false
        break
      case '--headed':
        headed = true
        break
      case '--slow-mo-ms':
        slowMoMs = nonnegative(flag, next())
        break
      case '--max-actions':
        maxActions = positive(flag, next())
        break
      case '--startup-timeout-ms':
        startupTimeoutMs = positive(flag, next())
        break
      case '--timeout-ms':
        timeoutMs = positive(flag, next())
        break
      case '--progress-timeout-ms':
        progressTimeoutMs = positive(flag, next())
        break
      case '--stall-limit':
        stallLimit = positive(flag, next())
        break
      case '--output':
        outputDir = resolve(next())
        break
      case '--no-screenshot':
        screenshot = false
        break
      case '--trace':
        trace = true
        break
      case '--video':
        video = true
        break
      case '--user-data-dir':
        userDataDir = resolve(next())
        break
      case '--storage-state':
        storageState = resolve(next())
        break
      default:
        throw new Error(`Unknown argument: ${flag}`)
    }
  }

  const modes =
    Number(puzzles.length > 0) +
    Number(candidates.length > 0) +
    Number(url != null) +
    Number(ordinary)
  if (modes !== 1) {
    throw new Error('Choose exactly one entry mode: --puzzle, --candidate, --url, or --ordinary')
  }
  if (!candidates.length && skipEngineCheck) {
    throw new Error('--skip-engine-check requires --candidate')
  }
  if (
    !ordinary &&
    (ordinaryDeck ||
      ordinaryOpponentDeck ||
      ordinarySeed != null ||
      ordinaryFormat !== 'constructed')
  ) {
    throw new Error('--format, --deck, --opponent-deck, and --seed require --ordinary')
  }
  if (!ordinary && browserLocal) {
    throw new Error('--browser-local requires --ordinary')
  }
  if (userDataDir && storageState) {
    throw new Error('Choose only one of --user-data-dir or --storage-state')
  }
  const inputs: RunInput[] =
    puzzles.length > 0
      ? puzzles.map((puzzleId) => ({ kind: 'puzzle', puzzleId }))
      : candidates.length > 0
        ? candidates.map((sourcePath) => ({
            kind: 'candidate',
            sourcePath,
            puzzleText: readCandidate(sourcePath),
            tryEngine: false,
          }))
        : url
          ? [{ kind: 'url', url }]
          : [
              {
                kind: 'ordinary',
                format: ordinaryFormat,
                ...(ordinaryDeck ? { deck: ordinaryDeck } : {}),
                ...(ordinaryOpponentDeck ? { opponentDeck: ordinaryOpponentDeck } : {}),
                ...(ordinarySeed == null ? {} : { seed: ordinarySeed }),
                execution: 'browser' as const,
              },
            ]

  return {
    inputs,
    config: {
      baseUrl: new URL(baseUrl).origin,
      browser,
      headed,
      slowMoMs,
      maxActions,
      startupTimeoutMs,
      timeoutMs,
      progressTimeoutMs,
      stallLimit,
      outputDir,
      screenshot,
      trace,
      video,
      ...(userDataDir ? { userDataDir } : {}),
      ...(storageState ? { storageState } : {}),
    },
  }
}
