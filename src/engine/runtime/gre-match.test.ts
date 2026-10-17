import { expect, it } from 'bun:test'
import { parseGreMatchConfig } from './gre-match'
import type { GreStartConfig } from './start'

it('restores authored local puzzle context for an honest restart', () => {
  const config: GreStartConfig = {
    execution: 'browser',
    attemptId: 'attempt-1',
    matchId: 'browser-1',
    challengeId: 'bolt-face',
    gameType: 'puzzle',
    puzzleText: '[metadata]\nName: Find lethal',
    returnPath: '/challenges',
    label: 'Find lethal',
    objective: 'Win this turn.',
  }
  expect(parseGreMatchConfig(JSON.stringify(config))).toEqual(config)
})

it('restores local course decks and the result receipt', () => {
  const config: GreStartConfig = {
    execution: 'browser',
    attemptId: 'attempt-2',
    matchId: 'browser-2',
    coursePlayId: 'course-play-1',
    gameType: 'draft',
    seat1Deck: '40 Plains',
    seat2Deck: '40 Forest',
  }
  expect(parseGreMatchConfig(JSON.stringify(config))).toEqual(config)
})

it('rejects historical server matches and live spectator configurations', () => {
  for (const config of [
    { matchId: 'course-1', wireMatchId: 'wire-1', gameType: 'draft' },
    { execution: 'server', matchId: 'match-1' },
    { execution: 'browser', matchId: 'match-1' },
    { execution: 'browser', attemptId: 'attempt-1', spectatorMode: true },
  ]) {
    expect(parseGreMatchConfig(JSON.stringify(config))).toBeNull()
  }
})

it('normalizes an embedded local puzzle identity without changing its authored text', () => {
  const puzzleText = '[metadata]\nName: Find lethal\n[state]\nhumanhand=Lightning Bolt'
  const restored = parseGreMatchConfig(
    JSON.stringify({ execution: 'browser', puzzle: 'find-lethal', puzzleText }),
  )
  expect(restored).toEqual({ execution: 'browser', challengeId: 'find-lethal', puzzleText })
  expect(
    parseGreMatchConfig(
      JSON.stringify({ execution: 'browser', puzzle: 'old-name', challengeId: 'current-name' }),
    ),
  ).toEqual({ execution: 'browser', challengeId: 'current-name' })
})

it('retires a historical local puzzle without embedded content', () => {
  for (const puzzleText of [undefined, '', '   ']) {
    expect(
      parseGreMatchConfig(
        JSON.stringify({
          execution: 'browser',
          attemptId: 'attempt-1',
          matchId: 'browser-1',
          puzzle: 'missing-content',
          puzzleText,
        }),
      ),
    ).toBeNull()
  }
})
