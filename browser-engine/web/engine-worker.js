const runtimeVersion = '4.3'
let runtimeLoadError = ''
try {
  importScripts(`https://cjrtnc.leaningtech.com/${runtimeVersion}/loader.js`)
} catch {
  runtimeLoadError =
    'The game runtime could not load. Check whether your browser or an extension blocks cjrtnc.leaningtech.com, then retry or use another browser.'
}

let runtime
let diagnosticWake = null
let commandQueue = Promise.resolve()
let activeMatchId = null
let commandError = null
let release
let cardImages
let initializationObservation
const MAX_HOSTED_RESOURCES = 8
const initializeElapsed = () =>
  Math.max(0, Math.round(performance.now() - initializationObservation.origin))
function initializationResources() {
  if (!initializationObservation) {
    return undefined
  }
  const completedHosted = []
  let truncated = false
  try {
    // Completed entries only. Hidden cross-origin status is unknown, not success.
    for (const entry of performance.getEntriesByType('resource')) {
      const url = new URL(entry.name)
      if (
        url.origin !== 'https://cjrtnc.leaningtech.com' ||
        !url.pathname.startsWith(`/${runtimeVersion}/`) ||
        url.pathname.length > 240 ||
        !/^\/[a-zA-Z0-9_./-]+$/.test(url.pathname)
      ) {
        continue
      }
      if (completedHosted.length === MAX_HOSTED_RESOURCES) {
        truncated = true
        break
      }
      completedHosted.push({
        path: url.pathname,
        status: entry.responseStatus > 0 ? entry.responseStatus : undefined,
        workerStartMs: Math.max(0, Math.round(entry.startTime)),
        durationMs: Math.max(0, Math.round(entry.duration)),
      })
    }
  } catch {
    /* Resource Timing is optional and may hide cross-origin details. */
  }
  const { commandId, generation, started, completed, firstFailure } = initializationObservation
  return { commandId, generation, started, completed, firstFailure, completedHosted, truncated }
}
const report = (event, data) =>
  postMessage({
    event,
    data:
      event === 'failure-diagnostic'
        ? { ...data, initializationResources: initializationResources() }
        : data,
    at: performance.now(),
  })
function initializeMark(event, data = {}) {
  report(event, {
    ...data,
    commandId: initializationObservation.commandId,
    generation: initializationObservation.generation,
    workerElapsedMs: initializeElapsed(),
  })
}
report('worker-online', { runtimeReady: !runtimeLoadError, runtimeVersion })

