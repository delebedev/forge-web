import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CardView } from '@engine/state/gre-state'
import { Card } from './Card'

const concealed: CardView = {
  instanceId: 1,
  grpId: 10,
  name: 'Hidden printed face',
  typeLine: 'Creature',
  manaCost: '{4}{U}',
  powerToughness: '2/2',
  imageUrl: '',
  faceDown: true,
  controllerSeatId: 1,
  tapped: false,
  attacking: false,
  playableLand: false,
  playableSpell: false,
  playableActivation: false,
}

test('a concealed creature displays public stats without its printed identity', () => {
  const html = renderToStaticMarkup(<Card card={concealed} variant="board" />)
  expect(html).toContain('data-pt="2/2"')
  expect(html).toContain('Face-down card')
  expect(html).not.toContain('Hidden printed face')
  expect(html).not.toContain('{4}{U}')
})

test('a face-down land displays no creature stats', () => {
  const html = renderToStaticMarkup(
    <Card card={{ ...concealed, typeLine: 'Land — Forest', powerToughness: '' }} variant="board" />,
  )
  expect(html).not.toContain('data-pt=')
  expect(html).toContain('Face-down card')
})
