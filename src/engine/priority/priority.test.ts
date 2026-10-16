import { expect, test } from 'bun:test'
import type { GreFrameSink, GreFrameSource } from '@engine/runtime/gre-frame-source'
import { GAME_STATE_TYPE_FULL } from '@engine/state/gre-state'
import { GreStore } from '@engine/runtime/gre-store'
import { NO_DWELL } from '@engine/state/presentation-policy'
import { PriorityController } from './priority'

class FakeSource implements GreFrameSource {
  canSend = true
  isOpen = true
  sink: GreFrameSink | null = null
  sent: Uint8Array[] = []
  onSend: (() => void) | null = null

  start(sink: GreFrameSink): void {
    this.sink = sink
  }
  stop(): void {
    this.isOpen = false
  }
  send(bytes: Uint8Array): void {
    this.sent.push(bytes)
    this.onSend?.()
  }
}

import { canRespondOf } from './priority-derive'
import { decodeMessage, type ProtoObject } from '@engine/wire/gre-proto'

function priorityHarness() {
  const store = new GreStore()
  const source = new FakeSource()
  store.attachSource(source)
  const controller = new PriorityController(store)
  return { store, source, controller }
}

function acknowledgeSettings(source: FakeSource, settings: ProtoObject): void {
  source.sink!.onBatch({
    byteLength: 0,
    messages: [{ type: 10, setSettingsResp: { settings } }],
  })
}

function grantPriority(source: FakeSource): void {
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 1,
        gameStateId: 1,
        gameStateMessage: {
          type: GAME_STATE_TYPE_FULL,
          gameStateId: 1,
          turnInfo: {
            phase: 2,
            turnNumber: 1,
            activePlayer: 1,
            priorityPlayer: 1,
            decisionPlayer: 1,
          },
          zones: [],
          gameObjects: [],
        },
      },
      { type: 2, gameStateId: 1, msgId: 2, actionsAvailableReq: { actions: [{ actionType: 5 }] } },
    ],
  })
}

async function settingsOf(bytes: Uint8Array) {
  const outer = await decodeMessage('ClientToMatchServiceMessage', bytes)
  const raw = outer['payload']
  if (!(raw instanceof Uint8Array)) {
    throw new Error('Expected encoded GRE payload')
  }
  return decodeMessage('ClientToGREMessage', raw)
}

async function expectSettingsRequest(
  source: FakeSource,
  index: number,
  request: ProtoObject,
): Promise<void> {
  expect(await settingsOf(source.sent[index]!)).toMatchObject({ setSettingsReq: request })
}

test('turn yield writes settings and passes once, without a continuation loop', async () => {
  const store = new GreStore()
  const source = new FakeSource()
  store.attachSource(source)
  grantPriority(source)
  const controller = new PriorityController(store)
  await controller.passToEndOfTurn()
  expect(source.sent).toHaveLength(2)
  await expectSettingsRequest(source, 0, {
    settings: { autoPassOption: 5 },
    turnNumber: 1,
  })
  grantPriority(source)
  await Promise.resolve()
  expect(source.sent).toHaveLength(2)
})

test('a replacement source never receives the previous match yield pass', async () => {
  const store = new GreStore()
  const source = new FakeSource()
  const replacement = new FakeSource()
  store.attachSource(source)
  grantPriority(source)
  source.onSend = () => store.attachSource(replacement)
  await new PriorityController(store).passToEndOfTurn()
  expect(source.sent).toHaveLength(1)
  expect(replacement.sent).toHaveLength(0)
})

test('scoped stop is acknowledged by settings and cleared on source reset', async () => {
  const { source, controller } = priorityHarness()
  let publications = 0
  controller.subscribe(() => {
    publications += 1
  })
  await controller.toggleStop('opponent:upkeep')
  await expectSettingsRequest(source, 0, {
    settings: { transientStops: [{ stopType: 1, appliesTo: 2, status: 1 }] },
  })
  expect(controller.uiSnapshot().stops.size).toBe(0)
  acknowledgeSettings(source, { transientStops: [{ stopType: 1, appliesTo: 2, status: 1 }] })
  expect(controller.uiSnapshot().stops).toEqual(new Set(['opponent:upkeep']))
  expect(publications).toBeGreaterThan(0)
  await controller.toggleStop('opponent:upkeep')
  await expectSettingsRequest(source, 1, {
    settings: { transientStops: [{ status: 2 }] },
  })
  source.sink!.onReset()
  expect(controller.uiSnapshot().stops.size).toBe(0)
})

test('full control and yield cancellation send bounded settings requests', async () => {
  const { source, controller } = priorityHarness()
  await controller.setFullControl(true)
  await controller.setFullControl(false)
  await controller.cancelYield()
  const messages = await Promise.all(source.sent.map(settingsOf))
  expect(messages).toMatchObject([
    { setSettingsReq: { settings: { autoPassOption: 7, stackAutoPassOption: 4 } } },
    { setSettingsReq: { settings: { autoPassOption: 4, stackAutoPassOption: 4 } } },
    { setSettingsReq: { settings: { autoPassOption: 4, stackAutoPassOption: 4 } } },
  ])
})

