/**
 * Pure lane/hint derivations over a `BoardSnapshot`, factored out of the
 * container so `Board` can compute them locally instead of the caller
 * threading four extra card arrays through props.
 */

import type { CardView } from '@engine/state/gre-state'
import type { BoardSnapshot } from '@engine/runtime/snapshot'

const BASIC_LAND_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'])

export function isLand(card: CardView): boolean {
  return /\bland\b/i.test(card.typeLine ?? '') || BASIC_LAND_NAMES.has(card.name)
}

/** Artifact creatures count: they attack and block, so they lane with creatures. */
export function isCreature(card: CardView): boolean {
  return /\bcreature\b/i.test(card.typeLine ?? '')
}

export type BoardLanes = {
  lands: CardView[]
  creatures: CardView[]
  permanents: CardView[]
}

/** Splits one battlefield into the board's three visual lanes. */
export function lanesOf(cards: CardView[]): BoardLanes {
  const lands: CardView[] = []
  const creatures: CardView[] = []
  const permanents: CardView[] = []

  for (const card of cards) {
    if (isLand(card)) {
      lands.push(card)
    } else if (isCreature(card)) {
      creatures.push(card)
    } else {
      permanents.push(card)
    }
  }

  return { lands, creatures, permanents }
}

export type Pile = {
  /** The card drawn for the pile — the first of its group in board order. */
  card: CardView
  /** Every instance in the pile, so a click can still address one of them. */
  members: CardView[]
}

/**
 * One pile per card. Creatures differ in ways a pile would hide — counters,
 * auras, damage marked, whether they are attacking.
 */
export function soloPilesOf(cards: CardView[]): Pile[] {
  return cards.map((card) => ({ card, members: [card] }))
}

/**
 * Groups identical permanents into piles, by name *and* tapped state so the one
 * card drawn tells the truth about the rest. Anything actionable stays on its
 * own, since a pile would hide which instance an action belongs to. Order
 * follows first appearance.
 */
export function pilesOf(
  cards: CardView[],
  attachmentHosts: ReadonlySet<number> = new Set(),
): Pile[] {
  const piles: Pile[] = []
  const byKey = new Map<string, Pile>()

  for (const card of cards) {
    const actionable =
      card.playableLand ||
      card.playableSpell ||
      card.playableActivation ||
      card.attacking ||
      (card.counters?.length ?? 0) > 0 ||
      attachmentHosts.has(card.instanceId)
    const key = actionable
      ? `solo:${card.instanceId}`
      : `${card.name}|${card.tapped}|${Boolean(card.phasedOut)}`
    const existing = byKey.get(key)
    if (existing) {
      existing.members.push(card)
      continue
    }
    const pile: Pile = { card, members: [card] }
    byKey.set(key, pile)
    piles.push(pile)
  }

  return piles
}

export function tappedManaCountOf(board: BoardSnapshot): number {
  return board.battlefield.filter(isLand).filter((card) => card.tapped).length
}

export function visibleStackOf(board: BoardSnapshot): CardView[] {
  return board.stack.length > 0 &&
    (board.canPass || board.legalActions.length > 0 || board.prompt != null)
    ? board.stack
    : []
}

/** Group across both controllers: an opponent's Aura can enchant your creature. */
export function attachmentsOf(cards: CardView[]): Map<number, CardView[]> {
  const byId = new Map(cards.map((card) => [card.instanceId, card]))
  const groups = new Map<number, CardView[]>()
  for (const card of cards) {
    if (!card.attachedTo || !byId.has(card.attachedTo)) {
      continue
    }
    const seen = new Set([card.instanceId])
    let parent: CardView | undefined = byId.get(card.attachedTo)
    while (parent && !seen.has(parent.instanceId)) {
      seen.add(parent.instanceId)
      parent = byId.get(parent.attachedTo ?? 0)
    }
    if (parent) {
      continue
    }
    const group = groups.get(card.attachedTo) ?? []
    group.push(card)
    groups.set(card.attachedTo, group)
  }
  return groups
}
