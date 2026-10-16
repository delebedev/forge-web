import { useState } from 'react'
import { parseManaSymbols } from '@shared/cards/mana'
import type { DeckCard, DeckDetail } from '@shared/api/contracts'
import { scryfallUrl } from '@shared/cards/scryfall'
import { Button } from '@shared/ui/Button'
import styles from './DeckDetailPane.module.css'

const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
}

const TYPE_ORDER = [
  'Creature',
  'Instant',
  'Sorcery',
  'Enchantment',
  'Artifact',
  'Planeswalker',
  'Land',
  'Other',
]

function groupCardsByType(cards: DeckCard[]): [string, DeckCard[]][] {
  const groups: Record<string, DeckCard[]> = {}
  for (const card of cards) {
    const tl = card.typeLine ?? ''
    let bucket = 'Other'
    for (const t of TYPE_ORDER) {
      if (t !== 'Other' && tl.includes(t)) {
        bucket = t
        break
      }
    }
    if (!groups[bucket]) {
      groups[bucket] = []
    }
    groups[bucket]!.push(card)
  }
  return TYPE_ORDER.filter((t) => groups[t] && groups[t]!.length > 0).map((t) => [t, groups[t]!])
}

function groupCount(cards: DeckCard[]): number {
  return cards.reduce((sum, c) => sum + c.quantity, 0)
}

function deckListText(detail: DeckDetail): string {
  return detail.content?.trim() || detail.cards.map((c) => `${c.quantity} ${c.name}`).join('\n')
}

