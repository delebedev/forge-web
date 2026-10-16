import { expect, test } from 'bun:test'
import { GreStore } from '@engine/runtime/gre-store'
import type { BoardSnapshot } from '@engine/runtime/snapshot'
import type { CardView, PromptView } from '@engine/state/gre-state'
import { BoardSounds } from './board-sounds'

const empty = new GreStore().snapshot()
function board(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    ...empty,
    connected: true,
    gameStateId: 1,
    currentMatchId: 'test-match',
    viewerSeatId: 1,
    activeSeatId: 2,
    turnNumber: 1,
    viewer: { ...empty.viewer, seatId: 1, lifeTotal: 20 },
    presentation: { seq: 1, lagging: false, hints: [], moves: [] },
    ...overrides,
  }
}
function frame(seq: number, categories: string[]) {
  return {
    seq,
    lagging: false,
    hints: categories.map((category) => ({ kind: 'zone' as const, affectedIds: [101], category })),
    moves: [],
  }
}
const targetPrompt = (selected: boolean): PromptView => ({
  interactionKey: 1,
  kind: 'targets',
  message: 'Choose a target',
  candidates: [
    { targetIdx: 0, targetInstanceId: 101, legalAction: 1, name: 'Target', grpId: 1, selected },
  ],
})

test('draw, land, cast, and mass removal group each semantic cue once', () => {
  const sounds = new BoardSounds()
  expect(sounds.observe(board()).cues).toEqual([])
  expect(
    sounds.observe(
      board({
        gameStateId: 2,
        presentation: frame(2, [
          'Draw',
          'Draw',
          'PlayLand',
          'CastSpell',
          'Destroy',
          'Sacrifice',
          'Discard',
        ]),
      }),
    ).cues,
  ).toEqual(['draw', 'place', 'cast', 'remove'])
})

test('metadata, repeated publications, counters, untap and phase changes are silent', () => {
  const sounds = new BoardSounds()
  sounds.observe(board())
  const next = board({ gameStateId: 2, presentation: frame(2, ['Draw']) })
  expect(sounds.observe(next).cues).toEqual(['draw'])
  expect(sounds.observe({ ...next, logs: ['metadata arrived'] }).cues).toEqual([])
  expect(
    sounds.observe(
      board({
        gameStateId: 3,
        phaseName: 'Combat',
        presentation: {
          seq: 3,
          lagging: false,
          hints: [
            { kind: 'counter', affectedIds: [101] },
            { kind: 'tap', affectedIds: [101] },
          ],
          moves: [],
        },
      }),
    ).cues,
  ).toEqual([])
})

test('taps, abilities, damage and life gain use the displayed step', () => {
  const sounds = new BoardSounds()
  const card = { instanceId: 101, tapped: false } as CardView
  sounds.observe(board({ battlefield: [card] }))
  expect(
    sounds.observe(
      board({
        gameStateId: 2,
        battlefield: [{ ...card, tapped: true }],
        viewer: { ...empty.viewer, seatId: 1, lifeTotal: 17 },
        presentation: {
          seq: 2,
          lagging: false,
          newStackAbility: true,
          moves: [],
          hints: [
            { kind: 'tap', affectedIds: [101] },
            { kind: 'damage', affectedIds: [1] },
          ],
        },
      }),
    ).cues,
  ).toEqual(['tap', 'damage', 'ability'])
  expect(
    sounds.observe(
      board({
        gameStateId: 3,
        viewer: { ...empty.viewer, seatId: 1, lifeTotal: 21 },
        presentation: frame(3, []),
      }),
    ).cues,
  ).toEqual(['gain'])
})

test('hidden card identity cannot choose a different draw sound', () => {
  const sounds = new BoardSounds()
  sounds.observe(board())
  const result = sounds.observe(
    board({
      gameStateId: 2,
      presentation: {
        ...frame(2, ['Draw']),
        moves: [
          {
            key: 'hidden',
            instanceId: 202,
            from: 'library',
            to: 'hand',
            fromOwnerSeatId: 2,
            toOwnerSeatId: 2,
            hidden: true,
          },
        ],
      },
    }),
  )
  expect(result.cues).toEqual(['draw'])
})

