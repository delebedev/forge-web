import { expect, it } from 'bun:test'
import { challengeSummaryToChallenge } from './challenge'

it('maps a challenge summary into browser challenge context', () => {
  const challenge = challengeSummaryToChallenge({
    challengeId: 'bolt-face',
    name: 'One red line',
    objective: 'Cast Lightning Bolt at the opponent.',
  })

  expect(challenge).toEqual({
    id: 'bolt-face',
    name: 'One red line',
    objective: 'Cast Lightning Bolt at the opponent.',
  })
})
