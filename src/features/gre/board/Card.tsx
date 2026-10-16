import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { CardView, LegalAction } from '@engine/state/gre-state'
import type { PresentationMotionKind } from '@engine/state/presentation-policy'
import { counterIcon, keywordIcons, parseManaSymbols } from '@shared/cards/mana'
import { cx } from '@shared/react/cx'
import { artCropUrl } from '@shared/cards/scryfall'
import { ComposedCardBody, cardBodyFromView } from './ComposedCardBody'
import styles from './Card.module.css'

type Variant = 'hand' | 'board' | 'opponent' | 'mini' | 'preview'

/** Battlefield cards render as art tiles; rules text lives in the hover preview. */
const TILE_VARIANTS = new Set<Variant>(['board', 'opponent'])

const MANA_COLORS: Record<string, string> = {
  W: '#e9e1c6',
  U: '#5b8fd4',
  B: '#7a7186',
  R: '#c5543e',
  G: '#5aa05f',
  C: '#b3ada1',
  X: '#d2ccc0',
}

export function Card({
  card,
  variant = 'board',
  index = 0,
  count = 1,
  compact = false,
  actionChrome = true,
  disabled = false,
  selectable = false,
  selected = false,
  pileCount = 1,
  attachment = false,
  onClick,
  onHover,
  onPointerDown,
  ariaLabel,
  actions,
  motion,
}: {
  card: CardView
  variant?: Variant
  index?: number
  count?: number
  compact?: boolean
  attachment?: boolean
  pileCount?: number
  actionChrome?: boolean
  disabled?: boolean
  selectable?: boolean
  selected?: boolean
  onClick?: () => void
  onHover?: (card: CardView | null) => void
  onPointerDown?: (card: CardView, event: React.PointerEvent) => void
  ariaLabel?: string
  actions?: LegalAction[]
  motion?: PresentationMotionKind
}) {
  if (card.phasedOut) {
    actions = []
    selectable = false
    selected = false
    onClick = undefined
    onPointerDown = undefined
    actionChrome = false
  }
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const displayName = card.faceDown ? 'Face-down card' : card.name
  const hasArt = Boolean(!card.faceDown && card.imageUrl && card.imageUrl !== failedImage)
  const hoverIn = () => onHover?.(card)
  const hoverOut = () => onHover?.(null)
  const pointerDown = (event: React.PointerEvent) => onPointerDown?.(card, event)

  const isTile = TILE_VARIANTS.has(variant)
  const actionTypes = actions?.map((action) => action.actionType)
  const playable = cardIsPlayable(card, actionTypes)

  const classes = cx(
    styles.card,
    card.phasedOut && styles.phasedOut,
    variant === 'hand' && styles.handCard,
    isTile && styles.tile,
    attachment && styles.attachment,
    variant === 'preview' && styles.preview,
    variant === 'mini' && styles.mini,
    compact && !isTile && styles.compact,
    selectable && styles.selectable,
    selected && styles.selected,
    hasArt && styles.withArt,
    actionChrome && playable && styles.playable,
    card.tapped && styles.tap,
    card.attacking && styles.attacking,
    motion === 'zone' && styles.motionZone,
    motion === 'cast' && styles.motionCast,
    motion === 'resolve' && styles.motionResolve,
    motion === 'damage' && styles.motionDamage,
    motion === 'tap' && styles.motionTap,
    motion === 'counter' && styles.motionCounter,
  )

  const handSpread = (index - (count - 1) / 2) * Math.min(1, 7 / count)
  const handLift = Math.abs(handSpread)
  const handStyle: CSSProperties | undefined =
    variant === 'hand'
      ? ({ '--spread': handSpread, '--lift': handLift, '--index': index } as CSSProperties)
      : undefined
  const pips = parseManaSymbols(
    parseManaCost(card.faceDown ? '' : card.manaCost)
      .map((token) => `{${token}}`)
      .join(''),
  )
  const keywords = keywordIcons(
    (card.keywords ?? []).map((keyword) => ({ keyword, text: keyword })),
  )
  const artLabel = card.faceDown ? 'FACE DOWN' : artKind(card)
  const showFullText = variant === 'hand' || variant === 'preview'
  // Excludes `preview`, which prints the type line through `showFullText`.
  const showCompactText = variant !== 'mini' && variant !== 'preview'
  const showVisibleHeader = !hasArt || variant === 'preview'
  const cardColorValue = cardColor(card)
  const frameStyle = { '--card-color': cardColorValue } as CSSProperties

  function hideBrokenCardImage() {
    setFailedImage(card.imageUrl)
  }

  // Badges sit outside the frame so they anchor to the visible box, not to the
  // taller art the tile crops.
  const tileBody = (
    <>
      <div className={cx(styles.frame, styles.tileFrame)} style={frameStyle}>
        <span className={styles.cardSearchText}>
          {displayName} {card.faceDown ? '' : card.manaCost}
        </span>
        <div className={styles.tileArt}>
          {hasArt && (
            <img
              className={styles.cardArt}
              src={artCropUrl(card.imageUrl)}
              alt={displayName}
              decoding="async"
              onError={hideBrokenCardImage}
            />
          )}
          {!hasArt && <span className={styles.artLabel}>{artLabel}</span>}
        </div>
      </div>
      {card.tapped && <i className={cx('ms ms-tap', styles.tapGlyph)} aria-hidden="true" />}
      {pileCount > 1 && <span className={styles.pileCount}>×{pileCount}</span>}
      {keywords.length > 0 && (
        <span className={styles.keywordMarks}>
          {keywords.map((kw) => (
            <i key={kw.label} className={kw.classes} aria-label={kw.label} />
          ))}
        </span>
      )}
      {(card.counters?.length ?? 0) > 0 && (
        <span className={styles.counterMarks}>
          {card.counters!.map((counter) => {
            const icon = counterIcon(counter.name)
            const label = `${counter.count} ${counter.name} counter${counter.count === 1 ? '' : 's'}`
            return (
              <span
                key={counter.type}
                className={styles.counterBadge}
                role="img"
                aria-label={label}
                title={label}
                data-counter-type={counter.type}
                data-counter-count={counter.count}
              >
                {icon ? <i className={icon} aria-hidden="true" /> : <span>{counter.name}</span>}
                <strong>{counter.count}</strong>
              </span>
            )
          })}
        </span>
      )}
      <span className={styles.tileName}>{displayName}</span>
      {(card.roomDoors?.length ?? 0) > 0 && (
        <span className={styles.roomDoors}>
          {card.roomDoors!.map((door, index) => (
            <span
              key={door.grpId}
              aria-label={`${door.name}: ${door.unlocked ? 'unlocked' : 'locked'}`}
            >
              {index === 0 ? 'L' : 'R'}: {door.unlocked ? 'open' : 'locked'}
            </span>
          ))}
        </span>
      )}
      {!card.faceDown && card.powerToughness && (
        <span className={styles.tilePt} data-pt={card.powerToughness}>
          {card.powerToughness}
        </span>
      )}
    </>
  )

  const body = (
    <div className={styles.frame} style={frameStyle}>
      {showVisibleHeader ? (
        <div className={styles.cardHead}>
          <span className={styles.name}>{displayName}</span>
          {pips.length > 0 && (
            <span className={styles.pips} aria-label={card.manaCost}>
              {pips.map((pip, i) => (
                <i key={i} className={pip.classes} aria-hidden="true" />
              ))}
            </span>
          )}
        </div>
      ) : (
        <span className={styles.cardSearchText}>
          {displayName} {card.faceDown ? '' : card.manaCost}
        </span>
      )}
      <div className={styles.artBox}>
        {hasArt && (
          <img
            className={styles.cardArt}
            src={artCropUrl(card.imageUrl)}
            alt={displayName}
            decoding="async"
            onError={hideBrokenCardImage}
          />
        )}
        <span className={styles.artLabel}>{artLabel}</span>
      </div>
      {showCompactText && !card.faceDown && card.typeLine && (
        <span className={styles.typeLine}>{card.typeLine}</span>
      )}
      {showFullText && !card.faceDown && card.typeLine && (
        <span className={styles.rulesText}>{card.typeLine}</span>
      )}
      {!card.faceDown && card.powerToughness && (
        <span className={styles.pt} data-pt={card.powerToughness}>
          {card.powerToughness}
        </span>
      )}
    </div>
  )

  const badges = (
    <>
      {card.phasedOut && isTile && <span className={styles.phasedOutBadge}>Phased out</span>}
      {/* Unpainted, but kept in the DOM: assistive tech and specs address cards
          by these words. */}
      {actionChrome && variant === 'hand' && (
        <span className={styles.mutedBadges}>
          {card.playableLand && <span>Play land</span>}
          {card.playableSpell && <span>Cast spell</span>}
          {card.playableActivation && <span>Activate</span>}
        </span>
      )}
      {actionChrome && variant === 'board' && card.playableActivation && (
        <span className={styles.activateBadge}>
          <i className="ms ms-ability-activated" aria-hidden="true" />
          <span className={styles.mutedBadges}>Activate</span>
        </span>
      )}
    </>
  )

  const commonProps = {
    className: classes,
    'data-instance-id': card.instanceId,
    'data-card': displayName,
    'data-phased-out': card.phasedOut || undefined,
    'data-attached-to': card.attachedTo,
    'data-controller-seat': card.controllerSeatId,
    'data-pile-count': pileCount,
    'data-action-types': actionTypes?.join(' ') || undefined,
    'data-action-tuples':
      actions
        ?.flatMap((action) => [
          `${action.actionType}:${Number(action.hasAlternativeCost)}`,
          ...(action.abilityGrpId
            ? [
                `${action.actionType}:ability:${action.abilityGrpId}`,
                `${action.actionType}:${Number(action.hasAlternativeCost)}:${action.abilityGrpId}`,
              ]
            : []),
        ])
        .join(' ') || undefined,
    'data-tapped': card.tapped,
    'aria-label': card.phasedOut ? `${displayName}, Phased out` : (ariaLabel ?? displayName),
    'aria-disabled': card.phasedOut || undefined,
    'aria-pressed': selectable ? selected : undefined,
    onFocus: hoverIn,
    onBlur: hoverOut,
    // No `title`: the hover preview replaces it.
    onPointerDown: pointerDown,
    onMouseEnter: hoverIn,
    onMouseLeave: hoverOut,
  }

  const content = isTile ? (
    tileBody
  ) : variant === 'hand' || variant === 'preview' ? (
    <ComposedCardBody card={cardBodyFromView(card)} decorativeArt={variant === 'hand'} />
  ) : (
    body
  )

  // `aria-disabled`, not the attribute: a disabled button fires no pointer
  // events, so it could not be hovered for its preview.
  if (onClick) {
    return (
      <button
        {...commonProps}
        style={handStyle}
        onClick={() => {
          if (!disabled) {
            onClick()
          }
        }}
        aria-disabled={disabled || undefined}
      >
        {content} {badges}
      </button>
    )
  }

  return (
    <article {...commonProps} tabIndex={onHover ? 0 : undefined} style={handStyle}>
      {content} {badges}
    </article>
  )
}

