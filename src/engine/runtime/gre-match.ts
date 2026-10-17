import type { DeckDetail } from '@shared/api/contracts'
import type { GreStartConfig } from './start'

const STORAGE_KEY = 'forge:gre:lastMatchConfig'

export const DEFAULT_GRE_PLAYER_DECK = '20 Raging Goblin\n20 Shock\n20 Mountain'
export const DEFAULT_GRE_OPPONENT_DECK = '60 Plains'
export const DEFAULT_GRE_LIMITED_OPPONENT_DECK = '16 Raging Goblin\n8 Shock\n16 Mountain'
export const DEFAULT_GRE_SPECTATOR_DECK_A = '24 Raging Goblin\n12 Shock\n24 Mountain'
export const DEFAULT_GRE_SPECTATOR_DECK_B = '24 Savannah Lions\n12 Giant Growth\n24 Forest'

export function deckDetailToGreDeck(deck: DeckDetail | null | undefined): string | null {
  const content = deck?.content?.trim()
  if (content) {
    return content
  }
  const cards = deck?.cards ?? []
  if (cards.length === 0) {
    return null
  }
  return cards.map((card) => `${card.quantity} ${card.name}`).join('\n')
}

export function saveGreMatchConfig(config: GreStartConfig): void {
  if (typeof sessionStorage === 'undefined') {
    return
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export function updateGreMatchConfig(patch: Partial<GreStartConfig>): GreStartConfig | null {
  const current = loadGreMatchConfig()
  if (!current) {
    return null
  }
  const next = { ...current, ...patch }
  saveGreMatchConfig(next)
  return next
}

export function clearGreMatchConfig(): void {
  if (typeof sessionStorage === 'undefined') {
    return
  }
  sessionStorage.removeItem(STORAGE_KEY)
}

export function loadGreMatchConfig(): GreStartConfig | null {
  if (typeof sessionStorage === 'undefined') {
    return null
  }
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }
  const config = parseGreMatchConfig(raw)
  if (!config) {
    sessionStorage.removeItem(STORAGE_KEY)
    sessionStorage.setItem('forge:gre:unavailable', 'true')
  }
  return config
}

export function parseGreMatchConfig(raw: string): GreStartConfig | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      parsed['execution'] !== 'browser' ||
      parsed['spectatorMode'] === true ||
      (parsed['matchId'] && typeof parsed['attemptId'] !== 'string')
    ) {
      return null
    }
    const config: GreStartConfig = { execution: 'browser' }
    if (parsed['execution'] === 'browser') {
      config.execution = parsed['execution']
    }
    if (typeof parsed['coursePlayId'] === 'string') {
      config.coursePlayId = parsed['coursePlayId']
    }
    if (typeof parsed['attemptId'] === 'string') {
      config.attemptId = parsed['attemptId']
    }
    if (Number.isSafeInteger(parsed['seed']) && Number(parsed['seed']) >= 0) {
      config.seed = Number(parsed['seed'])
    }
    if (typeof parsed['frontendBuild'] === 'string') {
      config.frontendBuild = parsed['frontendBuild']
    }
    if (typeof parsed['engineBuild'] === 'string') {
      config.engineBuild = parsed['engineBuild']
    }
    if (typeof parsed['seat1Deck'] === 'string') {
      config.seat1Deck = parsed['seat1Deck']
    }
    if (typeof parsed['seat2Deck'] === 'string') {
      config.seat2Deck = parsed['seat2Deck']
    }
    if (typeof parsed['challengeId'] === 'string') {
      config.challengeId = parsed['challengeId']
    }
    if (typeof parsed['puzzle'] === 'string') {
      config.puzzle = parsed['puzzle']
    }
    if (typeof parsed['puzzleText'] === 'string') {
      config.puzzleText = parsed['puzzleText']
    }
    if (typeof parsed['turnLimit'] === 'number') {
      config.turnLimit = parsed['turnLimit']
    }
    if (isGreGameType(parsed['gameType'])) {
      config.gameType = parsed['gameType']
    }
    if (typeof parsed['matchId'] === 'string') {
      config.matchId = parsed['matchId']
    }
    if (typeof parsed['deckId'] === 'string') {
      config.deckId = parsed['deckId']
    }
    if (typeof parsed['returnPath'] === 'string') {
      config.returnPath = parsed['returnPath']
    }
    if (typeof parsed['label'] === 'string') {
      config.label = parsed['label']
    }
    if (typeof parsed['objective'] === 'string') {
      config.objective = parsed['objective']
    }
    return config.seat1Deck ||
      config.seat2Deck ||
      config.challengeId ||
      config.puzzle ||
      config.matchId
      ? config
      : null
  } catch {
    return null
  }
}

function isGreGameType(value: unknown): value is NonNullable<GreStartConfig['gameType']> {
  return (
    value === 'constructed' ||
    value === 'commander' ||
    value === 'brawl' ||
    value === 'oathbreaker' ||
    value === 'puzzle' ||
    value === 'draft' ||
    value === 'sealed'
  )
}
