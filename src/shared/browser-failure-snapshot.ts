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
