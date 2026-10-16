import { expect, it } from 'bun:test'
import type { BoardSnapshot } from '@engine/runtime/snapshot'
import { createExternalStore, type SnapshotSource } from './create-external-store'

function snapshot(status: string): BoardSnapshot {
  const viewer = {
    seatId: 1,
    teamId: 1,
    lifeTotal: 20,
    startingLifeTotal: 20,
    handCount: 0,
    libraryCount: 0,
    graveyardCount: 0,
    exileCount: 0,
    isViewer: true,
    hasPriority: false,
    isActive: false,
  }
  return {
    connected: false,
    status,
    connectionClose: null,
    gameStateId: 0,
    phaseName: '',
    stepName: '',
    turnNumber: 0,
    activeSeatId: 0,
    prioritySeatId: 0,
    decisionSeatId: 0,
    gameOver: false,
    outcome: null,
    viewer,
    opponent: null,
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    sideboard: [],
    opponentHand: [],
    opponentBattlefield: [],
    opponentGraveyard: [],
    opponentExile: [],
    stack: [],
    stackCount: 0,
    targetArrows: [],
    legalActions: [],
    nonHandActionCards: [],
    prompt: null,
    canPass: false,
    viewerSeatId: 1,
    opponentSeatId: 0,
    currentMatchId: '',
    currentGameType: null,
    messageTypeFeed: [],
    lastMessage: '',
    trafficStats: { sentBytes: 0, recvBytes: 0, sentMessages: 0, recvMessages: 0 },
    logs: [],
    errorCount: 0,
  }
}

it('keeps one stable snapshot between publications', () => {
  let current = snapshot('idle')
  let publish = () => {}
  const source: SnapshotSource<BoardSnapshot> = {
    snapshot: () => current,
    subscribe(listener) {
      publish = listener
      return () => {
        publish = () => {}
      }
    },
  }
  const store = createExternalStore(source)
  const first = store.getSnapshot()
  let notifications = 0
  const unsubscribe = store.subscribe(() => {
    notifications += 1
  })

  expect(store.getSnapshot()).toBe(first)
  current = snapshot('receiving GRE')
  expect(store.getSnapshot()).toBe(first)
  publish()
  expect(store.getSnapshot()).toBe(current)
  expect(notifications).toBe(1)

  unsubscribe()
  store.destroy()
})