test('initial hydration, full replacement, disconnect, new match and backward steps reset silently', () => {
  const sounds = new BoardSounds()
  expect(sounds.observe(board()).reset).toBe(true)
  expect(
    sounds.observe(
      board({ gameStateId: 7, presentation: undefined, viewer: { ...empty.viewer, lifeTotal: 3 } }),
    ),
  ).toEqual({ cues: [], reset: true })
  expect(sounds.observe(board({ gameStateId: 8, presentation: frame(8, ['Draw']) })).cues).toEqual([
    'draw',
    'gain',
  ])
  expect(sounds.observe(board({ connected: false }))).toEqual({ cues: [], reset: true })
  expect(sounds.observe(board({ gameStateId: 9, presentation: frame(9, ['Draw']) })).cues).toEqual(
    [],
  )
  expect(sounds.observe(board({ currentMatchId: 'another' })).reset).toBe(true)
  expect(
    sounds.observe(board({ currentMatchId: 'another', presentation: frame(0, ['Draw']) })),
  ).toEqual({ cues: [], reset: true })
})

test('decisions and turn changes stay quiet, selections click, and drawing starts one cue', () => {
  const sounds = new BoardSounds()
  sounds.observe(board())
  expect(sounds.observe(board({ prompt: targetPrompt(false) })).cues).toEqual([])
  expect(sounds.observe(board({ prompt: targetPrompt(false) })).cues).toEqual([])
  expect(sounds.observe(board({ prompt: targetPrompt(true) })).cues).toEqual(['select'])
  expect(
    sounds.observe(
      board({
        gameStateId: 2,
        activeSeatId: 1,
        turnNumber: 2,
        prompt: targetPrompt(true),
        presentation: frame(2, []),
      }),
    ).cues,
  ).toEqual([])
  expect(
    sounds.observe(
      board({
        gameStateId: 3,
        activeSeatId: 1,
        turnNumber: 2,
        prompt: targetPrompt(true),
        presentation: frame(3, ['Draw']),
      }),
    ).cues,
  ).toEqual(['draw'])
})

test('a new same-kind prompt opens silently after an earlier selected prompt', () => {
  const sounds = new BoardSounds()
  sounds.observe(board({ prompt: targetPrompt(true) }))
  const nextPrompt = { ...targetPrompt(false), interactionKey: 2 }
  expect(sounds.observe(board({ prompt: nextPrompt })).cues).toEqual([])
  expect(
    sounds.observe(board({ prompt: { ...targetPrompt(true), interactionKey: 2 } })).cues,
  ).toEqual(['select'])
})

test('confirmed combat declaration gives one group cue', () => {
  const sounds = new BoardSounds()
  sounds.observe(
    board({
      prompt: {
        interactionKey: 2,
        kind: 'blockers',
        message: 'Block',
        blockers: [
          {
            blockerInstanceId: 101,
            blockerName: 'Blocker',
            blockerGrpId: 1,
            attackers: [{ attackerInstanceId: 202, name: 'Attacker', grpId: 2, selected: true }],
          },
        ],
      } as PromptView,
    }),
  )
  expect(sounds.observe(board({ prompt: null })).cues).toEqual(['combat'])
  expect(sounds.observe(board({ prompt: null })).cues).toEqual([])
})

test('terminal outcome arriving after game over plays once and suppresses other cues', () => {
  const sounds = new BoardSounds()
  sounds.observe(board())
  const ended = board({ gameOver: true })
  expect(sounds.observe(ended).cues).toEqual([])
  const win = { ...ended, outcome: { viewerResult: 'win' } as BoardSnapshot['outcome'] }
  expect(sounds.observe(win).cues).toEqual(['win'])
  expect(sounds.observe(win).cues).toEqual([])
  const loss = new BoardSounds()
  loss.observe(board())
  expect(
    loss.observe({ ...ended, outcome: { viewerResult: 'loss' } as BoardSnapshot['outcome'] }).cues,
  ).toEqual(['lose'])
})

test('token creation without a travel path groups a placement cue', () => {
  const sounds = new BoardSounds()
  sounds.observe(board())
  const token = { instanceId: 101, name: 'Token' } as CardView
  expect(
    sounds.observe(
      board({
        gameStateId: 2,
        battlefield: [token, { ...token, instanceId: 102 }],
        presentation: frame(2, []),
      }),
    ).cues,
  ).toEqual(['place'])
})
