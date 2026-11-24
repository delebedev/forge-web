import { expect, it } from 'bun:test'
import { puzzleChallenge } from './challenge'

it('reads challenge context from puzzle metadata', () => {
  const text = [
    '[metadata]',
    'Name:Brainstorm Order',
    'Goal:Survive',
    'Turns:1',
    'Description:Order the top of your library.',
    '',
    '[state]',
    'Name:ignored',
  ].join('\n')

  expect(puzzleChallenge('brainstorm-order', text)).toEqual({
    id: 'brainstorm-order',
    name: 'Brainstorm Order',
    objective: 'Survive within 1 turn. Order the top of your library.',
  })
  expect(puzzleChallenge('bare', '[state]\n')).toEqual({
    id: 'bare',
    name: 'bare',
    objective: 'Win.',
  })
})
