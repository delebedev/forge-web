export type BrowserReleaseAsset = {
  path: string
  url: string
  bytes: number
  sha256: string
  contentBytes?: number
  contentSha256?: string
}

export type BrowserRelease = {
  schemaVersion: 2
  releaseId: string
  assets: BrowserReleaseAsset[]
  startupAssets: string[]
}

export type BrowserWarmup = {
  status: 'none' | 'partial' | 'complete' | 'failed'
  bytes: number
  durationMs: number
}

let releasePromise: Promise<BrowserRelease> | null = null
let warmupPromise: Promise<BrowserWarmup> | null = null
let warmup: BrowserWarmup = { status: 'none', bytes: 0, durationMs: 0 }

function validRelease(value: unknown): value is BrowserRelease {
  if (!value || typeof value !== 'object') {
    return false
  }
  const release = value as Partial<BrowserRelease>
  return (
    release.schemaVersion === 2 &&
    typeof release.releaseId === 'string' &&
    Array.isArray(release.assets) &&
    Array.isArray(release.startupAssets) &&
    release.assets.every(
      (asset) =>
        asset &&
        typeof asset.path === 'string' &&
        typeof asset.url === 'string' &&
        asset.url.startsWith('/browser-engine/objects/') &&
        Number.isSafeInteger(asset.bytes) &&
        typeof asset.sha256 === 'string',
    )
  )
}

export function getBrowserRelease(): Promise<BrowserRelease> {
  releasePromise ??= fetch('/browser-engine/release.json', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Release manifest download failed (${response.status})`)
      }
      const release: unknown = await response.json()
      if (!validRelease(release)) {
        throw new Error('Release manifest is incompatible. Refresh and retry.')
      }
      return release
    })
    .catch((error: unknown) => {
      releasePromise = null
      throw error
    })
  return releasePromise
}

async function digest(bytes: ArrayBuffer): Promise<string> {
  const value = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function fetchVerified(asset: BrowserReleaseAsset, signal: AbortSignal): Promise<number> {
  const response = await fetch(asset.url, { signal })
  if (!response.ok) {
    throw new Error(`Asset download failed: ${asset.path} (${response.status})`)
  }
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength !== asset.bytes || (await digest(bytes)) !== asset.sha256) {
    throw new Error(`Release asset mismatch: ${asset.path}`)
  }
  return bytes.byteLength
}

/**
 * Downloads one release file and checks it against the manifest. A gzip asset may
 * arrive as stored or already decoded by HTTP; both forms are checked and the
 * decoded bytes are returned.
 */
export async function releaseAssetBytes(path: string): Promise<Uint8Array> {
  const asset = (await getBrowserRelease()).assets.find((candidate) => candidate.path === path)
  if (!asset) {
    throw new Error(`Release asset is missing: ${path}`)
  }
  const response = await fetch(asset.url)
  if (!response.ok) {
    throw new Error(`Asset download failed: ${path} (${response.status})`)
  }
  const bytes = await response.arrayBuffer()
  const actual = await digest(bytes)
  if (bytes.byteLength === asset.bytes && actual === asset.sha256) {
    if (!path.endsWith('.gz')) {
      return new Uint8Array(bytes)
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  if (bytes.byteLength === asset.contentBytes && actual === asset.contentSha256) {
    return new Uint8Array(bytes)
  }
  throw new Error(`Release asset mismatch: ${path}. Refresh and retry.`)
}

export function browserWarmupState(): BrowserWarmup {
  return warmup
}

export function warmBrowserRelease(signal: AbortSignal): Promise<BrowserWarmup> {
  if (warmupPromise) {
    return warmupPromise
  }
  const started = performance.now()
  let transferred = 0
  warmupPromise = getBrowserRelease()
    .then(async (release) => {
      const byPath = new Map(release.assets.map((asset) => [asset.path, asset]))
      const pending = release.startupAssets.map((path) => {
        const asset = byPath.get(path)
        if (!asset) {
          throw new Error(`Release asset is missing: ${path}`)
        }
        return asset
      })
      let next = 0
      const download = async () => {
        while (next < pending.length) {
          transferred += await fetchVerified(pending[next++]!, signal)
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, download))
      return {
        status: 'complete' as const,
        bytes: transferred,
        durationMs: Math.round(performance.now() - started),
      }
    })
    .catch((error: unknown) => {
      warmup = {
        status: signal.aborted ? 'partial' : 'failed',
        bytes: transferred,
        durationMs: Math.round(performance.now() - started),
      }
      warmupPromise = null
      throw error
    })
    .then((result) => (warmup = result))
  return warmupPromise
}
