import { expect, it } from 'bun:test'
import { parseGreMatchConfig } from './gre-match'

it('restores development challenge context with the puzzle match', () => {
  expect(
    parseGreMatchConfig(
      JSON.stringify({
        challengeId: 'bolt-face',
        gameType: 'puzzle',
        matchId: 'match-1',
        returnPath: '/challenges',
        label: 'Find lethal',
        objective: 'Win this turn.',
      }),
    ),
  ).toEqual({
    challengeId: 'bolt-face',
    gameType: 'puzzle',
    matchId: 'match-1',
    returnPath: '/challenges',
    label: 'Find lethal',
    objective: 'Win this turn.',
  })
})

it('restores a candidate id for exact-position restart', () => {
  expect(
    parseGreMatchConfig(
      JSON.stringify({
        candidateId: 'candidate-1',
        gameType: 'puzzle',
        matchId: 'match-1',
        returnPath: '/challenges',
        label: 'Edited puzzle',
        objective: 'Win within 1 turn.',
      }),
    ),
  ).toEqual({
    candidateId: 'candidate-1',
    gameType: 'puzzle',
    matchId: 'match-1',
    returnPath: '/challenges',
    label: 'Edited puzzle',
    objective: 'Win within 1 turn.',
  })
})

it('restores server-created matches without deck text', () => {
  expect(
    parseGreMatchConfig(
      JSON.stringify({
        matchId: 'course-1',
        wireMatchId: 'wire-1',
        deckId: 'deck-1',
        gameType: 'draft',
      }),
    ),
  ).toEqual({
    matchId: 'course-1',
    wireMatchId: 'wire-1',
    deckId: 'deck-1',
    gameType: 'draft',
  })
})
