import { useState } from 'react'
import type { BoardSnapshot } from '@engine/runtime/snapshot'
import {
  legalActionKey,
  ZONE_COMMAND,
  ZONE_EXILE,
  ZONE_GRAVEYARD,
  ZONE_LIBRARY,
  type CardView,
  type LegalAction,
} from '@engine/state/gre-state'
import { Card } from './Card'
import styles from './NonHandActionRail.module.css'

export type NonHandActionEntry = {
  card: CardView
  zone: 'Graveyard' | 'Exile' | 'Command zone' | 'Library top'
  zoneType: number
  actions: LegalAction[]
}

function displayActionLabel(action: LegalAction): string {
  return `${action.label}${action.manaCost ? ` · Cost ${action.manaCost}` : ''}`
}

function entryKey(entry: NonHandActionEntry): string {
  return `${entry.zoneType}:${entry.card.instanceId}:${entry.card.grpId}`
}

type NonHandActionBoard = Pick<BoardSnapshot, 'nonHandActionCards'> & {
  commandZone?: CardView[]
}

function zoneLabel(zoneType: number): NonHandActionEntry['zone'] | null {
  return zoneType === ZONE_GRAVEYARD
    ? 'Graveyard'
    : zoneType === ZONE_EXILE
      ? 'Exile'
      : zoneType === ZONE_COMMAND
        ? 'Command zone'
        : zoneType === ZONE_LIBRARY
          ? 'Library top'
          : null
}

export function nonHandActionEntries(board: NonHandActionBoard): NonHandActionEntry[] {
  const entries = new Map<string, NonHandActionEntry>()
  const commandZone = board.commandZone ?? []
  for (const card of commandZone) {
    entries.set(entryKey({ card, zone: 'Command zone', zoneType: ZONE_COMMAND, actions: [] }), {
      card,
      zone: 'Command zone',
      zoneType: ZONE_COMMAND,
      actions: [],
    })
  }

  for (const { action, card } of board.nonHandActionCards) {
    const zone = zoneLabel(action.zoneType)
    if (!zone) {
      continue
    }
    const key = entryKey({ card, zone, zoneType: action.zoneType, actions: [] })
    const entry = entries.get(key)
    if (entry) {
      entry.actions.push(action)
    } else {
      entries.set(key, { card, zone, zoneType: action.zoneType, actions: [action] })
    }
  }
  return [...entries.values()]
}

export function NonHandActionRail({
  entries,
  disabled,
  onAction,
  onHover,
}: {
  entries: NonHandActionEntry[]
  disabled: boolean
  onAction: (action: LegalAction) => void
  onHover: (card: CardView | null) => void
}) {
  const [choosing, setChoosing] = useState<string | null>(null)
  if (entries.length === 0) {
    return null
  }

  const chosenEntry = entries.find((entry) => entryKey(entry) === choosing)
  const availableCount = entries.filter((entry) => entry.actions.length > 0).length

  function choose(action: LegalAction) {
    setChoosing(null)
    onAction(action)
  }

  return (
    <section className={styles.rail} aria-label="Cards outside your hand">
      <span className={styles.railLabel}>
        Available <b>{availableCount}</b>
      </span>
      <div
        className={styles.cards}
        tabIndex={0}
        aria-label={`${entries.length} cards outside your hand; scroll for more`}
      >
        {entries.map((entry) => {
          const onlyAction = entry.actions.length === 1 ? entry.actions[0]! : null
          const key = entryKey(entry)
          const menuOpen = choosing === key
          const actionLabel =
            (onlyAction ? displayActionLabel(onlyAction) : null) ??
            (entry.actions.length > 1
              ? `Choose action for ${entry.card.name} from ${entry.zone.toLowerCase()}`
              : `${entry.card.name} from ${entry.zone.toLowerCase()}`)
          const actionable = !disabled && entry.actions.length > 0
          return (
            <div
              className={styles.entry}
              key={key}
              data-non-hand-action="true"
              data-source-zone={entry.zoneType}
            >
              <span className={styles.zone}>
                {entry.zone === 'Graveyard'
                  ? 'GY'
                  : entry.zone === 'Exile'
                    ? 'EX'
                    : entry.zone === 'Library top'
                      ? 'TOP'
                      : 'CMD'}
              </span>
              <Card
                card={entry.card}
                variant="mini"
                actionChrome
                actions={entry.actions}
                disabled={!actionable}
                selectable={actionable}
                ariaLabel={actionLabel}
                onClick={() => {
                  if (onlyAction) {
                    choose(onlyAction)
                  } else if (entry.actions.length > 1) {
                    setChoosing(menuOpen ? null : key)
                  }
                }}
                onHover={onHover}
              />
              <span className={styles.actionLabel} title={actionLabel}>
                {onlyAction
                  ? displayActionLabel(onlyAction)
                  : entry.actions.length > 1
                    ? `Choose · ${entry.card.name}`
                    : `${entry.card.name} unavailable`}
              </span>
            </div>
          )
        })}
      </div>
      {chosenEntry && (
        <div className={styles.menu} aria-label={`${chosenEntry.card.name} actions`}>
          {chosenEntry.actions.map((action) => (
            <button
              type="button"
              key={legalActionKey(action)}
              data-action-key={legalActionKey(action)}
              data-action-type={action.actionType}
              data-alternative-cost={action.hasAlternativeCost ? 'true' : 'false'}
              data-ability-grp-id={action.abilityGrpId || undefined}
              data-source-zone={action.zoneType}
              disabled={disabled}
              onClick={() => choose(action)}
            >
              {displayActionLabel(action)}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
