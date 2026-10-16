import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { OppHandFan } from './OppHandFan'
import type { CardView } from '@engine/state/gre-state'

test('opponent hand exposes its count without card identities', () => {
  const html = renderToStaticMarkup(<OppHandFan count={12} />)

  expect(html).toContain('data-zone-count="12"')
  expect(html).toContain('aria-label="Opponent hand: 12 cards"')
  expect(html).not.toContain('data-card')
})

test('known faces are inspectable without making concealed slots or game actions identifiable', () => {
  const card: CardView = {
    instanceId: 7,
    grpId: 8,
    name: 'Grizzly Bears',
    typeLine: 'Creature',
    manaCost: '{1}{G}',
    powerToughness: '2/2',
    imageUrl: '',
    controllerSeatId: 2,
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
  }
  const html = renderToStaticMarkup(<OppHandFan count={3} known={[card]} onInspect={() => {}} />)
  expect(html).toContain('data-zone-count="3"')
  expect(html).toContain('1 known · 2 concealed')
  expect(html).toContain('Inspect Grizzly Bears in opponent&#x27;s hand')
  expect(html.match(/data-instance-id=/g)).toHaveLength(1)
  expect(html).not.toContain('data-action-type')
})
