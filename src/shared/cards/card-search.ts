/**
 * Card-name search compares letters and digits only, without case or diacritics, so
 * "ghalta, the immovable" finds "Ghalta the Immovable" and "lim dul" finds "Lim-Dûl".
 */
export function cardSearchKey(name: string): string {
  return name
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** True when [query] has no searchable characters or appears within [name] under the same comparison. */
export function matchesCardName(name: string, query: string): boolean {
  return cardSearchKey(name).includes(cardSearchKey(query))
}
