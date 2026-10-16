import { DraftCardDtoSchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
/**
 * Deck-building surface: mainboard/land state, card search, and save/cancel.
 * Split into `DeckEditorColumns` (mainboard + land pane) and
 * `DeckEditorSearchPanel` (card search pane) to stay under the file-size
 * budget — this container owns all state and hands each pane only the props
 * it renders.
 */

import { useEffect, useRef, useState } from 'react'
import {
  buildCmcGroups,
  emptyLandCounts,
  BASIC_LAND_NAMES,
  MAX_COPIES,
  type LandName,
  type IndexedCard,
} from '@shared/cards/deck-builder'
import { decksStore } from './decks-store'
import { libraryCard, type DeckDraft, type LibraryCard } from './deck-value'
import { apiFetch } from '@shared/api/client'
import { webDraftCards } from '@shared/cards/catalog'
import { trackDeckSearch } from '@shared/analytics'
import type { DraftCard } from '@shared/api/contracts'
import { CardHoverPreview } from '@features/gre/board/CardHoverPreview'
import { Button } from '@shared/ui/Button'
import { TextField } from '@shared/ui/Field'
import { DeckEditorColumns } from './DeckEditorColumns'
import { DeckEditorSearchPanel } from './DeckEditorSearchPanel'
import styles from './DeckEditor.module.css'

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G']

export function DeckEditor({
  initialDeck,
  onSave,
  onCancel,
}: {
  initialDeck: DeckDraft
  onSave: (deck: DeckDraft) => Promise<void>
  onCancel: () => void
}) {
  const [deckName, setDeckName] = useState(initialDeck.name)
  const [mainboard, setMainboard] = useState<LibraryCard[]>(() => [...initialDeck.cards])
  const initialCommandZone = initialDeck.commandZone
  const landCounts = emptyLandCounts()
  for (const card of mainboard) {
    if (BASIC_LAND_NAMES.has(card.name)) {
      landCounts[card.name as LandName] += card.quantity
    }
  }
  const [saving, setSaving] = useState(false)
  const [pendingLands, setPendingLands] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const expectedSize = initialCommandZone.length ? 100 : 60

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DraftCard[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [hoveredCard, setHoveredCard] = useState<DraftCard | null>(null)
  const [tooltipY, setTooltipY] = useState(0)

  const [initialMetadata, setInitialMetadata] = useState<Map<number, DraftCard>>(new Map())
  useEffect(() => {
    let current = true
    const ids = [...initialDeck.cards, ...initialDeck.sideboard, ...initialDeck.commandZone].map(
      (card) => card.grpId,
    )
    void webDraftCards(ids).then((cards) => {
      if (current) {
        setInitialMetadata(
          new Map(cards.filter((card) => card.typeLine != null).map((card) => [card.grpId!, card])),
        )
      }
    })
    return () => {
      current = false
    }
  }, [initialDeck])
  const inspectedCard = hoveredCard
    ? { ...hoveredCard, ...initialMetadata.get(hoveredCard.grpId ?? 0) }
    : null

  const totalLands = mainboard
    .filter((card) => card.typeLine?.includes('Land'))
    .reduce((sum, card) => sum + card.quantity, 0)
  const mainboardCount = mainboard.reduce((s, c) => s + c.quantity, 0)
  const totalCards = mainboardCount + initialCommandZone.reduce((n, c) => n + c.quantity, 0)

  const cmcGroups = buildCmcGroups(mainboard.map((c, i): IndexedCard => ({ ...c, poolIndex: i })))

  function addCard(card: DraftCard): void {
    setMainboard((prev) => {
      if (
        !BASIC_LAND_NAMES.has(card.name) &&
        prev
          .filter((entry) => entry.name === card.name)
          .reduce((sum, entry) => sum + entry.quantity, 0) >= MAX_COPIES
      ) {
        return prev
      }
      const existing = prev.find((c) => c.grpId === card.grpId)
      if (existing) {
        return prev.map((c) => (c.grpId === card.grpId ? { ...c, quantity: c.quantity + 1 } : c))
      }
      return [...prev, libraryCard(card, 1)]
    })
  }

  function removeCard(grpId: number): void {
    setMainboard((prev) => {
      const idx = prev.findIndex((c) => c.grpId === grpId)
      if (idx === -1) {
        return prev
      }
      const card = prev[idx]!
      if (card.quantity > 1) {
        return prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity - 1 } : c))
      }
      return prev.filter((_, i) => i !== idx)
    })
  }

  async function incrementLand(land: LandName): Promise<void> {
    setPendingLands((count) => count + 1)
    try {
      const existing = mainboard.find((card) => card.name === land)
      addCard(existing ?? (await decksStore.basicLand(land)))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not add this land.')
    } finally {
      setPendingLands((count) => count - 1)
    }
  }

  function decrementLand(land: LandName): void {
    const card = mainboard.find((card) => card.name === land)
    if (card) {
      removeCard(card.grpId)
    }
  }

  async function doSearch(q: string): Promise<void> {
    const query = q.trim()
    if (query.length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const params = new URLSearchParams({ q: query, limit: '20' })
      const resp = await apiFetch(`/api/cards/search?${params}`)
      if (resp.ok) {
        const results = await readJson(resp, DraftCardDtoSchema.array())
        const metadata = await webDraftCards(
          results.flatMap((card) => (card.grpId != null ? [card.grpId] : [])),
        )
        const byId = new Map(
          metadata.filter((card) => card.typeLine != null).map((card) => [card.grpId, card]),
        )
        setSearchResults(results.map((card) => ({ ...card, ...byId.get(card.grpId) })))
        trackDeckSearch({
          queryLength: query.length,
          outcome: 'success',
          resultCount: results.length,
        })
      } else {
        trackDeckSearch({ queryLength: query.length, outcome: 'server', status: resp.status })
      }
    } catch {
      trackDeckSearch({ queryLength: query.length, outcome: 'network' })
    } finally {
      setSearching(false)
    }
  }

  function onSearchInput(value: string): void {
    setSearchQuery(value)
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current)
    }
    searchTimeout.current = setTimeout(() => void doSearch(value), 300)
  }

  function handleCardHover(card: DraftCard, y: number): void {
    setHoveredCard(card)
    setTooltipY(y)
  }

  function handleCardLeave(): void {
    setHoveredCard(null)
  }

  async function handleSave(): Promise<void> {
    if (saving || pendingLands > 0 || totalCards === 0 || !deckName.trim()) {
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await onSave({ ...initialDeck, name: deckName.trim(), cards: mainboard })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save your deck.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.deckEditor}>
      <div className={styles.editorHeader}>
        <TextField
          className={styles.deckNameInput}
          type="text"
          placeholder="Deck name..."
          aria-label="Deck name"
          disabled={saving}
          value={deckName}
          onChange={(e) => setDeckName(e.currentTarget.value)}
        />
        <div className={styles.editorActions}>
          <Button
            size="compact"
            onClick={() => void handleSave()}
            disabled={saving || pendingLands > 0 || totalCards === 0 || !deckName.trim()}
          >
            {saving ? 'Saving...' : initialDeck.id ? 'Save' : 'Create'}
          </Button>
          <Button variant="secondary" size="compact" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>

      {pendingLands > 0 && <p role="status">Adding lands…</p>}
      {saveError && <p role="alert">{saveError}</p>}
      {initialCommandZone.length > 0 && (
        <p>Commander: {initialCommandZone.map((card) => card.name).join(' / ')}</p>
      )}
      <fieldset className={styles.editorBody} disabled={saving}>
        <DeckEditorColumns
          cmcGroups={cmcGroups}
          mainboard={mainboard}
          landCounts={landCounts}
          onRemoveCard={removeCard}
          onIncrementLand={(land) => void incrementLand(land)}
          onDecrementLand={decrementLand}
          onCardHover={handleCardHover}
          onCardLeave={handleCardLeave}
        />
        <DeckEditorSearchPanel
          searchQuery={searchQuery}
          searchResults={searchResults}
          searching={searching}
          onSearchInput={onSearchInput}
          onAddCard={addCard}
          onCardHover={handleCardHover}
          onCardLeave={handleCardLeave}
        />
      </fieldset>

      <div className={styles.editorFooter}>
        <span
          className={`${styles.statCount} ${totalCards < expectedSize && totalCards > 0 ? styles.warn : ''}`}
        >
          {totalCards}/{expectedSize} cards
        </span>
        <span className={styles.statColors}>
          {COLOR_ORDER.filter((c) => mainboard.some((card) => card.colors.includes(c))).map((c) => (
            <i key={c} className={`ms ms-cost ms-${c.toLowerCase()}`} />
          ))}
        </span>
        <span className={styles.statLands}>{totalLands} lands</span>
      </div>

      <CardHoverPreview card={inspectedCard} y={tooltipY} position="fixed-left" />
    </div>
  )
}
