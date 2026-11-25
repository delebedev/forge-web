import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

type Level = 'INFO' | 'WARN' | 'ERROR'
export type LogFields = Record<string, string | number | boolean | null | undefined>
export type ErrorSink = (logger: string, message: string, error: unknown) => void

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_HISTORY_DAYS = 7
const TOTAL_SIZE_CAP = 200 * 1024 * 1024
const DAY_MS = 86_400_000
const ARCHIVE = /^forge-web\.(\d{4}-\d{2}-\d{2})\.(\d+)\.log\.gz$/

let release = process.env['SENTRY_RELEASE'] || 'unknown'
let file: RollingLogFile | null = null
let errorSink: ErrorSink | null = null

/** Logback's `%logger{36}`: shortens leading package segments to one letter until the name fits. */
export function abbreviateLogger(name: string, target = 36): string {
  if (name.length <= target) {
    return name
  }
  const parts = name.split('.')
  let toTrim = name.length - target
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] ?? ''
    if (toTrim <= 0) {
      break
    }
    const kept = Math.min(part.length, 1)
    toTrim -= part.length - kept
    parts[i] = part.slice(0, kept)
  }
  return parts.join('.')
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  const stack = error.stack ?? `${error.name}: ${error.message}`
  return stack.replace(/^ {4}at /gm, '\tat ')
}

/**
 * One Logback line: `%date{yyyy-MM-dd'T'HH:mm:ss.SSS,UTC}Z %-5level %logger{36} release=… - %msg %kvp`.
 * Log shipping parses this layout, so it must not change.
 */
export function formatLogLine(
  timeMs: number,
  level: Level,
  logger: string,
  message: string,
  fields: LogFields = {},
  error?: unknown,
  releaseName: string = release,
): string {
  const kvp = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${String(value)}"`)
    .join(' ')
  const line = `${new Date(timeMs).toISOString()} ${level.padEnd(5)} ${abbreviateLogger(logger)} release=${releaseName} - ${message} ${kvp}\n`
  return error === undefined ? line : `${line}${formatError(error)}\n`
}

export function configureLogging(options: {
  release?: string
  directory?: string | null
  errorSink?: ErrorSink | null
}): void {
  if (options.release !== undefined) {
    release = options.release
  }
  if (options.directory !== undefined) {
    file?.close()
    file = options.directory ? new RollingLogFile(options.directory) : null
  }
  if (options.errorSink !== undefined) {
    errorSink = options.errorSink
  }
}

export class Logger {
  readonly name: string

  constructor(name: string) {
    this.name = name
  }

  info(message: string, fields?: LogFields): void {
    this.write('INFO', message, fields)
  }

  warn(message: string, fields?: LogFields, error?: unknown): void {
    this.write('WARN', message, fields, error)
  }

  error(message: string, fields?: LogFields, error?: unknown): void {
    this.write('ERROR', message, fields, error)
    errorSink?.(this.name, message, error)
  }

  private write(level: Level, message: string, fields?: LogFields, error?: unknown) {
    const line = formatLogLine(Date.now(), level, this.name, message, fields, error)
    writeSync(1, line)
    try {
      file?.write(line)
    } catch (cause) {
      writeSync(2, `forge-web.log write failed: ${String(cause)}\n`)
    }
  }
}

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * `forge-web.log`, archived to `forge-web.<UTC date>.<index>.log.gz` daily or at 10 MB. Archives older than
 * seven days, or past 200 MB in total, are removed at startup and after each rollover.
 */
export class RollingLogFile {
  private readonly path: string
  private fd: number
  private size: number
  private period: string
  private readonly directory: string
  private readonly now: () => number
  private readonly maxFileBytes: number

  constructor(directory: string, now: () => number = Date.now, maxFileBytes = MAX_FILE_BYTES) {
    this.directory = directory
    this.now = now
    this.maxFileBytes = maxFileBytes
    mkdirSync(directory, { recursive: true })
    this.path = join(directory, 'forge-web.log')
    this.period = utcDate(existsSync(this.path) ? statSync(this.path).mtimeMs : now())
    this.fd = openSync(this.path, 'a')
    this.size = fstatSync(this.fd).size
    this.cleanup()
  }

  write(line: string): void {
    const today = utcDate(this.now())
    if (today !== this.period) {
      this.rollover()
      this.period = today
    } else if (this.size >= this.maxFileBytes) {
      this.rollover()
    }
    const bytes = Buffer.from(line)
    writeSync(this.fd, bytes)
    this.size += bytes.length
  }

  close(): void {
    closeSync(this.fd)
  }

  private rollover() {
    closeSync(this.fd)
    if (this.size > 0) {
      let index = 0
      while (existsSync(this.archive(this.period, index))) {
        index++
      }
      const target = this.archive(this.period, index)
      const temporary = `${target}.tmp`
      writeFileSync(temporary, gzipSync(readFileSync(this.path)))
      renameSync(temporary, target)
    }
    this.fd = openSync(this.path, 'w')
    this.size = 0
    this.cleanup()
  }

  private archive(date: string, index: number) {
    return join(this.directory, `forge-web.${date}.${index}.log.gz`)
  }

  private cleanup() {
    const oldest = utcDate(this.now() - MAX_HISTORY_DAYS * DAY_MS)
    const archives = readdirSync(this.directory)
      .map((name) => ({ name, match: ARCHIVE.exec(name) }))
      .flatMap(({ name, match }) =>
        match ? [{ name, date: match[1] ?? '', index: Number(match[2]) }] : [],
      )
      .sort((a, b) => (a.date === b.date ? b.index - a.index : a.date < b.date ? 1 : -1))
    let total = 0
    for (const archive of archives) {
      const path = join(this.directory, archive.name)
      total += statSync(path).size
      if (archive.date < oldest || total > TOTAL_SIZE_CAP) {
        unlinkSync(path)
      }
    }
  }
}
