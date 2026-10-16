import { buildBoardProjection } from '@engine/state/gre-projection'
import {
  applyActions,
  applyGsm,
  EMPTY_GAME_STATE,
  type GameState,
} from '@engine/state/gre-accumulator'
import { asNumber, isRecord, GAME_STATE_TYPE_FULL } from '@engine/state/gre-state'
import { decodeMessage, enumValue, type ProtoObject } from '@engine/wire/gre-proto'
import { buildBootstrapMessages } from '@engine/wire/gre-bootstrap'
import { BrowserReplayCollector } from '@engine/replay/browser-replay-collector'
import type { TranscriptBundle } from '@engine/replay/gre-transcript'
import type { BrowserEngine, BrowserMatch } from './browser-engine'
import type { GreFrameBatch } from './gre-frame-source'
import type { GreStartConfig } from './start'

/** Rebuild only through the request preceding the final submitted response. */
export async function replayBrowserMatch(
  engine: BrowserEngine,
  match: BrowserMatch,
  config: GreStartConfig,
  journal: TranscriptBundle,
  signal: AbortSignal,
) {
  if (
    journal.status?.truncated ||
    !journal.context?.engineBuild ||
    engine.releaseId !== journal.context.engineBuild
  ) {
    throw new Error('The saved match is incomplete or uses a different engine version.')
  }
  const greType = await enumValue('ClientToMatchServiceMessageType', 'ClientToGremessage')
  const inputs: { seq: number; bytes: Uint8Array; gre: ProtoObject }[] = []
  for (const event of journal.events ?? []) {
    if (
      event.direction !== 'inbound' ||
      !isRecord(event.message) ||
      typeof event.message['payload'] !== 'string'
    ) {
      continue
    }
    const bytes = Uint8Array.from(atob(event.message['payload']), (c) => c.charCodeAt(0))
    const outer = await decodeMessage('ClientToMatchServiceMessage', bytes)
    if (outer['clientToMatchServiceMessageType'] !== greType) {
      continue
    }
    const gre = await decodeMessage('ClientToGREMessage', outer['payload'] as Uint8Array)
    inputs.push({ seq: event.seq, bytes, gre })
  }
  const last = [...inputs].reverse().find((input) => asNumber(input.gre['respId']) > 0)
  if (!last) {
    throw new Error('No saved decision is available to recover.')
  }
  const expected = (journal.events ?? [])
    .filter((event) => event.direction === 'outbound' && event.seq < last.seq)
    .flatMap((event) => journal.batches[event.batchIndex]?.messages ?? [])
    .filter(isRecord)
  const target = expected.find(
    (message) =>
      message['gameStateId'] === last.gre['gameStateId'] && message['msgId'] === last.gre['respId'],
  )
  if (!target) {
    throw new Error('The saved decision request is missing.')
  }
  const connectType = await enumValue('GREMessageType', 'ConnectResp_695e')
  const collector = new BrowserReplayCollector(config)
  let hydrating = false
  const batches: GreFrameBatch[] = []
  let failure: Error | null = null
  match.source.start({
    onOpen() {},
    onReset() {},
    onClose: () => {
      failure = new Error('The replayed match closed.')
    },
    onError: () => {
      failure = new Error('The replayed match failed.')
    },
    onBatch: (batch) => {
      if (batch.authenticated) {
        return
      }
      if (!hydrating) {
        failure = new Error('Replay delivered an intermediate update.')
        return
      }
      batches.push(batch)
      collector.incoming(batch.messages)
    },
  })
  function assertHealthy() {
    if (failure) {
      throw failure
    }
  }
  const bootstrap = await buildBootstrapMessages(match.matchId, journal.viewerSeatId)
  const prefix = inputs.filter((input) => input.seq < last.seq)
  signal.throwIfAborted()
  for (const bytes of [...bootstrap, ...prefix.map((input) => input.bytes)]) {
    signal.throwIfAborted()
    await engine.sendAndWait(match.source, bytes, true)
    assertHealthy()
  }
  signal.throwIfAborted()
  // Fresh handshake routing keeps the continuation journal replayable under its new match id.
  for (const bytes of bootstrap) {
    collector.outgoing(bytes)
  }
  const savedInputs = new Map(prefix.map((input) => [input.seq, input.bytes]))
  // Keep the known history for diagnostics; only the final resync hydrates the board.
  for (const event of journal.events ?? []) {
    if (event.seq >= last.seq) {
      break
    }
    if (event.direction === 'outbound') {
      collector.incoming((journal.batches[event.batchIndex]?.messages ?? []).filter(isRecord))
    } else if (event.direction === 'inbound') {
      const bytes = savedInputs.get(event.seq)
      if (bytes) {
        collector.outgoing(bytes)
      }
    }
  }
  hydrating = true
  for (const bytes of bootstrap) {
    signal.throwIfAborted()
    collector.outgoing(bytes)
    await engine.sendAndWait(match.source, bytes)
  }
  await match.source.flush()
  assertHealthy()
  const resyncIndex = batches.findIndex((batch) =>
    batch.messages.some((message) => message['type'] === connectType),
  )
  const resync =
    resyncIndex < 0 ? [] : batches.slice(resyncIndex).flatMap((batch) => batch.messages)
  const full = resync.find(
    (message) =>
      isRecord(message['gameStateMessage']) &&
      message['gameStateMessage']['type'] === GAME_STATE_TYPE_FULL,
  )
  const request = resync.find((message) => message['type'] === target['type'])
  const decision = (message: ProtoObject) =>
    Object.fromEntries(
      Object.entries(message).filter(([field]) => field !== 'gameStateId' && field !== 'msgId'),
    )
  // ponytail: the final decision verifies continuity; hidden state needs an engine checksum.
  if (
    !request ||
    !full ||
    full['gameStateId'] !== request['gameStateId'] ||
    request['gameStateId'] !==
      expected.reduce((latest, message) => Math.max(latest, asNumber(message['gameStateId'])), 0) +
        1 ||
    JSON.stringify(decision(request)) !== JSON.stringify(decision(target)) ||
    stateFingerprint(expected) !== stateFingerprint(batches.flatMap((batch) => batch.messages))
  ) {
    throw new Error('The recovered decision differs from the saved match.')
  }
  return { collector, batches, request }
}

function stateFingerprint(messages: ProtoObject[]): string {
  const state = messages.reduce<GameState>((state, message) => {
    const queued = message['queuedGameStateMessage']
    const gsm =
      message['gameStateMessage'] ?? (isRecord(queued) ? queued['gameStateMessage'] : undefined)
    if (isRecord(gsm)) {
      state = applyGsm(state, gsm)
    }
    return isRecord(message['actionsAvailableReq']) ? applyActions(state, message) : state
  }, EMPTY_GAME_STATE)
  return JSON.stringify(
    {
      board: buildBoardProjection(state, new Map(), false),
      turn: state.turn,
      persistentAnnotations: state.persistentAnnotations,
      gameOver: state.gameOver,
      outcome: state.outcome,
    },
    (_field, value: unknown) =>
      value instanceof Map
        ? [...value.entries()].sort(([a], [b]) => Number(a) - Number(b))
        : isRecord(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value,
  )
}