export function cardIsPlayable(card: CardView, actionTypes?: number[]): boolean {
  return (
    !card.phasedOut &&
    (actionTypes == null
      ? card.playableLand || card.playableSpell || card.playableActivation
      : actionTypes.length > 0)
  )
}

function parseManaCost(cost: string): string[] {
  if (!cost) {
    return []
  }
  const braced = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? '').filter(Boolean)
  if (braced.length > 0) {
    return braced
  }
  const normalized = cost.replace(/o(?=[0-9WUBRGCX])/gi, '').replace(/[{}]/g, ' ')
  return normalized.split(/\s+/).flatMap((token) => token.match(/[0-9]+|X|[WUBRGC]/gi) ?? [])
}

function cardColor(card: CardView): string {
  const cost = card.manaCost.toUpperCase()
  for (const symbol of ['W', 'U', 'B', 'R', 'G']) {
    if (cost.includes(symbol)) {
      return MANA_COLORS[symbol]!
    }
  }
  const text = `${card.name} ${card.typeLine}`.toLowerCase()
  if (/mountain|goblin|dragon|bolt|fire|red/.test(text)) {
    return MANA_COLORS['R']!
  }
  if (/swamp|zombie|demon|black/.test(text)) {
    return MANA_COLORS['B']!
  }
  if (/forest|elf|green/.test(text)) {
    return MANA_COLORS['G']!
  }
  if (/island|blue/.test(text)) {
    return MANA_COLORS['U']!
  }
  if (/plains|white/.test(text)) {
    return MANA_COLORS['W']!
  }
  return MANA_COLORS['C']!
}

function artKind(card: CardView): string {
  if (/\bland\b/i.test(card.typeLine)) {
    return 'LAND'
  }
  if (/\bcreature\b/i.test(card.typeLine)) {
    return 'CREATURE'
  }
  if (/\binstant\b/i.test(card.typeLine)) {
    return 'INSTANT'
  }
  if (/\bsorcery\b/i.test(card.typeLine)) {
    return 'SORCERY'
  }
  return 'SPELL'
}
