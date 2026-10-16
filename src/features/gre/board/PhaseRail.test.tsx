import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PhaseRail } from './PhaseRail'

test('five phases expose exact stops for both turns without an untap stop', () => {
  const html = renderToStaticMarkup(
    <PhaseRail
      seat="self"
      taking
      phaseName="Beginning"
      stepName="Upkeep"
      stops={new Set(['opponent:draw'])}
      interactive
      onToggleStop={() => {}}
    />,
  )
  expect(html.match(/<summary /g)).toHaveLength(5)
  expect(html).toContain('aria-label="Your Upkeep stop" aria-pressed="false"')
  expect(html).toContain('aria-label="Opponent Draw stop" aria-pressed="true"')
  expect(html).toContain('Your First strike damage stop')
  expect(html).not.toContain('Untap stop')
  expect(html).toContain('aria-current="step"')
})
