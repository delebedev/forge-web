import type { DraftCard } from '@shared/api/contracts'
import { scryfallUrl } from '@shared/cards/scryfall'

// --- Types ---

export type IndexedCard = DraftCard & { poolIndex: number }
export type CmcBucket = { key: string; label: string; cards: IndexedCard[] }

// --- Constants ---

export const BASIC_LAND_NAMES = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'])
export const CMC_BUCKETS = ['0', '1', '2', '3', '4', '5', '6+'] as const
export const MAX_COPIES = 4

/** Non-basic mainboard entries above the 4-copy constructed limit render as a warning, not an error. */
export function quantityWarning(qty: number, name: string): boolean {
  return !BASIC_LAND_NAMES.has(name) && qty > MAX_COPIES
}

export type LandName = 'Plains' | 'Island' | 'Swamp' | 'Mountain' | 'Forest'
export const LAND_COLORS: LandName[] = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']

export const LAND_PIPS: Record<string, string> = {
  Plains: 'W',
  Island: 'U',
  Swamp: 'B',
  Mountain: 'R',
  Forest: 'G',
}

// --- Pure functions ---

export function cmcOf(card: DraftCard): number {
  if (!card.manaCost) {
    return 0
  }
  let total = 0
  const pips = card.manaCost.match(/\{([^}]+)\}/g) ?? []
  for (const pip of pips) {
    const inner = pip.slice(1, -1)
    const num = parseInt(inner, 10)
    total += /^[XYZ]$/.test(inner) ? 0 : isNaN(num) ? 1 : num
  }
  return total
}

export function cmcBucketKey(card: DraftCard): string {
  if (card.typeLine?.toLowerCase().includes('land')) {
    return 'L'
  }
  const c = cmcOf(card)
  return c >= 6 ? '6+' : String(c)
}

export function buildCmcGroups(cards: IndexedCard[]): CmcBucket[] {
  const map: Record<string, IndexedCard[]> = {}
  const landCards: IndexedCard[] = []
  for (const b of CMC_BUCKETS) {
    map[b] = []
  }
  for (const card of cards) {
    const key = cmcBucketKey(card)
    if (key === 'L') {
      landCards.push(card)
      continue
    }
    ;(map[key] ??= []).push(card)
  }
  for (const arr of Object.values(map)) {
    arr.sort((a, b) => a.name.localeCompare(b.name))
  }
  landCards.sort((a, b) => a.name.localeCompare(b.name))

  const groups: CmcBucket[] = CMC_BUCKETS.filter((k) => (map[k]?.length ?? 0) > 0).map((k) => ({
    key: k,
    label: k,
    cards: map[k]!,
  }))
  if (landCards.length > 0) {
    groups.push({ key: 'L', label: 'Land', cards: landCards })
  }
  return groups
}

export function basicLandImageUrl(name: string): string {
  return scryfallUrl({ name })
}

// --- Basic land counts ---

export type BasicLandCounts = Record<LandName, number>

export function emptyLandCounts(): BasicLandCounts {
  return { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 }
}

export function incrementLand(counts: BasicLandCounts, land: LandName): BasicLandCounts {
  return { ...counts, [land]: counts[land] + 1 }
}

export function decrementLand(counts: BasicLandCounts, land: LandName): BasicLandCounts {
  if (counts[land] <= 0) {
    return counts
  }
  return { ...counts, [land]: counts[land] - 1 }
}

export function totalLandCount(counts: BasicLandCounts): number {
  return LAND_COLORS.reduce((sum, land) => sum + counts[land], 0)
}

// --- Mana curve (built from buildCmcGroups(), excluding the land bucket) ---

export function curveCounts(groups: CmcBucket[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const group of groups) {
    if (group.key !== 'L') {
      counts[group.key] = group.cards.length
    }
  }
  return counts
}

export function maxCurveCount(counts: Record<string, number>): number {
  return Math.max(1, ...Object.values(counts))
}
