/** Payload-free context retained locally and exported only after an engine failure. */
export type BrowserFailureSnapshot = {
  commandId?: number
  commandPhase?: 'dispatch' | 'execution'
  failureOperation?: string
  failureKind?: string
  atMs?: number
  commands: {
    id: number
    operation: string
    event: string
    atMs: number
    type?: number
    gameStateId?: number
    respId?: number
  }[]
  lastOutput?: { type?: number; gameStateId?: number; msgId?: number; atMs: number }
  runtimeVersion?: string
  runtime: 'available' | 'unavailable' | 'timed-out'
  receivePhase?: string
  phaseElapsedMs?: number
  receiveElapsedMs?: number
  heapUsed?: number
  heapTotal?: number
  heapMax?: number
  initialization?: InitializationObservation
}

export type InitializationObservation = {
  commandId: number
  generation: number
  releaseId: string
  budgetMs: number
  hostElapsedMs?: number
  nominalBudgetRemainingMs?: number
  marks: {
    stage: string
    workerElapsedMs: number
    hostElapsedMs: number
    nominalBudgetRemainingMs: number
  }[]
  resources?: {
    started: number
    completed: number
    firstFailure?: { path: string; kind: string; status?: number; workerElapsedMs: number }
    completedHosted: { path: string; status?: number; workerStartMs: number; durationMs: number }[]
    truncated: boolean
  }
}

export const INITIALIZATION_STAGES = [
  'initializing',
  'jars-ready',
  'library-return',
  'facade-ready',
]
const MAX_HOSTED_RESOURCES = 8

/** Only product asset paths and the selected hosted runtime, never arbitrary URLs. */
function resourcePath(value: unknown, hosted: boolean): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) {
    return
  }
  try {
    const url = new URL(
      value,
      hosted ? 'https://cjrtnc.leaningtech.com/' : 'https://assets.invalid/',
    )
    if (
      hosted
        ? url.origin !== 'https://cjrtnc.leaningtech.com'
        : url.origin !== 'https://assets.invalid'
    ) {
      return
    }
    const path = url.pathname
    if (path.length > 240 || !/^\/[a-zA-Z0-9_./-]+$/.test(path)) {
      return
    }
    if (hosted ? !path.startsWith('/4.3/') : !/^\/(web|lib|catalog)\//.test(path)) {
      return
    }
    return path
  } catch {
    return
  }
}

function initializationObservation(value: unknown): InitializationObservation | undefined {
  if (!record(value)) {
    return
  }
  const { commandId, generation, budgetMs, releaseId } = value
  if (
    integer(commandId) === undefined ||
    integer(generation) === undefined ||
    integer(budgetMs) === undefined ||
    typeof releaseId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(releaseId)
  ) {
    return
  }
  const result: InitializationObservation = {
    commandId: commandId as number,
    generation: generation as number,
    budgetMs: budgetMs as number,
    releaseId,
    hostElapsedMs: integer(value['hostElapsedMs']),
    nominalBudgetRemainingMs: integer(value['nominalBudgetRemainingMs']),
    marks: Array.isArray(value['marks'])
      ? value['marks']
          .filter(record)
          .slice(0, 4)
          .filter(
            (m) =>
              typeof m['stage'] === 'string' &&
              INITIALIZATION_STAGES.includes(m['stage']) &&
              integer(m['workerElapsedMs']) !== undefined &&
              integer(m['hostElapsedMs']) !== undefined &&
              integer(m['nominalBudgetRemainingMs']) !== undefined,
          )
          .map((m) => ({
            stage: String(m['stage']),
            workerElapsedMs: m['workerElapsedMs'] as number,
            hostElapsedMs: m['hostElapsedMs'] as number,
            nominalBudgetRemainingMs: m['nominalBudgetRemainingMs'] as number,
          }))
      : [],
  }
  const resources = value['resources']
  if (record(resources)) {
    const rows = Array.isArray(resources['completedHosted']) ? resources['completedHosted'] : []
    result.resources = {
      started: integer(resources['started']) ?? 0,
      completed: integer(resources['completed']) ?? 0,
      completedHosted: rows
        .slice(0, MAX_HOSTED_RESOURCES)
        .filter(record)
        .flatMap((row) => {
          const path = resourcePath(row['path'], true)
          if (
            !path ||
            integer(row['workerStartMs']) === undefined ||
            integer(row['durationMs']) === undefined
          ) {
            return []
          }
          const status = integer(row['status'])
          return [
            {
              path,
              status: status && status >= 100 && status <= 599 ? status : undefined,
              workerStartMs: row['workerStartMs'] as number,
              durationMs: row['durationMs'] as number,
            },
          ]
        }),
      truncated: resources['truncated'] === true || rows.length > MAX_HOSTED_RESOURCES,
    }
    const failure = resources['firstFailure']
    if (record(failure)) {
      const path = resourcePath(failure['path'], false)
      if (path && integer(failure['workerElapsedMs']) !== undefined) {
        const status = integer(failure['status'])
        result.resources.firstFailure = {
          path,
          kind: allowed(failure['kind'], ['manifest', 'fetch', 'http', 'integrity', 'decode']),
          status: status && status >= 100 && status <= 599 ? status : undefined,
          workerElapsedMs: failure['workerElapsedMs'] as number,
        }
      }
    }
  }
  return result
}

