import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChallengeLauncher } from './ChallengesView'

test('compact launcher exposes curated objectives and direct links', () => {
  const html = renderToStaticMarkup(
    <ChallengeLauncher
      challenges={[
        {
          id: 'gre-game-over-bolt',
          name: 'GRE Game Over - Bolt',
          objective: 'Cast Lightning Bolt to win.',
        },
        {
          id: 'scry-wall-of-runes',
          name: 'Scry Wall of Runes',
          objective: 'Put the revealed card on the bottom.',
        },
      ]}
      onLaunch={() => {}}
    />,
  )

  expect(html).toContain('Challenges')
  expect(html).toContain('href="/challenges/scry-wall-of-runes"')
  expect(html).toContain('Put the revealed card on the bottom.')
  expect(html).not.toContain('Random challenge')
})
