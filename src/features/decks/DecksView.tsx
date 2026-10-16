/**
 * Container for `/decks` and `/decks/:deckId`, and the deck-picker modal's
 * pick-mode body (see `DeckPickerModal.tsx`, which composes `DeckList` +
 * `DeckDetailPane` directly rather than through this component). Owns the
 * browse/edit mode switch, deck selection, and the create/edit/import entry
 * points.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from '@app/router'
import { decksStore } from '@features/decks/decks-store'
import type { DeckSummary, DeckCard, DeckDetail } from '@shared/api/contracts'
import { useDecksSnapshot } from '@features/decks/decks-hooks'
import { trackDeckDeleted, trackDeckSaved } from '@shared/analytics'
import { CardHoverPreview } from '@features/gre/board/CardHoverPreview'
import { Button } from '@shared/ui/Button'
import { DeckList } from './DeckList'
import { DeckDetailPane } from './DeckDetailPane'
import { DeckEditor } from './DeckEditor'
import { DeckImportDialog, type ImportedDeck } from '@shared/cards/DeckImportDialog'
import styles from './DecksView.module.css'
import { importedContent, type DeckDraft } from './deck-value'

export function DecksView({
  pickMode = false,
  requireCommander = false,
  onSelect,
  initialDeckId,
}: {
  pickMode?: boolean
  requireCommander?: boolean
  onSelect?: (deck: DeckDetail) => void
  initialDeckId?: string
}) {
  const router = useRouter()
  const decks = useDecksSnapshot()
  const viewGeneration = useRef(0)

  const [mode, setMode] = useState<'browse' | 'edit'>('browse')
  const [editSeed, setEditSeed] = useState<DeckDraft | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [hoveredCard, setHoveredCard] = useState<DeckCard | null>(null)
  const [tooltipY, setTooltipY] = useState(0)

  const filteredDecks = useMemo(() => {
    let list = decks.decks
    if (requireCommander) {
      list = list.filter((d) => d.hasCommander)
    }
    const q = decks.searchQuery.toLowerCase().trim()
    if (q) {
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(q) || (d.description?.toLowerCase().includes(q) ?? false),
      )
    }
    if (decks.colorFilter.size > 0) {
      list = list.filter((d) => [...decks.colorFilter].every((c) => d.colors.includes(c)))
    }
    return list
  }, [decks.decks, decks.searchQuery, decks.colorFilter, requireCommander])

  useEffect(() => {
    const generation = viewGeneration
    generation.current++
    void decksStore.fetchDecks()
    if (initialDeckId && decksStore.snapshot().selectedDeck?.id !== initialDeckId) {
      void decksStore.fetchDeckDetail(initialDeckId)
    }
    return () => {
      generation.current++
    }
  }, [initialDeckId, decks.accountId])

  function selectDeck(deck: DeckSummary): void {
    viewGeneration.current++
    const path = `/decks/${encodeURIComponent(deck.id)}`
    if (!pickMode && router.path !== path) {
      router.navigate(path, true)
    } else {
      void decksStore.fetchDeckDetail(deck.id)
    }
  }

  function handleCardHover(card: DeckCard | null, y: number): void {
    setHoveredCard(card)
    setTooltipY(y)
  }

  function handleEdit(): void {
    viewGeneration.current++
    if (!decks.selectedDeck) {
      return
    }
    setEditSeed(decksStore.draft(decks.selectedDeck))
    setMode('edit')
  }

  async function handleDelete(deck: DeckDetail): Promise<void> {
    const generation = viewGeneration.current
    const ok = await decksStore.deleteDeck(deck.id)
    if (ok && generation === viewGeneration.current) {
      trackDeckDeleted(deck.id)
      router.navigate('/decks', true)
    }
  }

  function handleNewDeck(): void {
    viewGeneration.current++
    setEditSeed(decksStore.draft())
    setMode('edit')
  }

  function handleImport({ name, deck }: ImportedDeck): void {
    viewGeneration.current++
    setEditSeed(
      decksStore.draft(
        importedContent(name, deck, deck.commandZone.length ? 'Commander' : 'Timeless'),
      ),
    )
    setImportOpen(false)
    setMode('edit')
  }

  async function handleSave(draft: DeckDraft): Promise<void> {
    const generation = viewGeneration.current
    const saved = await decksStore.saveDeck(draft)
    if (!saved) {
      throw new Error('Your account changed. Reopen this deck before saving.')
    }
    if (generation !== viewGeneration.current) {
      return
    }
    trackDeckSaved({
      deckId: saved.id,
      operation: draft.id ? 'update' : 'create',
      format: draft.format,
      cardCount: draft.cards.reduce((total, card) => total + card.quantity, 0),
    })
    setMode('browse')
    setEditSeed(null)
    router.navigate(`/decks/${encodeURIComponent(saved.id)}`, true)
  }

  function handleCancel(): void {
    viewGeneration.current++
    setMode('browse')
    setEditSeed(null)
  }

  if (mode === 'edit' && editSeed && editSeed.accountId === decks.accountId) {
    return <DeckEditor initialDeck={editSeed} onSave={handleSave} onCancel={handleCancel} />
  }

  return (
    <>
      <div className={styles.decksLayout}>
        <div className={styles.deckLibraryColumn}>
          <DeckList
            decks={filteredDecks}
            selectedDeckId={decks.selectedDeck?.id ?? null}
            loading={decks.loading}
            searchQuery={decks.searchQuery}
            colorFilter={decks.colorFilter}
            onSearch={(q) => decksStore.setSearchQuery(q)}
            onToggleColor={(c) => decksStore.toggleColor(c)}
            onSelect={selectDeck}
            headerActions={
              !pickMode && (
                <div className={styles.headerBtns}>
                  <Button variant="secondary" size="compact" onClick={handleNewDeck}>
                    New
                  </Button>
                  <Button variant="secondary" size="compact" onClick={() => setImportOpen(true)}>
                    Import
                  </Button>
                </div>
              )
            }
          />
        </div>
        <DeckDetailPane
          deck={decks.selectedDeck}
          loading={decks.loadingDetail}
          pickMode={pickMode}
          onSelect={onSelect}
          error={decks.error}
          onEdit={pickMode ? undefined : decks.selectedDeck?.userOwned ? handleEdit : undefined}
          onDelete={
            pickMode
              ? undefined
              : decks.selectedDeck?.userOwned
                ? (deck) => void handleDelete(deck)
                : undefined
          }
          onCardHover={handleCardHover}
        />
        <CardHoverPreview card={hoveredCard} y={tooltipY} position="fixed-left" />
      </div>

      {importOpen && (
        <DeckImportDialog
          key={decks.accountId}
          destination="editor"
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
        />
      )}
    </>
  )
}
