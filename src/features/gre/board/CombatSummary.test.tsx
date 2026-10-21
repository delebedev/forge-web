import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CardView } from '@engine/state/gre-state'
import { CombatSummary } from './CombatSummary'

const attacker: CardView = {
  instanceId: 101,
  grpId: 1,
  name: 'Grizzly Bears',
  typeLine: 'Creature',
  manaCost: '{1}{G}',
  powerToughness: '2/2',
  imageUrl: '',
  controllerSeatId: 1,
  tapped: true,
  attacking: true,
  blocked: true,
  playableLand: false,
  playableSpell: false,
  playableActivation: false,
}
const blocker: CardView = { ...attacker, instanceId: 201, name: 'Wall of Stone', attacking: false }

test('states which creature is blocked by which without needing hover', () => {
  const html = renderToStaticMarkup(<CombatSummary groups={[{ attacker, blockers: [blocker] }]} />)
  expect(html).toContain('aria-label="Combat assignments"')
  expect(html).toContain('Grizzly Bears')
  expect(html).toContain('Blocked by Wall of Stone')
})

test('a face-down combatant never exposes its metadata name', () => {
  const html = renderToStaticMarkup(
    <CombatSummary groups={[{ attacker, blockers: [{ ...blocker, faceDown: true }] }]} />,
  )
  expect(html).toContain('Blocked by Face-down creature')
  expect(html).not.toContain('Wall of Stone')
})

test('distinguishes unblocked from blocked with no remaining blockers', () => {
  const html = renderToStaticMarkup(
    <CombatSummary
      groups={[
        { attacker, blockers: [] },
        { attacker: { ...attacker, instanceId: 102, blocked: false }, blockers: [] },
      ]}
    />,
  )
  expect(html).toContain('Blocked · no remaining blockers')
  expect(html).toContain('Unblocked')
  expect(renderToStaticMarkup(<CombatSummary groups={[]} />)).toBe('')
})
