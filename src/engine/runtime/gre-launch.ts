import { DeckDetailSchema, type DeckDetail } from '@shared/api/contracts'
import {
  DEFAULT_GRE_LIMITED_OPPONENT_DECK,
  DEFAULT_GRE_OPPONENT_DECK,
  DEFAULT_GRE_PLAYER_DECK,
  deckDetailToGreDeck,
} from './gre-match'
import type { GreStartConfig } from './start'

export const STORAGE_KEY_GAME_PLAYER = 'forge:game:playerDeck'
export const STORAGE_KEY_GAME_OPPONENT = 'forge:game:opponentDeck'

export type GreLaunchGameStartConfig = {
  gameType: GreStartConfig['gameType']
  mode: 'play' | 'watch'
  seed?: number
  deckList?: string
  opponentMode?: string
  opponentDeckList?: string
  deck1List?: string
  deck2List?: string
}

export function loadStoredDeck(key: string): DeckDetail | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      return null
    }
    const parsed = DeckDetailSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveStoredDeck(key: string, deck: DeckDetail): void {
  localStorage.setItem(key, JSON.stringify(deck))
}

export function migrateStoredDeckKey(oldKey: string, newKey: string): void {
  const current = localStorage.getItem(newKey)
  const legacy = localStorage.getItem(oldKey)
  if (!current && legacy) {
    localStorage.setItem(newKey, legacy)
    localStorage.removeItem(oldKey)
  }
}

export function gameSetupToGreStartConfig(
  config: GreLaunchGameStartConfig,
  playerDeck: DeckDetail | null,
  opponentDeck: DeckDetail | null,
): GreStartConfig {
  if (config.mode === 'watch') {
    const seat1Deck = config.deck1List?.trim() || deckDetailToGreDeck(playerDeck)
    const seat2Deck = config.deck2List?.trim() || deckDetailToGreDeck(opponentDeck)
    return {
      ...(seat1Deck ? { seat1Deck } : {}),
      ...(seat2Deck ? { seat2Deck } : {}),
      gameType: config.gameType,
      ...(config.seed == null ? {} : { seed: config.seed }),
      spectatorMode: true,
    }
  }

  const seat1Deck = config.deckList?.trim() || deckDetailToGreDeck(playerDeck)
  const seat2Deck =
    config.opponentDeckList?.trim() ||
    (config.opponentMode === 'mirror' ? seat1Deck : deckDetailToGreDeck(opponentDeck))

  return {
    ...(seat1Deck ? { seat1Deck } : {}),
    ...(seat2Deck ? { seat2Deck } : {}),
    ...(!config.deckList?.trim() && playerDeck?.id ? { deckId: playerDeck.id } : {}),
    gameType: config.gameType,
    ...(config.seed == null ? {} : { seed: config.seed }),
  }
}

export function limitedDeckToGreStartConfig(
  deckText: string,
  gameType: 'draft' | 'sealed',
): GreStartConfig {
  return {
    seat1Deck: deckText,
    seat2Deck: DEFAULT_GRE_LIMITED_OPPONENT_DECK,
    gameType,
  }
}

export function puzzleToGreStartConfig(
  filename: string,
  context?: { name: string; objective: string },
): GreStartConfig {
  return {
    puzzle: filename,
    gameType: 'puzzle',
    returnPath: '/challenges',
    label: context?.name ?? filename,
    ...(context ? { objective: context.objective } : {}),
  }
}

export function challengeToGreStartConfig(challenge: {
  id: string
  name: string
  objective: string
}): GreStartConfig {
  return {
    challengeId: challenge.id,
    gameType: 'puzzle',
    returnPath: '/challenges',
    label: challenge.name,
    objective: challenge.objective,
  }
}

export function candidateToGreStartConfig(candidate: {
  candidateId: string
  name: string
  objective: string
}): GreStartConfig {
  return {
    candidateId: candidate.candidateId,
    gameType: 'puzzle',
    returnPath: '/challenges',
    label: candidate.name,
    objective: candidate.objective,
  }
}

export function devDefaultGreStartConfig(deckText?: string): GreStartConfig {
  return {
    seat1Deck: deckText?.trim() || DEFAULT_GRE_PLAYER_DECK,
    seat2Deck: DEFAULT_GRE_OPPONENT_DECK,
    gameType: 'constructed',
  }
}
