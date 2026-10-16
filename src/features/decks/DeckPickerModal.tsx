import { useEffect, useMemo, useState } from 'react'
import { decksStore } from '@features/decks/decks-store'
import type { DeckCard, DeckDetail, DeckSummary } from '@shared/api/contracts'
import { DeckDetailPane } from '@features/decks/DeckDetailPane'
import { DeckList } from '@features/decks/DeckList'
import { useDecksSnapshot } from '@features/decks/decks-hooks'
import { CardHoverPreview } from '@features/gre/board/CardHoverPreview'
import { Modal } from '@shared/ui/Modal'
import styles from './DeckPickerModal.module.css'

export function DeckPickerModal({
  open,
  onClose,
  onSelect,
  requireCommander = false,
}: {
  open: boolean
  onClose?: () => void
  onSelect?: (deck: DeckDetail) => void
  requireCommander?: boolean
}) {
  const decks = useDecksSnapshot()
  const [hoveredCard, setHoveredCard] = useState<DeckCard | null>(null)
  const [tooltipY, setTooltipY] = useState(0)
  const selectedDeck =
    Boolean(decks.selectedDeck?.hasCommander) === requireCommander ? decks.selectedDeck : null

  const filteredDecks = useMemo(() => {
    let list = decks.decks
    list = list.filter((d) => Boolean(d.hasCommander) === requireCommander)
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

  // `fetchDecks` itself guards against re-fetching once loaded, so
  // remounting on every open is cheap.
  useEffect(() => {
    void decksStore.fetchDecks()
  }, [decks.accountId])

  function selectDeck(deck: DeckSummary): void {
    void decksStore.fetchDeckDetail(deck.id)
  }

  function handleCardHover(card: DeckCard | null, y: number): void {
    setHoveredCard(card)
    setTooltipY(y)
  }

  if (!open) {
    return null
  }

  return (
    <Modal open={open} onClose={onClose} title="Choose a Deck" maxWidth="1100px">
      <div className={styles.pickerBody}>
        <div className={styles.decksLayout}>
          <DeckList
            decks={filteredDecks}
            selectedDeckId={selectedDeck?.id ?? null}
            loading={decks.loading}
            searchQuery={decks.searchQuery}
            colorFilter={decks.colorFilter}
            onSearch={(q) => decksStore.setSearchQuery(q)}
            onToggleColor={(c) => decksStore.toggleColor(c)}
            onSelect={selectDeck}
          />
          <DeckDetailPane
            deck={selectedDeck}
            loading={decks.loadingDetail}
            pickMode
            onSelect={onSelect}
            error={decks.error}
            onCardHover={handleCardHover}
          />
          <CardHoverPreview card={hoveredCard} y={tooltipY} position="fixed-left" />
        </div>
      </div>
    </Modal>
  )
}