const MAX_COMMANDS = 32
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const integer = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
const allowed = (value: unknown, choices: string[]): string =>
  typeof value === 'string' && choices.includes(value) ? value : 'unknown'

/** Allowlist at the worker and reporting boundaries; never pass through arbitrary fields. */
export function sanitizeBrowserFailureSnapshot(value: unknown): BrowserFailureSnapshot | undefined {
  if (!record(value)) {
    return undefined
  }
  const result: BrowserFailureSnapshot = {
    initialization: initializationObservation(value['initialization']),
    runtime:
      value['runtime'] === 'available'
        ? 'available'
        : value['runtime'] === 'timed-out'
          ? 'timed-out'
          : 'unavailable',
    commands: Array.isArray(value['commands'])
      ? value['commands']
          .filter(record)
          .slice(-MAX_COMMANDS)
          .map((c) => ({
            id: integer(c['id']) ?? 0,
            operation: allowed(c['operation'], [
              'worker-load',
              'initialize',
              'start',
              'send',
              'metadata',
              'advice',
              'validate-puzzle',
              'memory',
              'close',
              'heartbeat',
              'match',
            ]),
            event: allowed(c['event'], ['enqueue', 'start', 'reply', 'error']),
            atMs: integer(c['atMs']) ?? 0,
            type: integer(c['type']),
            gameStateId: integer(c['gameStateId']),
            respId: integer(c['respId']),
          }))
      : [],
  }
  if (
    typeof value['runtimeVersion'] === 'string' &&
    /^\d+(?:\.\d+){1,3}$/.test(value['runtimeVersion']) &&
    value['runtimeVersion'].length <= 32
  ) {
    result.runtimeVersion = value['runtimeVersion']
  }
  if (
    typeof value['receivePhase'] === 'string' &&
    [
      'Idle',
      'Decoding',
      'LockWait',
      'ActionProcessing',
      'HorizonWait',
      'CoordinatorWait',
      'OutputDelivery',
      'Companion',
    ].includes(value['receivePhase'])
  ) {
    result.receivePhase = value['receivePhase']
  }
  for (const key of [
    'commandId',
    'atMs',
    'phaseElapsedMs',
    'receiveElapsedMs',
    'heapUsed',
    'heapTotal',
    'heapMax',
  ] as const) {
    result[key] = integer(value[key])
  }
  if (value['commandPhase'] === 'dispatch' || value['commandPhase'] === 'execution') {
    result.commandPhase = value['commandPhase']
  }
  if (typeof value['failureOperation'] === 'string') {
    result.failureOperation = allowed(value['failureOperation'], [
      'worker-load',
      'initialize',
      'start',
      'send',
      'metadata',
      'advice',
      'validate-puzzle',
      'memory',
      'close',
      'heartbeat',
      'match',
    ])
  }
  if (typeof value['failureKind'] === 'string') {
    result.failureKind = allowed(value['failureKind'], [
      'timeout',
      'command-error',
      'worker-error',
      'message-error',
      'post-message',
      'engine-error',
      'unexpected',
    ])
  }
  const output = value['lastOutput']
  if (record(output)) {
    result.lastOutput = {
      type: integer(output['type']),
      gameStateId: integer(output['gameStateId']),
      msgId: integer(output['msgId']),
      atMs: integer(output['atMs']) ?? 0,
    }
  }
  return result
}
