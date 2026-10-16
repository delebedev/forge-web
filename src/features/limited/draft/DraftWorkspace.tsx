import { useState } from 'react'
import type { DraftCard } from '@shared/api/contracts'
import { CardHoverPreview } from '@features/gre/board/CardHoverPreview'
import { DraftPackArea } from './DraftPackArea'
import { DraftPoolSidebar } from './DraftPoolSidebar'
import styles from './DraftPicking.module.css'

const RARITY_ORDER: Record<string, number> = {
  mythic: 0,
  mythicrare: 0,
  'mythic rare': 0,
  rare: 1,
  uncommon: 2,
  common: 3,
}

const COLOR_ORDER: Record<string, number> = {
  W: 0,
  U: 1,
  B: 2,
  R: 3,
  G: 4,
}

function cardSortKey(card: DraftCard): string {
  const rarity = RARITY_ORDER[(card.rarity ?? 'common').toLowerCase()] ?? 3
  let color: number
  if (card.typeLine?.toLowerCase().includes('land')) {
    color = 7
  } else if ((card.colors?.length ?? 0) > 1) {
    color = 5
  } else if (card.colors?.length === 1) {
    color = COLOR_ORDER[card.colors[0]!] ?? 6
  } else {
    color = 6
  }
  return `${rarity}${color}${card.name}`
}

function cardScore(card: DraftCard): number {
  return card.score != null && Number.isFinite(card.score) && card.score > -100
    ? card.score
    : -Infinity
}

function sortPack(pack: DraftCard[], mode: 'ranked' | 'natural', hasScores: boolean): DraftCard[] {
  if (mode === 'ranked' && !hasScores) {
    return pack
  }
  return [...pack].sort((a, b) => {
    if (mode === 'ranked' && cardScore(a) !== cardScore(b)) {
      return cardScore(b) - cardScore(a)
    }
    return cardSortKey(a).localeCompare(cardSortKey(b))
  })
}

export interface DraftWorkspaceProps {
  pack: DraftCard[]
  pool: DraftCard[]
  round: number
  pick: number
  picking?: boolean
  error?: string | null
  autoPicking?: boolean
  onPick: (card: DraftCard) => void
  onAutoPick?: () => void
}

/** Store-free draft table: owns presentation state and renders supplied draft values. */
export function DraftWorkspace({
  pack,
  pool,
  round,
  pick,
  picking = false,
  error = null,
  autoPicking = false,
  onPick,
  onAutoPick,
}: DraftWorkspaceProps) {
  const [sortMode, setSortMode] = useState<'ranked' | 'natural'>('natural')
  const [hoveredPoolCard, setHoveredPoolCard] = useState<DraftCard | null>(null)
  const [poolTooltipY, setPoolTooltipY] = useState(0)

  const hasScores = pack.some((card) => cardScore(card) > -Infinity)
  const sortedPack = sortPack(pack, sortMode, hasScores)

  return (
    <div className={styles.draftLayout}>
      <DraftPackArea
        pack={sortedPack}
        round={round}
        pick={pick}
        picking={picking}
        error={error}
        autoPicking={autoPicking}
        sortMode={sortMode}
        hasScores={hasScores}
        onPick={onPick}
        onToggleAutoPick={onAutoPick}
        onToggleSort={() => setSortMode((mode) => (mode === 'ranked' ? 'natural' : 'ranked'))}
      />

      <DraftPoolSidebar
        pool={pool}
        onCardHover={(card, y) => {
          setHoveredPoolCard(card)
          setPoolTooltipY(y)
        }}
        onCardLeave={() => setHoveredPoolCard(null)}
      />

      <CardHoverPreview card={hoveredPoolCard} y={poolTooltipY} position="fixed-right" />
    </div>
  )
}
