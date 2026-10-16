type ScryfallCard = {
  name: string
  setCode?: string | null
  collectorNumber?: string | null
  lang?: string | null
  isTransformed?: boolean
  isFaceDown?: boolean
}

export const CARD_BACK_URL = 'https://cards.scryfall.io/back.png'

export function handleImageError(e: Event) {
  const img = e.currentTarget as HTMLImageElement
  if (img.src !== CARD_BACK_URL) {
    img.src = CARD_BACK_URL
  }
}

/**
 * The landscape art crop of a card image — the illustration alone, without the
 * frame, name, or rules text. Battlefield cards use it so a permanent reads as
 * an object at a glance; the full card is what the hover preview is for.
 *
 * Handles both image forms in play: the CDN path (`/normal/` → `/art_crop/`)
 * and the image route (`version=normal` → `version=art_crop`). Anything else
 * is returned unchanged, so a non-Scryfall URL degrades to the full image.
 */
export function artCropUrl(imageUrl: string): string {
  if (!imageUrl) {
    return imageUrl
  }
  if (imageUrl.includes('/normal/')) {
    return imageUrl.replace('/normal/', '/art_crop/')
  }
  if (imageUrl.includes('version=normal')) {
    return imageUrl.replace('version=normal', 'version=art_crop')
  }
  return imageUrl
}

export function scryfallUrl(card: ScryfallCard): string {
  if (card.isFaceDown) {
    return CARD_BACK_URL
  }
  const face = card.isTransformed ? '&face=back' : ''
  return `/api/public/cards/image?name=${encodeURIComponent(card.name)}&version=normal${face}`
}

export function normalizeCardImageUrl(name: string | null, imageUrl: string | null): string | null {
  if (!name || !imageUrl?.startsWith('https://api.scryfall.com/')) {
    return imageUrl
  }
  return scryfallUrl({ name, isTransformed: imageUrl.includes('face=back') })
}