test('stack yield restores full control until the player disables it', async () => {
  const { source, controller } = priorityHarness()
  await controller.setFullControl(true)
  acknowledgeSettings(source, { autoPassOption: 7, stackAutoPassOption: 4 })
  grantPriority(source)

  await controller.resolveAll()
  acknowledgeSettings(source, { autoPassOption: 6, stackAutoPassOption: 9 })
  expect(controller.uiSnapshot()).toMatchObject({ fullControl: true, passing: true })
  acknowledgeSettings(source, { autoPassOption: 6, stackAutoPassOption: 4 })
  await new Promise((resolve) => setTimeout(resolve, 0))

  await expectSettingsRequest(source, 3, {
    settings: { autoPassOption: 7, stackAutoPassOption: 4 },
  })
  acknowledgeSettings(source, { autoPassOption: 7, stackAutoPassOption: 4 })
  await controller.setFullControl(false)
  await expectSettingsRequest(source, 4, {
    settings: { autoPassOption: 4, stackAutoPassOption: 4 },
  })
})

test('authoritative clear turns off full control without restoring it', async () => {
  const { source, controller } = priorityHarness()
  await controller.setFullControl(true)
  acknowledgeSettings(source, { autoPassOption: 7 })
  expect(controller.uiSnapshot().fullControl).toBe(true)

  acknowledgeSettings(source, { autoPassOption: 6 })
  expect(controller.uiSnapshot().fullControl).toBe(false)
  expect(source.sent).toHaveLength(1)
})

test('explicit disable during a yield prevents restoration', async () => {
  const { source, controller } = priorityHarness()
  await controller.setFullControl(true)
  acknowledgeSettings(source, { autoPassOption: 7 })
  grantPriority(source)
  await controller.resolveAll()
  acknowledgeSettings(source, { autoPassOption: 6, stackAutoPassOption: 9 })

  await controller.setFullControl(false)
  acknowledgeSettings(source, { autoPassOption: 6, stackAutoPassOption: 4 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(controller.uiSnapshot().fullControl).toBe(false)
  expect(source.sent).toHaveLength(4)
})

test('reconnect waits for settings and follows an authoritative clear', async () => {
  const { store, source, controller } = priorityHarness()
  await controller.setFullControl(true)
  acknowledgeSettings(source, { autoPassOption: 7 })

  const replacement = new FakeSource()
  store.attachSource(replacement)
  replacement.sink!.onOpen()
  expect(replacement.sent).toHaveLength(0)
  replacement.sink!.onBatch({
    byteLength: 0,
    messages: [
      { type: 7, connectResp: { settings: { autoPassOption: 6, stackAutoPassOption: 4 } } },
    ],
  })
  expect(controller.uiSnapshot().fullControl).toBe(false)
  expect(replacement.sent).toHaveLength(0)
})

test('new match clears full control intent before settings arrive', async () => {
  const { store, source, controller } = priorityHarness()
  await controller.setFullControl(true)
  acknowledgeSettings(source, { autoPassOption: 7 })

  store.currentMatchId = 'next-match'
  const replacement = new FakeSource()
  store.attachSource(replacement)
  replacement.sink!.onOpen()
  expect(controller.uiSnapshot().fullControl).toBe(false)
  expect(replacement.sent).toHaveLength(0)
})

test('priority reads the newest stack while presentation is holding an older step', () => {
  const store = new GreStore()
  const source = new FakeSource()
  store.attachSource(source)
  store.setDwellPolicy({ dwellFor: (step) => (step.state.gameStateId === 2 ? 1_000 : 0) })

  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 1,
        gameStateId: 1,
        gameStateMessage: {
          type: GAME_STATE_TYPE_FULL,
          gameStateId: 1,
          turnInfo: {
            phase: 2,
            turnNumber: 1,
            activePlayer: 2,
            priorityPlayer: 1,
            decisionPlayer: 1,
          },
          zones: [
            { zoneId: 31, type: 2, ownerSeatId: 1, objectInstanceIds: [100] },
            { zoneId: 28, type: 3, ownerSeatId: 1, objectInstanceIds: [] },
            { zoneId: 27, type: 4, ownerSeatId: 0, objectInstanceIds: [] },
          ],
          gameObjects: [
            { instanceId: 100, type: 1, grpId: 7, ownerSeatId: 1, controllerSeatId: 1 },
          ],
        },
      },
      {
        type: 2,
        gameStateId: 1,
        msgId: 2,
        actionsAvailableReq: {
          actions: [
            { actionType: 1, instanceId: 100, grpId: 7, shouldStop: true },
            { actionType: 5 },
          ],
        },
      },
    ],
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 1,
        gameStateId: 2,
        gameStateMessage: {
          type: 2,
          gameStateId: 2,
          annotations: [{ id: 1, affectedIds: [100], type: [4] }],
          gameObjects: [
            {
              instanceId: 100,
              type: 1,
              grpId: 7,
              ownerSeatId: 1,
              controllerSeatId: 1,
              isTapped: true,
            },
          ],
        },
      },
    ],
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 1,
        gameStateId: 3,
        gameStateMessage: {
          type: 2,
          gameStateId: 3,
          gameObjects: [
            {
              instanceId: 100,
              type: 1,
              grpId: 7,
              ownerSeatId: 1,
              controllerSeatId: 1,
              isTapped: true,
            },
            { instanceId: 200, type: 1, grpId: 8, ownerSeatId: 2, controllerSeatId: 2 },
          ],
          zones: [{ zoneId: 27, type: 4, ownerSeatId: 0, objectInstanceIds: [200] }],
        },
      },
    ],
  })

  expect(store.snapshot().stack).toHaveLength(0)
  expect(store.authoritativeSnapshot().stack).toHaveLength(1)
  expect(canRespondOf(store.authoritativeSnapshot())).toBe(true)
  store.setDwellPolicy(NO_DWELL)
})
