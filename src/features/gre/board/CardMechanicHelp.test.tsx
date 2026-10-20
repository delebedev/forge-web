import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CardMechanicHelp, keyedMechanicHelp } from './CardMechanicHelp'

const commander = {
  keyword: 'Equip',
  title: 'Equip',
  cost: '{3}',
  description: 'Attach to target commander you control. Activate only as a sorcery.',
}
const creature = {
  keyword: 'Equip',
  title: 'Equip',
  cost: '{5}',
  description: 'Attach to target creature you control. Activate only as a sorcery.',
}
const vigilance = {
  keyword: 'Vigilance',
  title: 'Vigilance',
  description: 'Attacking does not cause this creature to tap.',
}

test('distinct Equip descriptions keep their row identities through insertion, removal and reorder', () => {
  const original = keyedMechanicHelp([commander, creature])
  expect(original[0]!.key).not.toBe(original[1]!.key)
  for (const items of [[creature, commander], [vigilance, commander, creature], [creature]]) {
    for (const { item, key } of keyedMechanicHelp(items)) {
      const previous = original.find((row) => row.item === item)
      if (previous) {
        expect(key).toBe(previous.key)
      }
    }
  }
  expect(keyedMechanicHelp([{ ...commander }, { ...creature }]).map((row) => row.key)).toEqual(
    original.map((row) => row.key),
  )
})

test('equal costs with different descriptions remain distinct and identical occurrences stay unique', () => {
  const sameCost = { ...creature, cost: '{3}' }
  const rows = keyedMechanicHelp([commander, sameCost, { ...commander }])
  expect(new Set(rows.map((row) => row.key)).size).toBe(3)
  expect(
    keyedMechanicHelp([vigilance, commander, sameCost, { ...commander }])
      .slice(1)
      .map((row) => row.key),
  ).toEqual(rows.map((row) => row.key))
})

test('both repeated mechanic descriptions and costs remain present without deduplication', () => {
  const html = renderToStaticMarkup(<CardMechanicHelp items={[commander, creature]} />)
  expect(html.match(/<section/g)).toHaveLength(2)
  expect(html).toContain('aria-label="Cost 3"')
  expect(html).toContain('aria-label="Cost 5"')
  expect(html).toContain(commander.description)
  expect(html).toContain(creature.description)
})
