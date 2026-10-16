import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DraftCard } from '@shared/api/contracts'
import { DraftWorkspace } from './DraftWorkspace'

const card = (name: string, rarity: string): DraftCard => ({
  name,
  rarity,
  manaCost: '{G}',
  typeLine: 'Creature',
  colors: ['G'],
  setCode: 'TEST',
  collectorNumber: null,
})

test('default draft order puts catalog MythicRare before rares and commons', () => {
  const html = renderToStaticMarkup(
    <DraftWorkspace
      pack={[
        card('Common specimen', 'Common'),
        card('Rare specimen', 'Rare'),
        card('Mythic specimen', 'MythicRare'),
      ]}
      pool={[]}
      round={1}
      pick={1}
      picking={false}
      error={null}
      autoPicking={false}
      onPick={() => {}}
    />,
  )
  expect(html.indexOf('Mythic specimen')).toBeGreaterThan(-1)
  expect(html.indexOf('Mythic specimen')).toBeLessThan(html.indexOf('Rare specimen'))
  expect(html.indexOf('Rare specimen')).toBeLessThan(html.indexOf('Common specimen'))
})
