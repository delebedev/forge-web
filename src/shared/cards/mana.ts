/**
 * Utilities for converting Forge mana notation to mana-font CSS classes.
 *
 * Forge uses `{W}`, `{3}`, `{B/G}`, `{W/P}` etc.
 * mana-font uses `<i class="ms ms-cost ms-w"></i>` etc.
 */

/** Map a single Forge mana token (inside braces) to a mana-font class suffix. */
function tokenToClass(token: string): string | null {
  const t = token.toUpperCase()

  // Basic colors
  if (/^[WUBRGC]$/.test(t)) {
    return t.toLowerCase()
  }

  // Generic numbers 0-20
  if (/^\d+$/.test(t)) {
    return t
  }

  // Variable
  if (t === 'X') {
    return 'x'
  }
  if (t === 'Y') {
    return 'y'
  }

  // Snow
  if (t === 'S') {
    return 's'
  }

  // Energy
  if (t === 'E') {
    return 'e'
  }

  // Tap / Untap
  if (t === 'T') {
    return 'tap'
  }
  if (t === 'Q') {
    return 'untap'
  }

  // Hybrid: W/U → wu, B/G → bg etc.
  const hybridMatch = t.match(/^([WUBRG])\/([WUBRG])$/)
  if (hybridMatch) {
    return hybridMatch[1]!.toLowerCase() + hybridMatch[2]!.toLowerCase()
  }

  // Phyrexian: W/P → wp, U/P → up etc.
  const phyrexianMatch = t.match(/^([WUBRG])\/P$/)
  if (phyrexianMatch) {
    return phyrexianMatch[1]!.toLowerCase() + 'p'
  }

  // Generic hybrid: 2/W → 2w etc.
  const genericHybridMatch = t.match(/^(\d)\/([WUBRG])$/)
  if (genericHybridMatch) {
    return genericHybridMatch[1] + genericHybridMatch[2]!.toLowerCase()
  }

  return null
}

export interface ManaSymbol {
  classes: string
  label: string
}

/** Parse a Forge mana cost string like `{1}{B}{G}` into renderable symbol data. */
export function parseManaSymbols(cost: string): ManaSymbol[] {
  if (!cost) {
    return []
  }

  const symbols: ManaSymbol[] = []
  const regex = /\{([^}]+)\}/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(cost)) !== null) {
    const token = match[1]!
    const cls = tokenToClass(token)
    if (cls) {
      symbols.push({
        classes: `ms ms-cost ms-${cls}`,
        label: token,
      })
    }
  }

  return symbols
}

/** Map of Forge keyword enum names (lowercase) → mana-font ability class suffixes. */
const KEYWORD_ICONS: Record<string, string> = {
  flying: 'flying',
  'first strike': 'first-strike',
  'double strike': 'first-strike',
  trample: 'trample',
  haste: 'haste',
  vigilance: 'vigilance',
  deathtouch: 'deathtouch',
  lifelink: 'lifelink',
  menace: 'menace',
  ninjutsu: 'ninjutsu',
  reach: 'reach',
  defender: 'defender',
  hexproof: 'hexproof',
  indestructible: 'indestructible',
  flash: 'flash',
  prowess: 'prowess',
  ward: 'ward',
  fear: 'fear',
  intimidate: 'intimidate',
  skulk: 'skulk',
  shroud: 'shroud',
  infect: 'infect',
  protection: 'hexproof', // shield-like icon; closest match in mana-font
  wither: 'deathtouch',
  toxic: 'poison',
  annihilator: 'annihilator',
}

export interface KeywordIcon {
  classes: string
  label: string
}

/** Convert keyword DTOs to mana-font ability icon data. Uses `keyword` for icon lookup, `text` for display. */
export function keywordIcons(keywords: { keyword: string; text: string }[]): KeywordIcon[] {
  const icons: KeywordIcon[] = []
  const seen = new Set<string>()

  for (const kw of keywords) {
    const key = kw.keyword.toLowerCase()
    const suffix = KEYWORD_ICONS[key]
    if (suffix && !seen.has(key)) {
      seen.add(key)
      icons.push({
        classes: `ms ms-ability-${suffix}`,
        label: kw.text,
      })
    }
  }

  return icons
}

/** Get the mana-font class for a single mana color letter (for mana pool display). */
export function manaColorClass(color: string): string {
  return `ms ms-${color.toLowerCase()}`
}

/** Counter glyphs available in the installed Mana font. Unknown types keep a text label. */
export function counterIcon(name: string): string | null {
  if (name === '+1/+1') {
    return 'ms ms-counter-plus'
  }
  if (name === '-1/-1') {
    return 'ms ms-counter-minus'
  }
  const suffix = name.toLowerCase()
  const counters = new Set([
    'arrow',
    'brick',
    'charge',
    'damage',
    'deathtouch',
    'devotion',
    'doom',
    'echo',
    'finality',
    'flame',
    'flood',
    'fungus',
    'gold',
    'ki',
    'lore',
    'loyalty',
    'mining',
    'muster',
    'paw',
    'pin',
    'rad',
    'scream',
    'skeleton',
    'skull',
    'slime',
    'shield',
    'stun',
    'time',
    'verse',
    'void',
    'vortex',
  ])
  return counters.has(suffix) ? `ms ms-counter-${suffix}` : null
}
