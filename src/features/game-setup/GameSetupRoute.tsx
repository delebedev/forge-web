import { DeckViewSchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
/**
 * AppShell-hosted `/play/game` — owns the persisted player/opponent deck
 * selection (plus the "recent decks" auto-fill) that this route keeps at the app
 * root, since that state belongs to this route, not to chrome.
 */

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@shared/api/client'
import {
  loadStoredDeck,
  migrateStoredDeckKey,
  saveStoredDeck,
  STORAGE_KEY_GAME_OPPONENT,
  STORAGE_KEY_GAME_PLAYER,
} from '@engine/runtime/gre-launch'
import { greSession } from '@engine/runtime/gre-session'
import { decksStore } from '@features/decks/decks-store'
import { grpIdsToNames } from '@shared/cards/catalog'
import type { DeckDetail } from '@shared/api/contracts'
import { COMMANDER_DECKS } from './preconstructed'
import { COMMANDER_VARIANTS, type GameTypeId } from './game-types'
import { DeckPickerModal } from '@features/decks/DeckPickerModal'
import { useAuthSnapshot } from '@shared/auth/hooks'
import { GameSetup, type GameStartConfig } from './GameSetup'
import {
  asRecentUserDeck,
  isUnavailableDeck,
  type RecentUserDeck,
  recentDeckToDetail,
  shouldReplaceAutoDeck,
} from './recent-decks'
import { createGameSetupStarter } from './setup-game-start'
import { currentBrowserPreflight } from '@engine/runtime/browser-support'
import { warmBrowserRelease } from '@engine/runtime/browser-release'
import { trackGameExecutionFallback, type GameExecutionFallbackReason } from '@shared/analytics'

migrateStoredDeckKey('forge:constructed:playerDeck', STORAGE_KEY_GAME_PLAYER)
migrateStoredDeckKey('forge:constructed:aiDeck', STORAGE_KEY_GAME_OPPONENT)

function isPlayableRecentDeck(deck: RecentUserDeck): boolean {
  return deck.cardCount >= 60 && !/\b(test|sample|demo|debug)\b/i.test(deck.name)
}

type BrowserAvailability =
  | { status: 'available' }
  | { status: 'fallback'; reason: GameExecutionFallbackReason; message: string }

export function GameSetupRoute() {
  const auth = useAuthSnapshot()
  const [playerDeck, setPlayerDeck] = useState<DeckDetail | null>(() => {
    const stored = loadStoredDeck(STORAGE_KEY_GAME_PLAYER)
    return stored?.hasCommander ? stored : COMMANDER_DECKS[0]!
  })
  const [opponentDeck, setOpponentDeck] = useState<DeckDetail | null>(() =>
    loadStoredDeck(STORAGE_KEY_GAME_OPPONENT),
  )
  const [pickerTarget, setPickerTarget] = useState<'player' | 'opponent' | null>(null)
  const [deckSelectionError, setDeckSelectionError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [browserAvailability, setBrowserAvailability] = useState<BrowserAvailability>(() => {
    const unsupported = currentBrowserPreflight()
    return unsupported ? { status: 'fallback', ...unsupported } : { status: 'available' }
  })
  const [gameTypeId, setGameTypeId] = useState<GameTypeId>('commander')
  const [recentDecksLoaded, setRecentDecksLoaded] = useState(false)
  const requireCommander = COMMANDER_VARIANTS.includes(gameTypeId)
  const seedParam = new URLSearchParams(window.location.search).get('seed')
  const requestedSeed = seedParam == null ? Number.NaN : Number(seedParam)
  const seed = Number.isSafeInteger(requestedSeed) && requestedSeed >= 0 ? requestedSeed : undefined
  const [startGame] = useState(() =>
    createGameSetupStarter({
      start: (config) => greSession.start(config),
      onStarting: setStarting,
    }),
  )
  const [startBrowserGame] = useState(() =>
    createGameSetupStarter({
      start: (config) => greSession.startBrowser(config),
      onStarting: setStarting,
    }),
  )

  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData
    if (currentBrowserPreflight() || saveData === true) {
      return
    }
    const controller = new AbortController()
    void warmBrowserRelease(controller.signal).catch(() => undefined)
    return () => controller.abort()
  }, [])

  // The auto-fill below resolves after an await, by which point the user may
  // have picked a deck themselves. It reads the selection through this ref so
  // it decides against what is on screen now rather than what was there when
  // the request went out.
  const selectionRef = useRef({ player: playerDeck, opponent: opponentDeck })
  useEffect(() => {
    selectionRef.current = { player: playerDeck, opponent: opponentDeck }
  }, [playerDeck, opponentDeck])

  useEffect(() => {
    if (!auth.isAuthenticated || recentDecksLoaded) {
      return
    }
    const playerId = auth.player?.id
    if (!playerId) {
      return
    }
    setRecentDecksLoaded(true)
    let cancelled = false

    void (async () => {
      try {
        const res = await apiFetch(`/api/decks?playerId=${encodeURIComponent(playerId)}`)
        if (!res.ok) {
          return
        }
        const raw = await readJson(res, DeckViewSchema.array())
        if (!Array.isArray(raw)) {
          return
        }
        const decks = raw
          .map(asRecentUserDeck)
          .filter((deck): deck is RecentUserDeck => deck != null)
          .filter(isPlayableRecentDeck)
        const names = await grpIdsToNames(
          decks.flatMap((deck) => deck.mainDeck.map((card) => card.grpId)),
        )
        const launchableDecks = decks
          .map((deck) => recentDeckToDetail(deck, names))
          .filter((deck): deck is DeckDetail => deck != null)
        // Bail after unmount too: the writes below persist to storage, so a
        // late response would outlive the route it was filling in for.
        if (launchableDecks.length === 0 || cancelled) {
          return
        }
        const { player: currentPlayer, opponent: currentOpponent } = selectionRef.current
        const player = shouldReplaceAutoDeck(currentPlayer) ? launchableDecks[0]! : currentPlayer!
        const opponent = shouldReplaceAutoDeck(currentOpponent)
          ? (launchableDecks[1] ?? launchableDecks[0]!)
          : currentOpponent!
        setPlayerDeck(player)
        setOpponentDeck(opponent)
        saveStoredDeck(STORAGE_KEY_GAME_PLAYER, player)
        saveStoredDeck(STORAGE_KEY_GAME_OPPONENT, opponent)
      } catch {
        /* ignore */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [auth.isAuthenticated, auth.player?.id, recentDecksLoaded])

  function openGameDeckPicker(slot: 'player' | 'opponent'): void {
    decksStore.clearSelection()
    setPickerTarget(slot)
  }

  function handleGameDeckPicked(deck: DeckDetail): void {
    if (isUnavailableDeck(deck)) {
      setDeckSelectionError(
        `${deck.name} cannot launch with the local card database. Choose another deck or paste a decklist.`,
      )
      setPickerTarget(null)
      return
    }
    setDeckSelectionError(null)
    if (pickerTarget === 'player') {
      setPlayerDeck(deck)
      saveStoredDeck(STORAGE_KEY_GAME_PLAYER, deck)
    } else if (pickerTarget === 'opponent') {
      setOpponentDeck(deck)
      saveStoredDeck(STORAGE_KEY_GAME_OPPONENT, deck)
    }
    setPickerTarget(null)
  }

  function handleGameTypeChange(gt: GameTypeId): void {
    setGameTypeId(gt)
    if (COMMANDER_VARIANTS.includes(gt)) {
      if (playerDeck && !playerDeck.hasCommander) {
        setPlayerDeck(null)
        localStorage.removeItem(STORAGE_KEY_GAME_PLAYER)
      }
      if (opponentDeck && !opponentDeck.hasCommander) {
        setOpponentDeck(null)
        localStorage.removeItem(STORAGE_KEY_GAME_OPPONENT)
      }
    }
  }

  async function handleGameStart(config: GameStartConfig): Promise<void> {
    setDeckSelectionError(null)
    const result = await startGame(
      { ...config, ...(seed == null ? {} : { seed }) },
      playerDeck,
      opponentDeck,
    )
    if (!result || result.ok) {
      return
    }
    if (result.clearPlayerDeck) {
      setPlayerDeck(null)
      localStorage.removeItem(STORAGE_KEY_GAME_PLAYER)
    }
    setDeckSelectionError(result.error)
  }

  async function handleDefaultGameStart(config: GameStartConfig): Promise<void> {
    setDeckSelectionError(null)
    const unsupported = currentBrowserPreflight()
    if (unsupported) {
      setBrowserAvailability({ status: 'fallback', ...unsupported })
      trackGameExecutionFallback(unsupported.reason, unsupported.capability)
      await handleGameStart(config)
      return
    }
    setBrowserAvailability({ status: 'available' })
    const result = await startBrowserGame(
      { ...config, ...(seed == null ? {} : { seed }) },
      playerDeck,
      opponentDeck,
    )
    if (result && !result.ok) {
      setDeckSelectionError(result.error)
    }
  }

  return (
    <>
      <GameSetup
        playerDeck={playerDeck}
        opponentDeck={opponentDeck}
        onChooseDeck={(deck) => {
          selectionRef.current.player = deck
          setPlayerDeck(deck)
          setDeckSelectionError(null)
          saveStoredDeck(STORAGE_KEY_GAME_PLAYER, deck)
        }}
        onPickDeck={openGameDeckPicker}
        onStartDefault={(config) => void handleDefaultGameStart(config)}
        onStartServer={(config) => void handleGameStart(config)}
        onGameTypeChange={handleGameTypeChange}
        deckError={deckSelectionError}
        starting={starting}
        browserAvailability={browserAvailability}
      />
      <DeckPickerModal
        open={pickerTarget != null}
        onClose={() => setPickerTarget(null)}
        onSelect={handleGameDeckPicked}
        requireCommander={requireCommander}
      />
    </>
  )
}