export function DeckDetailPane({
  deck = null,
  loading = false,
  pickMode = false,
  onSelect,
  onEdit,
  onDelete,
  onCardHover,
  error,
}: {
  deck: DeckDetail | null
  loading?: boolean
  pickMode?: boolean
  onSelect?: (deck: DeckDetail) => void
  onEdit?: (deck: DeckDetail) => void
  onDelete?: (deck: DeckDetail) => void
  onCardHover?: (card: DeckCard | null, y: number) => void
  error?: string | null
}) {
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function copyDecklist(): Promise<void> {
    if (!deck) {
      return
    }
    try {
      await navigator.clipboard.writeText(deckListText(deck))
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 1500)
    } catch {
      /* clipboard denied */
    }
  }

  const cover = deck?.commandZone?.[0] ?? deck?.cards[0]
  const maxCurve = deck ? Math.max(1, ...Object.values(deck.stats.manaCurve)) : 1

  return (
    <div className={styles.detailPanel}>
      {loading ? (
        <div className={styles.detailEmpty}>
          <div className={styles.spinner} />
          <span>Loading deck...</span>
        </div>
      ) : deck ? (
        <div className={styles.detailScroll}>
          <div className={styles.detailHeader}>
            <div>
              {cover && <img className={styles.detailCover} src={scryfallUrl(cover)} alt="" />}
              <div className={styles.detailTitleRow}>
                <div className={styles.detailTitleLeft}>
                  <h2 className={styles.detailName}>{deck.name}</h2>
                  <div className={styles.detailMeta}>
                    <span className={styles.detailColors}>
                      {deck.colors.map((c, i) => (
                        <i
                          key={i}
                          className={`ms ms-cost ms-${c.toLowerCase()}`}
                          title={COLOR_NAMES[c]}
                        />
                      ))}
                    </span>
                    {deck.set && <span className={styles.detailSetBadge}>{deck.set}</span>}
                    <span className={styles.detailCardCount}>{deck.stats.totalCards} cards</span>
                  </div>
                </div>
                <div className={styles.detailActions}>
                  <Button variant="secondary" size="compact" onClick={() => void copyDecklist()}>
                    {copyFeedback ? 'Copied!' : 'Copy Decklist'}
                  </Button>
                  {pickMode ? (
                    <Button size="compact" onClick={() => onSelect?.(deck)}>
                      Select This Deck
                    </Button>
                  ) : (
                    <>
                      {onEdit && (
                        <Button variant="secondary" size="compact" onClick={() => onEdit?.(deck)}>
                          Edit
                        </Button>
                      )}
                      {onDelete &&
                        (confirmingDelete ? (
                          <>
                            <Button
                              variant="danger"
                              size="compact"
                              onClick={() => {
                                onDelete?.(deck)
                                setConfirmingDelete(false)
                              }}
                            >
                              Confirm Delete
                            </Button>
                            <Button
                              variant="secondary"
                              size="compact"
                              onClick={() => setConfirmingDelete(false)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="danger"
                            size="compact"
                            onClick={() => setConfirmingDelete(true)}
                          >
                            Delete
                          </Button>
                        ))}
                      <Button variant="secondary" size="compact" disabled title="Coming soon">
                        Play
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {deck.description && <p className={styles.detailDesc}>{deck.description}</p>}
            </div>
          </div>

          {deck.metadataComplete === false ? (
            <p role="status">
              Card details are unavailable. Statistics will return when card details load.
            </p>
          ) : (
            <div className={styles.statsBlock}>
              <div className={styles.statsRow}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Creatures</span>
                  <span className={styles.statValue}>{deck.stats.creatures}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Spells</span>
                  <span className={styles.statValue}>{deck.stats.nonCreatures}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Lands</span>
                  <span className={styles.statValue}>{deck.stats.lands}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>Avg CMC</span>
                  <span className={styles.statValue}>{deck.stats.averageCmc.toFixed(1)}</span>
                </div>
              </div>

              <div className={styles.curveBlock}>
                <div className={styles.curveLabel}>Mana Curve</div>
                <div className={styles.curveBars}>
                  {[0, 1, 2, 3, 4, 5, 6].map((cmc) => {
                    const count = deck.stats.manaCurve[String(cmc)] ?? 0
                    return (
                      <div key={cmc} className={styles.curveCol}>
                        <div className={styles.curveCount}>{count || ''}</div>
                        <div
                          className={styles.curveBar}
                          style={{
                            height: `${count > 0 ? Math.max(4, (count / maxCurve) * 80) : 0}px`,
                          }}
                        />
                        <div className={styles.curveCmc}>{cmc === 6 ? '6+' : cmc}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          <div className={styles.cardGroups}>
            {[
              ...(deck.commandZone?.length
                ? [['Commander', deck.commandZone] as [string, DeckCard[]]]
                : []),
              ...groupCardsByType(deck.cards),
              ...(deck.sideboard?.length
                ? [['Sideboard', deck.sideboard] as [string, DeckCard[]]]
                : []),
            ].map(([typeName, cards]) => (
              <div key={typeName} className={styles.cardGroup}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupName}>
                    {typeName === 'Sideboard' ? typeName : `${typeName}s`}
                  </span>
                  <span className={styles.groupCount}>({groupCount(cards)})</span>
                </div>
                {cards.map((card) => (
                  <div
                    key={card.name + (card.setCode ?? '')}
                    className={styles.cardRow}
                    onMouseEnter={(e) =>
                      onCardHover?.(card, e.currentTarget.getBoundingClientRect().top)
                    }
                    onMouseLeave={() => onCardHover?.(null, 0)}
                  >
                    <span className={styles.cardQty}>{card.quantity}x</span>
                    <span className={styles.cardName}>{card.name}</span>
                    <span className={styles.cardMana}>
                      {parseManaSymbols(card.manaCost ?? '').map((sym, i) => (
                        <i key={i} className={sym.classes} title={sym.label} />
                      ))}
                    </span>
                    {card.power != null && card.toughness != null && (
                      <span className={styles.cardPt}>
                        {card.power}/{card.toughness}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.detailEmpty}>
          <span className={styles.detailEmptyIcon}>
            <i className="ms ms-cost ms-tap" />
          </span>
          <p>Select a deck to view details</p>
        </div>
      )}

      {error && <div className={styles.decksError}>{error}</div>}
    </div>
  )
}
