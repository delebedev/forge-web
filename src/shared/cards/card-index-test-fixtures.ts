import type { SealedSet } from '@shared/api/contracts'
import { CardIndex } from './card-index'

type IndexRow = { grpId: number; name: string } & Record<string, unknown>

/** A card index in the release asset's compact form. */
export function testCardIndex(
  cards: IndexRow[],
  sets: SealedSet[] = [],
  images: Record<string, [string | null, string | null]> = {},
): CardIndex {
  return new CardIndex({ catalogVersion: 'test', sets, cards }, images)
}
