import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StackPanel } from '../board/StackPanel'
import { crowdedBoard, tallStackDecisionBoard } from './fixtures'

for (const [name, board, nextName, nextId] of [
  ['crowded board', crowdedBoard(), 'Llanowar Elves', undefined],
  ['tall stack decision', tallStackDecisionBoard(), 'Opt', 6600],
] as const) {
  test(`${name} supplies its next resolution first`, () => {
    expect(board.stack[0]?.name).toBe(nextName)
    if (nextId !== undefined) {
      expect(board.stack[0]?.instanceId).toBe(nextId)
    }
    const html = renderToStaticMarkup(createElement(StackPanel, { cards: board.stack }))
    const firstEntry = html.slice(html.indexOf('<li'), html.indexOf('</li>'))
    expect(firstEntry).toContain('Resolves next')
    expect(firstEntry).toContain(`data-card="${nextName}"`)
    expect(board.stack.slice(-5).map((card) => card.instanceId)).toEqual([
      1404, 1403, 1402, 1401, 1400,
    ])
  })
}
