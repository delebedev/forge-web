import { constants } from 'node:fs'
import { open, rename, stat, unlink } from 'node:fs/promises'
import { InvalidReplay } from './journal.ts'

// Replay file names under the storage root and the durable writes that publish them.

export const APPENDED_JOURNAL = /^(.+)\.browser-\d+\.chunks\.gz$/

export async function length(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export function matchIdOf(name: string): string | null {
  for (const suffix of ['.ndjson.gz', '.ndjson', '.browser.json.gz', '.browser.json']) {
    if (name.endsWith(suffix)) {
      return name.slice(0, -suffix.length)
    }
  }
  return APPENDED_JOURNAL.exec(name)?.[1] ?? null
}

export const isLegacyBrowserReplay = (name: string) =>
  name.endsWith('.browser.json') || name.endsWith('.browser.json.gz')
export const isBrowserReplay = (name: string) =>
  isLegacyBrowserReplay(name) || APPENDED_JOURNAL.test(name)
export const isReplayFile = (name: string) =>
  name.endsWith('.ndjson') || name.endsWith('.ndjson.gz') || isBrowserReplay(name)

/** Writes `member` at `committedBytes`, dropping any unacknowledged tail, and syncs it before returning. */
export async function appendMember(file: string, committedBytes: number, member: Uint8Array) {
  const handle = await open(file, constants.O_CREAT | constants.O_WRONLY)
  try {
    if ((await handle.stat()).size > committedBytes) {
      await handle.truncate(committedBytes)
    }
    if ((await handle.stat()).size !== committedBytes) {
      throw new InvalidReplay('Replay journal is shorter than its commit record')
    }
    let written = 0
    while (written < member.length) {
      written += (
        await handle.write(member, written, member.length - written, committedBytes + written)
      ).bytesWritten
    }
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Publishes `bytes` through a synced temporary file and an atomic rename. */
export async function writeAtomic(file: string, bytes: Uint8Array) {
  const slash = file.lastIndexOf('/')
  const temporary = `${file.slice(0, slash + 1)}.${file.slice(slash + 1)}.${process.hrtime.bigint()}.tmp`
  try {
    const handle = await open(temporary, 'w')
    try {
      let written = 0
      while (written < bytes.length) {
        written += (await handle.write(bytes, written, bytes.length - written, written))
          .bytesWritten
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, file)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}
