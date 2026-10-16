import { useState } from 'react'
import type { CardView, PlayerView, TargetCandidate } from '@engine/state/gre-state'
import type { DungeonView } from '@engine/state/dungeon-view'
import { cx } from '@shared/react/cx'
import { artCropUrl } from '@shared/cards/scryfall'
import styles from './variants/classic/Board.module.css'

export function PlayerPlate({
  player,
  seat,
  label,
  active,
  priority,
  libraryTop,
  resourceNote,
  graveyard,
  exile,
  emblems = [],
  dungeon,
  dungeonCard,
  hideCardArt = false,
  target,
  waiting,
  showLifeChange = true,
  onTarget,
  onOpenZone,
  onHover,
}: {
  player: PlayerView | null
  seat: 'self' | 'opponent'
  label: string
  active: boolean
  priority: boolean
  libraryTop?: CardView | null
  resourceNote?: string
  graveyard: CardView[]
  exile: CardView[]
  emblems?: CardView[]
  dungeon?: DungeonView | null
  dungeonCard?: CardView | null
  hideCardArt?: boolean
  target?: TargetCandidate
  waiting?: boolean
  showLifeChange?: boolean
  onTarget?: (target: TargetCandidate) => void
  onOpenZone: (title: string, cards: CardView[], source?: 'library-top') => void
  onHover?: (card: CardView | null) => void
}) {
  const owner = seat === 'self' ? 'Your' : "Opponent's"
  const life = player?.lifeTotal ?? '–'
  const [change, setChange] = useState({ life, delta: 0, showLifeChange })
  if (change.life !== life || change.showLifeChange !== showLifeChange) {
    setChange({
      life,
      showLifeChange,
      delta:
        change.showLifeChange &&
        showLifeChange &&
        typeof life === 'number' &&
        typeof change.life === 'number'
          ? life - change.life
          : 0,
    })
  }
  const lifeDisplay = (
    <span className={styles.lifeReading}>
      <strong key={life} className={styles.lifeTotal} data-life={life}>
        {life}
      </strong>
      {change.delta !== 0 && (
        <span key={`${life}:${change.delta}`} className={styles.lifeDelta} aria-hidden="true">
          {change.delta > 0 ? '+' : ''}
          {change.delta}
        </span>
      )}
    </span>
  )
  return (
    <div
      className={cx(styles.playerBox, seat === 'self' ? styles.selfBox : styles.oppBox)}
      data-player={seat}
      data-target={seat}
      data-active={active}
      data-has-priority={priority}
    >
      {(emblems.length > 0 || dungeon?.name) && (
        <div
          className={styles.emblemTiles}
          role="group"
          aria-label={`${owner} ${dungeon?.name ? 'dungeon and emblem tiles' : 'emblem tiles'}`}
        >
          {dungeon?.name && (
            <button
              className={styles.emblemTile}
              aria-label={`${owner} dungeon: ${dungeon.name}, ${dungeon.room ?? 'entering'}`}
              onClick={() => onHover?.(dungeonCard ?? null)}
              onMouseEnter={() => onHover?.(dungeonCard ?? null)}
              onMouseLeave={(event) => {
                if (!event.currentTarget.matches(':focus')) {
                  onHover?.(null)
                }
              }}
              onFocus={() => onHover?.(dungeonCard ?? null)}
              onBlur={(event) => {
                if (!event.currentTarget.matches(':hover')) {
                  onHover?.(null)
                }
              }}
            >
              <span className={styles.emblemImage}>
                {dungeon.imageUrl && !hideCardArt ? (
                  <img src={artCropUrl(dungeon.imageUrl)} alt={`${dungeon.name} art`} />
                ) : (
                  <span className={styles.dungeonMark}>D</span>
                )}
              </span>
              <strong>{dungeon.room ?? dungeon.name}</strong>
            </button>
          )}
          {emblems.map((emblem) => (
            <button
              key={emblem.instanceId}
              className={styles.emblemTile}
              aria-label={`${owner} emblem: ${emblem.name}`}
              data-card={emblem.name}
              data-instance-id={emblem.instanceId}
              onClick={() => onHover?.(emblem)}
              onMouseEnter={() => onHover?.(emblem)}
              onMouseLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(emblem)}
              onBlur={() => onHover?.(null)}
            >
              <span className={styles.emblemImage}>
                {emblem.imageUrl && !hideCardArt && (
                  <img src={artCropUrl(emblem.imageUrl)} alt="" />
                )}
              </span>
              <strong>Emblem</strong>
            </button>
          ))}
        </div>
      )}
      {resourceNote && <span className={styles.resourceNote}>{resourceNote}</span>}
      <div className={styles.playerIdentity}>
        <span className={styles.avatar}>{label}</span>
        {target && onTarget ? (
          <button
            className={cx(styles.lifeTarget, target.selected && styles.targetSelected)}
            aria-label={`Target ${seat === 'self' ? 'yourself' : 'opponent'}`}
            aria-pressed={target.selected}
            disabled={waiting}
            onClick={() => onTarget(target)}
          >
            {lifeDisplay}
          </button>
        ) : (
          lifeDisplay
        )}
        <span className={styles.playerStatus}>
          {priority ? 'Priority' : active ? 'Active turn' : ''}
        </span>
      </div>
      {(player?.counters?.length ?? 0) > 0 && (
        <div className={styles.playerCounters} role="group" aria-label={`${owner} counters`}>
          {player?.counters?.map((counter) => (
            <span key={counter.type}>
              {counter.name} <strong>{counter.count}</strong>
            </span>
          ))}
        </div>
      )}
      {dungeon && (dungeon.name || dungeon.completed.length > 0) && (
        <div className={styles.dungeonProgress}>
          {dungeon.name && (
            <span>
              {dungeon.name} · {dungeon.room ?? 'Entering'}
            </span>
          )}
          {dungeon.completed.length > 0 && <span>Completed: {dungeon.completed.join(', ')}</span>}
        </div>
      )}
      <div className={styles.zones}>
        {libraryTop ? (
          <button
            className={styles.zone}
            data-zone="library"
            data-owner={seat}
            onClick={() => onOpenZone('Top of your Library', [libraryTop], 'library-top')}
            title="Inspect the top of your library"
          >
            <span>{player?.libraryCount ?? 0}</span>
            <small>Library</small>
          </button>
        ) : (
          <span
            className={styles.zone}
            data-zone="library"
            data-owner={seat}
            title={`${owner} library`}
          >
            <span>{player?.libraryCount ?? 0}</span>
            <small>Library</small>
          </span>
        )}
        <button
          className={styles.zone}
          data-zone="graveyard"
          data-owner={seat}
          onClick={() => onOpenZone(`${owner} Graveyard`, graveyard)}
          title={`${owner} graveyard`}
        >
          <span>{graveyard.length}</span>
          <small>Graveyard</small>
        </button>
        <button
          className={styles.zone}
          data-zone="exile"
          data-owner={seat}
          onClick={() => onOpenZone(`${owner} Exile`, exile)}
          title={`${owner} exile`}
        >
          <span>{exile.length}</span>
          <small>Exile</small>
        </button>
      </div>
    </div>
  )
}