async function digest(bytes) {
  const value = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function releaseAsset(path, decompressGzip = false) {
  const observation = initializationObservation
  if (observation) {
    observation.started++
  }
  const diagnosticPath = `/${path}`
  const failure = {
    path:
      diagnosticPath.length <= 240 && /^\/(web|lib|catalog)\/[a-zA-Z0-9_./-]+$/.test(diagnosticPath)
        ? diagnosticPath
        : undefined,
    kind: 'manifest',
    workerElapsedMs: 0,
  }
  try {
    const bytes = await loadReleaseAsset(path, decompressGzip, failure)
    if (observation) {
      observation.completed++
    }
    return bytes
  } catch (error) {
    if (observation && !observation.firstFailure) {
      observation.firstFailure = { ...failure, workerElapsedMs: initializeElapsed() }
    }
    throw error
  }
}

async function loadReleaseAsset(path, decompressGzip, failure) {
  const expected = release.assets.find((asset) => asset.path === path)
  if (!expected) {
    throw new Error(`Release asset is missing: ${path}`)
  }
  failure.kind = 'fetch'
  const response = await fetch(expected.url)
  if (!response.ok) {
    failure.kind = 'http'
    failure.status = response.status
    throw new Error(`Asset download failed: ${path} (${response.status})`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  failure.kind = 'integrity'
  const actual = await digest(bytes)
  const stored = bytes.byteLength === expected.bytes && actual === expected.sha256
  const delivered =
    path.endsWith('.gz') &&
    bytes.byteLength === expected.contentBytes &&
    actual === expected.contentSha256
  if (!stored && !delivered) {
    failure.kind = 'integrity'
    throw new Error(`Release asset mismatch: ${path}. Refresh and retry.`)
  }
  if (decompressGzip && stored) {
    failure.kind = 'decode'
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  return bytes
}

async function releaseJson(path) {
  return JSON.parse(new TextDecoder().decode(await releaseAsset(path)))
}

async function resource(name, expectedSha256) {
  const bytes = await releaseAsset(`catalog/${name}`, name.endsWith('.gz'))
  if (name.endsWith('.gz')) {
    name = name.slice(0, -3)
  }
  const actual = await digest(bytes)
  if (actual !== expectedSha256) {
    throw new Error(`Catalog checksum mismatch: ${name}`)
  }
  const path = `/str/${name}`
  cheerpOSAddStringFile(path, bytes)
  return { path, bytes: bytes.byteLength }
}

onmessage = ({ data }) => {
  if (data?.type === 'heartbeat') {
    postMessage({ event: 'heartbeat', data: { nonce: data.nonce }, at: performance.now() })
    return
  }
  if (data?.type === 'failure-diagnostic') {
    // Bypass the queue: the active receive may never return.
    if (diagnosticWake) {
      diagnosticWake()
    } else {
      report('failure-diagnostic', { runtime: 'unavailable' })
    }
    return
  }
  const enqueuedAt = performance.now()
  commandQueue = commandQueue.then(() => dispatch(data, enqueuedAt))
}

async function dispatch(data, enqueuedAt) {
  if (data.id != null) {
    report('command-start', {
      id: data.id,
      type: data.type,
      queueDurationMs: Math.max(0, Math.round(performance.now() - enqueuedAt)),
    })
  }
  commandError = null
  try {
    let result
    switch (data.type) {
      case 'initialize': {
        initializationObservation = {
          commandId: data.id,
          generation: data.generation,
          origin: performance.now(),
          started: 0,
          completed: 0,
        }
        initializeMark('initializing')
        if (runtimeLoadError) {
          throw new Error(runtimeLoadError)
        }
        release = data.release
        if (release?.schemaVersion !== 2 || !Array.isArray(release.assets)) {
          throw new Error('Release manifest is incompatible. Refresh and retry.')
        }
        await releaseAsset('web/engine-worker.js')
        report('release-ready', { releaseId: release.releaseId })
        cardImages = JSON.parse(
          new TextDecoder().decode(await releaseAsset('catalog/card-images.json.gz', true)),
        )
        const preloadResources = await releaseJson('web/runtime-preload.json')
        await cheerpjInit({
          version: 17,
          preloadResources,
          natives: {
            Java_forge_web_browser_BrowserCallbacks_awaitFailureDiagnostic: async () =>
              new Promise((resolve) => {
                diagnosticWake = resolve
              }),
            Java_forge_web_browser_BrowserCallbacks_emit: async (_lib, event, value) => {
              if (event === 'replay-step') {
                return
              }
              if (event === 'error') {
                commandError = value
              } else if (event === 'failure-diagnostic') {
                report(event, JSON.parse(value))
              } else if (event === 'frame') {
                const [matchId, payload] = JSON.parse(value)
                report(event, { matchId, payload })
              } else {
                report(event, value)
              }
            },
          },
        })
        report('runtime-ready')
        const jars = await releaseJson('lib/classpath.json')
        let jarBytes = 0
        const totalJarBytes = jars.reduce(
          (total, name) =>
            total + release.assets.find((asset) => asset.path === `lib/${name}`).bytes,
          0,
        )
        const classpath = await Promise.all(
          jars.map(async (name, index) => {
            const bytes = await releaseAsset(`lib/${name}`)
            jarBytes += bytes.byteLength
            report('jars-progress', { loadedBytes: jarBytes, totalBytes: totalJarBytes })
            const path = `/str/browser-library-${index}.jar`
            cheerpOSAddStringFile(path, bytes)
            return path
          }),
        )
        initializeMark('jars-ready', { count: jars.length, bytes: jarBytes })
        const library = await cheerpjRunLibrary(classpath.join(':'))
        initializeMark('library-return')
        runtime = await library.forge.web.browser.BrowserRuntime
        initializeMark('facade-ready')
        const manifest = await releaseJson('catalog/manifest.json')
        report('catalog-download-start', {
          bytes:
            manifest.archive.compressedBytes +
            (manifest.index?.bytes ?? 0) +
            (manifest.cardNames?.bytes ?? 0),
        })
        const archive = await resource(manifest.archive.file, manifest.archive.sha256)
        const index = manifest.index && (await resource(manifest.index.file, manifest.index.sha256))
        let cardNames = null
        if (manifest.cardNames) {
          try {
            cardNames = await resource(manifest.cardNames.file, manifest.cardNames.sha256)
          } catch (error) {
            report('card-name-index-unavailable', String(error))
          }
        }
        report('catalog-assets-ready', { indexed: Boolean(index) })
        const destination = `/files/browser-engine/${manifest.archive.sha256}`
        const version =
          index && cardNames
            ? await runtime.initializeWithCardNames(
                archive.path,
                destination,
                index.path,
                manifest.archive.sha256,
                true,
                cardNames.path,
              )
            : index
              ? await runtime.initializeIndexed(
                  archive.path,
                  destination,
                  index.path,
                  manifest.archive.sha256,
                  true,
                )
              : await runtime.initialize(archive.path, destination)
        if (!version) {
          throw new Error('Catalog initialization failed; see engine error')
        }
        const catalogAssets = [archive, index, cardNames].filter(Boolean)
        catalogAssets.forEach((asset) => cheerpOSRemoveStringFile(asset.path))
        result = version
        report('initialized', version)
        break
      }
      case 'start': {
        const response = await runtime.start(
          data.deck1,
          data.deck2,
          data.seed ?? 42,
          data.matchId ?? '',
          data.gameType ?? 'constructed',
          data.puzzleId ?? '',
          data.puzzleText ?? '',
        )
        if (!response) {
          throw new Error('Match launch failed; see engine error')
        }
        result = JSON.parse(response)
        activeMatchId = result.matchId
        report('started', result)
        break
      }
      case 'send':
        if (
          !(data.silent
            ? await runtime.receiveSilently(data.payload)
            : await runtime.receive(data.payload))
        ) {
          throw new Error('Game action failed')
        }
        break
      case 'metadata':
        result = JSON.parse(await runtime.metadata(data.ids.join(',')))
        for (const card of Object.values(result)) {
          const name = card.name
            .replace(/ Token$/, '')
            .trim()
            .toLowerCase()
          card.imageUrl =
            cardImages[`${card.isToken && card.types !== 'Dungeon' ? 1 : 0}:${name}`]?.[0] ?? null
          delete card.isToken
        }
        break
      case 'validate-puzzle':
        result = JSON.parse(await runtime.validatePuzzle(data.text))
        break
      case 'advice':
        result = JSON.parse(await runtime.advice())
        break
      case 'memory':
        result = {
          ...JSON.parse(await runtime.memory()),
          memoryMeasurementAvailable: true,
        }
        report('memory', result)
        break
      case 'close':
        if (!(await runtime.close())) {
          throw new Error('Match close failed; see engine error')
        }
        activeMatchId = null
        break
    }
    if (data.id != null) {
      report('reply', { id: data.id, result })
    }
  } catch (error) {
    const message =
      runtimeLoadError && data.type === 'initialize'
        ? runtimeLoadError
        : String(commandError ?? error?.stack ?? error)
    if (data.id != null) {
      report('command-error', { type: data.type, message })
      report('reply', { id: data.id, error: message })
    } else if (activeMatchId) {
      report('match-error', JSON.stringify([activeMatchId, message]))
    } else {
      report('command-error', { type: data.type, message })
    }
  }
}
