import type { LibraryCard } from './deck-value'

export type EditableSections = { mainboard: LibraryCard[]; sideboard: LibraryCard[] }
export type EditableSection = keyof EditableSections

export function changeCardQuantity(
  cards: LibraryCard[],
  card: LibraryCard,
  delta: number,
): LibraryCard[] {
  const existing = cards.find((entry) => entry.grpId === card.grpId)
  const quantity = (existing?.quantity ?? 0) + delta
  if (quantity <= 0) {
    return cards.filter((entry) => entry.grpId !== card.grpId)
  }
  return existing
    ? cards.map((entry) => (entry.grpId === card.grpId ? { ...entry, quantity } : entry))
    : [...cards, { ...card, quantity }]
}

export function moveDeckCard(
  sections: EditableSections,
  from: EditableSection,
  grpId: number,
): EditableSections {
  const card = sections[from].find((entry) => entry.grpId === grpId)
  if (!card) {
    return sections
  }
  const to = from === 'mainboard' ? 'sideboard' : 'mainboard'
  return {
    ...sections,
    [from]: changeCardQuantity(sections[from], card, -1),
    [to]: changeCardQuantity(sections[to], card, 1),
  }
}
