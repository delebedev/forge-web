import { useEffect, useRef, useState } from 'react'
import { useDecksSnapshot } from '@features/decks/decks-hooks'
import { decksStore } from '@features/decks/decks-store'
import { importedContent } from '@features/decks/deck-value'
import { DeckImportDialog, type ImportedDeck } from '@shared/cards/DeckImportDialog'
import { scryfallUrl, artCropUrl, CARD_BACK_URL } from '@shared/cards/scryfall'
import type { DeckDetail, AiMode } from '@shared/api/contracts'
import { deckDetailToGreDeck } from '@engine/runtime/gre-match'
import type { GameTypeId } from './game-types'
import { PRECONSTRUCTED_DECKS, COMMANDER_DECKS } from './preconstructed'
import styles from './GameSetup.module.css'

export interface GameStartConfig {
  gameType: GameTypeId
  seed?: number
  format?: string
  mode: 'play' | 'watch'
  deckList?: string
  opponentMode?: AiMode
  opponentDeckList?: string
  deck1List?: string
  deck2List?: string
}

export function GameSetup({
  playerDeck,
  opponentDeck,
  onPickDeck,
  onChooseDeck,
  onStartDefault,
  onStartServer,
  onGameTypeChange,
  deckError,
  starting = false,
  browserAvailability,
}: {
  playerDeck: DeckDetail | null
  opponentDeck: DeckDetail | null
  onPickDeck: (slot: 'player' | 'opponent') => void
  onChooseDeck: (deck: DeckDetail) => void
  onStartDefault: (config: GameStartConfig) => void
  onStartServer: (config: GameStartConfig) => void
  onGameTypeChange?: (type: GameTypeId) => void
  deckError?: string | null
  starting?: boolean
  browserAvailability: { status: 'available' } | { status: 'fallback'; message: string }
}) {
  const [gameType, setGameType] = useState<GameTypeId>('commander')
  const [importOpen, setImportOpen] = useState(false)
  const [aiMode, setAiMode] = useState<AiMode>('random')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const library = useDecksSnapshot()
  useEffect(() => {
    void decksStore.fetchDecks()
  }, [library.accountId])
  const commander = gameType === 'commander'
  const readyDecks = commander ? COMMANDER_DECKS : PRECONSTRUCTED_DECKS
  const isReadyMade = (name: string) =>
    readyDecks.some((deck) => deck.name === name.replace(/^Pauper /, ''))
  const visibleDecks = library.decks
    .filter(
      (deck) =>
        Boolean(deck.hasCommander) === commander &&
        (commander ? deck.cardCount === 100 : deck.cardCount >= 60),
    )
    .sort((a, b) => Number(isReadyMade(a.name)) - Number(isReadyMade(b.name)))
  const bundledDecks = readyDecks.filter(
    (deck) => !visibleDecks.some((saved) => saved.name.replace(/^Pauper /, '') === deck.name),
  )
  const usable = playerDeck && Boolean(playerDeck.hasCommander) === commander
  const cover =
    playerDeck?.commandZone?.[0] ??
    playerDeck?.cards.find((card) => !/^(Forest|Mountain|Plains|Island|Swamp)$/.test(card.name)) ??
    playerDeck?.cards[0]
  const opponentDeckList = deckDetailToGreDeck(opponentDeck)
  const formatSelections = useRef<Partial<Record<GameTypeId, DeckDetail>>>({})

  function startConfig(): GameStartConfig {
    const random = readyDecks[Math.floor(Math.random() * readyDecks.length)]!
    return {
      gameType,
      mode: 'play',
      opponentMode: aiMode,
      ...(aiMode === 'random' ? { opponentDeckList: random.content! } : {}),
    }
  }

  function choose(deck: DeckDetail) {
    formatSelections.current[gameType] = deck
    onChooseDeck(deck)
    setError(null)
    setNotice(null)
  }

  async function chooseDeckDetail(deckId: string): Promise<void> {
    const deck = await decksStore.fetchDeckDetail(deckId)
    if (deck) {
      choose(deck)
    }
  }

  function changeGameType(type: GameTypeId) {
    if (usable) {
      formatSelections.current[gameType] = playerDeck
    }
    setGameType(type)
    setAiMode('random')
    onGameTypeChange?.(type)
    onChooseDeck(
      formatSelections.current[type] ??
        (type === 'commander' ? COMMANDER_DECKS[0]! : PRECONSTRUCTED_DECKS[0]!),
    )
    setError(null)
    setNotice(null)
    setImportOpen(false)
  }

  async function importDeck({ name, deck }: ImportedDeck): Promise<void> {
    const saved = await decksStore.saveDeck(
      decksStore.draft(importedContent(name, deck, commander ? 'Commander' : 'Timeless')),
    )
    if (!saved) {
      throw new Error('Your account changed. Import this deck again.')
    }
    choose(saved)
    setImportOpen(false)
    setNotice('Imported and saved to your library.')
  }

  return (
    <div className={styles.lobby}>
      <header className={styles.heading}>
        <div>
          <h1>What are you playing?</h1>
          <p>Choose a deck or bring your own.</p>
        </div>
        <div className={styles.formats} aria-label="Game format">
          {(['commander', 'constructed'] as const).map((type) => (
            <button
              type="button"
              key={type}
              aria-pressed={gameType === type}
              onClick={() => changeGameType(type)}
            >
              {type === 'constructed' ? 'Constructed' : 'Commander'}
            </button>
          ))}
        </div>
      </header>
      <div className={styles.layout}>
        <section className={styles.collection} aria-label="Choose your deck">
          <div className={styles.library}>
            {library.loading && <p role="status">Loading your decks…</p>}
            {library.error && (
              <p role="alert">
                {library.error}{' '}
                <button
                  type="button"
                  onClick={() => {
                    void decksStore.fetchDecks(true)
                  }}
                >
                  Try again
                </button>
              </p>
            )}
            <div className={styles.deckGrid}>
              {visibleDecks.map((deck) => (
                <button
                  type="button"
                  key={deck.id}
                  className={styles.deckTile}
                  disabled={library.loadingDetail}
                  aria-label={`${deck.name} ${deck.cardCount} cards`}
                  aria-pressed={
                    playerDeck?.id === deck.id ||
                    (playerDeck?.userOwned === false &&
                      playerDeck.name === deck.name.replace(/^Pauper /, ''))
                  }
                  onClick={() => void chooseDeckDetail(deck.id)}
                >
                  <img
                    src={
                      deck.coverName
                        ? artCropUrl(scryfallUrl({ name: deck.coverName }))
                        : CARD_BACK_URL
                    }
                    alt=""
                  />
                  <div>
                    <span className={styles.deckName}>{deck.name}</span>
                    <span>{deck.cardCount} cards</span>
                  </div>
                </button>
              ))}
              {bundledDecks.map((deck) => (
                <button
                  type="button"
                  key={deck.id}
                  className={styles.deckTile}
                  aria-label={`${deck.name} ${deck.stats.totalCards} cards`}
                  aria-pressed={playerDeck?.id === deck.id}
                  onClick={() => choose(deck)}
                >
                  <img
                    src={artCropUrl(scryfallUrl(deck.commandZone?.[0] ?? deck.cards[0]!))}
                    alt=""
                  />
                  <div>
                    <span className={styles.deckName}>{deck.name}</span>
                    <span>{deck.stats.totalCards} cards</span>
                  </div>
                </button>
              ))}
              <button
                type="button"
                className={styles.importTile}
                onClick={() => {
                  setError(null)
                  setImportOpen(true)
                }}
                aria-label="Import a deck"
              >
                <span aria-hidden="true">+</span>Import deck
              </button>
            </div>
          </div>
          {importOpen && (
            <DeckImportDialog
              key={library.accountId}
              format={commander ? 'Commander' : 'Timeless'}
              destination="play"
              onClose={() => setImportOpen(false)}
              onImport={importDeck}
            />
          )}
          {!importOpen && error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
        </section>
        <aside className={styles.matchup} aria-label="Next game">
          <h2>Your next game</h2>
          <div className={styles.selectedDeck}>
            {cover && usable ? (
              <img src={scryfallUrl(cover)} alt={cover.name} />
            ) : (
              <div className={styles.emptyCard} aria-hidden="true">
                F
              </div>
            )}
            <div>
              <span className={styles.caption}>Your deck</span>
              <h3>{usable ? playerDeck.name : 'Choose your deck'}</h3>
              <p>
                {usable ? `${playerDeck.stats.totalCards} cards` : 'Pick a deck from the list.'}
              </p>
            </div>
          </div>
          {usable && (
            <details className={styles.deckList}>
              <summary>View deck list</summary>
              <pre>{deckDetailToGreDeck(playerDeck)}</pre>
            </details>
          )}
          <label className={styles.opponent}>
            AI opponent
            <select value={aiMode} onChange={(e) => setAiMode(e.target.value as AiMode)}>
              <option value="random">Surprise me with a ready-made deck</option>
              <option value="mirror">Play against the same deck</option>
              <option value="pick">Choose an opponent deck</option>
            </select>
          </label>
          {aiMode === 'pick' && (
            <>
              <button
                type="button"
                className={styles.pickOpponent}
                onClick={() => onPickDeck('opponent')}
              >
                {opponentDeck?.name ?? 'Choose opponent deck'}
              </button>
              {opponentDeckList && (
                <details className={styles.deckList} aria-label="Opponent deck list">
                  <summary>View opponent deck list</summary>
                  <pre>{opponentDeckList}</pre>
                </details>
              )}
            </>
          )}
          <p className={styles.rules}>
            {commander ? 'Commander · 40 life · Head-to-head' : 'Constructed · 20 life · 60+ cards'}
          </p>
          {deckError && (
            <p role="alert" className={styles.error}>
              {deckError}
            </p>
          )}
          <button
            type="button"
            className="public-primary"
            disabled={
              !usable || starting || library.loadingDetail || (aiMode === 'pick' && !opponentDeck)
            }
            aria-describedby={
              browserAvailability.status === 'fallback' ? 'browser-availability' : undefined
            }
            onClick={() => {
              setError(null)
              onStartDefault(startConfig())
            }}
          >
            {starting
              ? 'Preparing game…'
              : browserAvailability.status === 'fallback'
                ? 'Start server game'
                : 'Start game'}
          </button>
          {browserAvailability.status !== 'fallback' && (
            <button
              type="button"
              className={styles.serverStart}
              disabled={
                !usable || starting || library.loadingDetail || (aiMode === 'pick' && !opponentDeck)
              }
              onClick={() => {
                setError(null)
                onStartServer(startConfig())
              }}
            >
              Play on server
            </button>
          )}
          {browserAvailability.status === 'fallback' && (
            <p id="browser-availability" className={styles.browserAvailability} role="status">
              {browserAvailability.message}
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
