import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { CardFaceView, CardView } from '@engine/state/gre-state'
import { parseManaSymbols } from '@shared/cards/mana'
import { cx } from '@shared/react/cx'
import { artCropUrl } from '@shared/cards/scryfall'
import 'keyrune/css/keyrune.css'
import '@shared/cards/card-typography.css'
import '@shared/cards/card-sizes.css'
import styles from './ComposedCardBody.module.css'

const RULES_FONT_SCALES = [1, 13 / 14, 12 / 14, 11 / 14]
const MIN_RULES_FONT_SIZE = 4
const MIN_CARD_NAME_SIZE = 6
const CARD_NAME_FIT_STEP = 0.25

type CardAffinity = 'white' | 'blue' | 'black' | 'red' | 'green' | 'multicolor' | 'colorless'
type CardMaterial = 'ordinary' | 'artifact' | 'land'
type RulesSection = { label: string; text: string; cost?: string }

interface CardBodyBase {
  name: string
  manaCost: string
  typeLine: string
  imageUrl: string
  artist?: string
  setCode?: string
  rarity?: string
  frame: CardAffinity
  material: CardMaterial
  stateLabels: string[]
}

export interface OrdinaryCardBody extends CardBodyBase {
  layout: 'ordinary'
  rulesText: string
  powerToughness?: string
}

export interface SagaCardBody extends CardBodyBase {
  layout: 'saga'
  reminderText: string
  chapters: RulesSection[]
}

export interface PlaneswalkerCardBody extends CardBodyBase {
  layout: 'planeswalker'
  abilities: RulesSection[]
  loyalty?: string
}

export interface BattleCardBody extends CardBodyBase {
  layout: 'battle'
  rulesText: string
  defense?: string
  reverseFace?: CardFaceView
}

export interface SplitCardBody extends CardBodyBase {
  layout: 'split'
  mode: string
  faces: CardFaceView[]
}

export interface TwoFacedCardBody extends CardBodyBase {
  layout: 'two-faced'
  rulesText: string
  powerToughness?: string
  reverseFace?: CardFaceView
}

export interface RoomCardBody extends CardBodyBase {
  layout: 'room'
  doors: Array<CardFaceView & { unlocked: boolean }>
}

export interface ProgressionCardBody extends CardBodyBase {
  layout: 'progression'
  introText: string
  sections: RulesSection[]
  activeLabel?: string
  powerToughness?: string
}

export interface SupplementalCardBody extends CardBodyBase {
  layout: 'supplemental'
  rulesText: string
}

export interface FaceDownCardBody extends CardBodyBase {
  layout: 'face-down'
}

export type ComposedCardBodyModel =
  | OrdinaryCardBody
  | SagaCardBody
  | PlaneswalkerCardBody
  | BattleCardBody
  | SplitCardBody
  | TwoFacedCardBody
  | RoomCardBody
  | ProgressionCardBody
  | SupplementalCardBody
  | FaceDownCardBody

export function ComposedCardBody({
  card,
  decorativeArt = false,
}: {
  card: ComposedCardBodyModel
  decorativeArt?: boolean
}) {
  const mana = parseManaSymbols(card.manaCost)
  const faceDown = card.layout === 'face-down'

  return (
    <div
      className={cx(
        styles.card,
        styles[card.frame],
        card.material !== 'ordinary' && styles[card.material],
        faceDown && styles.back,
      )}
      data-layout={card.layout}
      aria-label={card.name}
    >
      <div className={styles.innerFrame}>
        <div className={styles.titleBar}>
          <CardName name={card.name} manaCost={card.manaCost} />
          <span className={styles.mana} aria-label={card.manaCost}>
            {mana.map((symbol, index) => (
              <i key={`${symbol.label}-${index}`} className={symbol.classes} aria-hidden="true" />
            ))}
          </span>
        </div>

        <CardBody card={card} decorativeArt={decorativeArt} />

        {card.stateLabels.length > 0 && (
          <div className={styles.stateRail} aria-label="Current card state">
            {card.stateLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        )}
        <div className={styles.footer}>
          <span>Forge Web</span>
          {card.artist && <span>Illus. {card.artist}</span>}
        </div>
      </div>
    </div>
  )
}

function CardName({ name, manaCost }: { name: string; manaCost: string }) {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const title = ref.current
    const bar = title?.parentElement
    if (!title || !bar) {
      return
    }
    const fit = () => {
      title.style.removeProperty('font-size')
      const range = document.createRange()
      range.selectNodeContents(title)
      const available = title.getBoundingClientRect().width - 1
      const textWidth = range.getBoundingClientRect().width
      let size = parseFloat(getComputedStyle(title).fontSize)
      if (textWidth > available && available > 0) {
        size = Math.max(MIN_CARD_NAME_SIZE, (size * available) / textWidth)
        title.style.fontSize = `${size}px`
        while (range.getBoundingClientRect().width > available && size > MIN_CARD_NAME_SIZE) {
          size = Math.max(MIN_CARD_NAME_SIZE, size - CARD_NAME_FIT_STEP)
          title.style.fontSize = `${size}px`
        }
      }
    }
    let active = true
    void document.fonts?.ready.then(() => {
      if (active) {
        fit()
      }
    })
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    observer?.observe(bar)
    return () => {
      active = false
      observer?.disconnect()
    }
  }, [name, manaCost])

  return (
    <span ref={ref} className={styles.cardName}>
      {name}
    </span>
  )
}

function CardBody({
  card,
  decorativeArt,
}: {
  card: ComposedCardBodyModel
  decorativeArt: boolean
}) {
  switch (card.layout) {
    case 'ordinary':
      return <OrdinaryBody card={card} decorativeArt={decorativeArt} />
    case 'saga':
      return <SagaBody card={card} decorativeArt={decorativeArt} />
    case 'planeswalker':
      return <PlaneswalkerBody card={card} decorativeArt={decorativeArt} />
    case 'battle':
      return <BattleBody card={card} decorativeArt={decorativeArt} />
    case 'split':
      return <SplitBody card={card} decorativeArt={decorativeArt} />
    case 'two-faced':
      return <TwoFacedBody card={card} decorativeArt={decorativeArt} />
    case 'room':
      return <RoomBody card={card} decorativeArt={decorativeArt} />
    case 'progression':
      return <ProgressionBody card={card} decorativeArt={decorativeArt} />
    case 'supplemental':
      return <SupplementalBody card={card} decorativeArt={decorativeArt} />
    case 'face-down':
      return <div className={styles.cardBackMark} aria-hidden="true" />
  }
}

function OrdinaryBody({ card, decorativeArt }: BodyProps<OrdinaryCardBody>) {
  return (
    <>
      <CardArt card={card} decorative={decorativeArt} />
      <TypeLine card={card} />
      <RulesBox text={card.rulesText}>{renderRulesText(card.rulesText)}</RulesBox>
      {card.powerToughness && <ValueBadge>{card.powerToughness}</ValueBadge>}
    </>
  )
}

function SagaBody({ card, decorativeArt }: BodyProps<SagaCardBody>) {
  return (
    <>
      <div className={styles.sagaBody}>
        <div className={styles.chapterRail}>
          <p className={styles.reminder}>{card.reminderText}</p>
          <SectionList sections={card.chapters} marks="chapter" />
        </div>
        <CardArt card={card} decorative={decorativeArt} />
      </div>
      <TypeLine card={card} />
    </>
  )
}

function PlaneswalkerBody({ card, decorativeArt }: BodyProps<PlaneswalkerCardBody>) {
  return (
    <>
      <CardArt card={card} compact decorative={decorativeArt} />
      <TypeLine card={card} />
      <div className={styles.abilityBox}>
        <SectionList sections={card.abilities} marks="loyalty" />
      </div>
      {card.loyalty && <ValueBadge label="Loyalty">{card.loyalty}</ValueBadge>}
    </>
  )
}

function BattleBody({ card, decorativeArt }: BodyProps<BattleCardBody>) {
  return (
    <>
      <CardArt card={card} decorative={decorativeArt} />
      <TypeLine card={card} />
      <RulesBox text={card.rulesText}>
        {renderRulesText(card.rulesText)}
        {card.reverseFace && <FaceCue face={card.reverseFace} label="Defeated face" />}
      </RulesBox>
      {card.defense && <ValueBadge label="Defense">{card.defense}</ValueBadge>}
    </>
  )
}

function SplitBody({ card, decorativeArt }: BodyProps<SplitCardBody>) {
  return (
    <>
      <div className={styles.splitBody} data-split-mode={card.mode.toLowerCase()}>
        {card.faces.map((face) => (
          <FacePanel key={face.grpId} face={face} decorative={decorativeArt} />
        ))}
      </div>
      <TypeLine card={card} />
    </>
  )
}

function TwoFacedBody({ card, decorativeArt }: BodyProps<TwoFacedCardBody>) {
  return (
    <>
      <CardArt card={card} decorative={decorativeArt} />
      <TypeLine card={card} />
      <RulesBox text={card.rulesText}>
        {renderRulesText(card.rulesText)}
        {card.reverseFace && <FaceCue face={card.reverseFace} label="Other face" />}
      </RulesBox>
      {card.powerToughness && <ValueBadge>{card.powerToughness}</ValueBadge>}
    </>
  )
}

function RoomBody({ card, decorativeArt }: BodyProps<RoomCardBody>) {
  return (
    <>
      <div className={styles.roomBody}>
        {card.doors.map((door) => (
          <FacePanel
            key={door.grpId}
            face={door}
            state={door.unlocked ? 'Unlocked' : 'Locked'}
            decorative={decorativeArt}
          />
        ))}
      </div>
      <TypeLine card={card} />
    </>
  )
}

function ProgressionBody({ card, decorativeArt }: BodyProps<ProgressionCardBody>) {
  return (
    <>
      <CardArt card={card} compact decorative={decorativeArt} />
      <TypeLine card={card} />
      <div className={styles.progressionBox}>
        {card.introText && (
          <p className={styles.progressionIntro}>{renderRulesText(card.introText)}</p>
        )}
        <SectionList sections={card.sections} activeLabel={card.activeLabel} />
      </div>
      {card.powerToughness && <ValueBadge>{card.powerToughness}</ValueBadge>}
    </>
  )
}

function SupplementalBody({ card, decorativeArt }: BodyProps<SupplementalCardBody>) {
  return (
    <>
      <CardArt card={card} compact decorative={decorativeArt} />
      <TypeLine card={card} />
      <RulesBox text={card.rulesText}>{renderRulesText(card.rulesText)}</RulesBox>
    </>
  )
}

type BodyProps<T extends CardBodyBase> = { card: T; decorativeArt: boolean }

function CardArt({
  card,
  compact = false,
  decorative,
}: {
  card: CardBodyBase
  compact?: boolean
  decorative: boolean
}) {
  return (
    <div className={cx(styles.artBox, compact && styles.compactArt)}>
      <span className={styles.noArt}>{cardKind(card.typeLine)}</span>
      {card.imageUrl && (
        <img
          src={artCropUrl(card.imageUrl)}
          alt={decorative ? '' : card.name}
          decoding="async"
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
      )}
    </div>
  )
}

function FacePanel({
  face,
  state,
  decorative,
}: {
  face: CardFaceView
  state?: string
  decorative: boolean
}) {
  const mana = parseManaSymbols(face.manaCost)
  return (
    <section className={styles.facePanel}>
      <header>
        <strong>{face.name}</strong>
        <span className={styles.faceMana} aria-label={face.manaCost}>
          {mana.map((symbol, index) => (
            <i key={`${symbol.label}-${index}`} className={symbol.classes} aria-hidden="true" />
          ))}
        </span>
      </header>
      <div className={styles.faceArt}>
        {face.imageUrl && <img src={artCropUrl(face.imageUrl)} alt={decorative ? '' : face.name} />}
      </div>
      <small>{face.typeLine}</small>
      <p>{renderRulesText(face.rulesText)}</p>
      {state && <b data-state={state.toLowerCase()}>{state}</b>}
      {(face.powerToughness || face.loyalty || face.defense) && (
        <em>{face.powerToughness || face.loyalty || face.defense}</em>
      )}
    </section>
  )
}

function FaceCue({ face, label }: { face: CardFaceView; label: string }) {
  return (
    <aside className={styles.faceCue}>
      <span>{label}</span>
      <strong>{face.name}</strong>
      <small>{face.typeLine}</small>
    </aside>
  )
}

const RARITY_CLASSES: Record<string, string> = {
  basicland: 'common',
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  mythic: 'mythic',
  mythicrare: 'mythic',
  special: 'timeshifted',
}

function TypeLine({ card }: { card: CardBodyBase }) {
  const code = card.setCode?.trim().toLowerCase()
  const rarityKey = card.rarity?.toLowerCase().replaceAll(' ', '') ?? ''
  const rarity = RARITY_CLASSES[rarityKey]
  const rarityLabel =
    rarityKey === 'basicland' ? 'basic land' : rarity === 'mythic' ? 'mythic rare' : rarityKey
  return (
    <div className={styles.typeLine}>
      <span>{card.typeLine}</span>
      {code && /^[a-z0-9]{2,8}$/.test(code) && (
        <i
          className={cx(
            styles.setSymbol,
            'ss',
            `ss-${code}`,
            `ss-${rarity ?? 'common'}`,
            rarity && rarity !== 'common' && 'ss-grad',
          )}
          role="img"
          aria-label={`Set ${code.toUpperCase()}${rarity ? `, ${rarityLabel}` : ''}`}
        />
      )}
    </div>
  )
}

function RulesBox({ children, text }: { children: ReactNode; text: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const box = ref.current
    if (!box) {
      return
    }
    const fit = () => {
      box.style.removeProperty('font-size')
      const baseSize = parseFloat(getComputedStyle(box).fontSize)
      for (const scale of RULES_FONT_SCALES) {
        box.dataset['density'] = scale < 1 ? 'compact' : 'comfortable'
        box.style.fontSize = `${Math.max(MIN_RULES_FONT_SIZE, baseSize * scale)}px`
        if (box.scrollHeight <= box.clientHeight + 1) {
          return
        }
      }
    }
    let active = true
    void document.fonts?.ready.then(() => {
      if (active) {
        fit()
      }
    })
    fit()
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        active = false
      }
    }
    const observer = new ResizeObserver(fit)
    observer.observe(box)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [text])

  return (
    <div ref={ref} className={styles.rulesBox}>
      <div className={styles.rulesText}>{children}</div>
    </div>
  )
}

function ValueBadge({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <strong className={styles.valueBadge} aria-label={label}>
      {children}
    </strong>
  )
}

function SectionList({
  sections,
  marks,
  activeLabel,
}: {
  sections: RulesSection[]
  marks?: 'chapter' | 'loyalty'
  activeLabel?: string
}) {
  return (
    <ol className={styles.sectionList}>
      {sections.map((section) => (
        <li
          key={`${section.label}-${section.text}`}
          data-active={section.label === activeLabel || undefined}
        >
          <span className={cx(styles.sectionMark, marks === 'chapter' && styles.chapterMark)}>
            {section.label}
          </span>
          <span>
            {section.cost && <b>{renderRulesText(section.cost)}</b>}
            {renderRulesText(section.text)}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function cardBodyFromView(card: CardView): ComposedCardBodyModel {
  if (card.faceDown) {
    return {
      layout: 'face-down',
      name: 'Face-down card',
      manaCost: '',
      typeLine: '',
      imageUrl: '',
      frame: 'colorless',
      material: 'ordinary',
      stateLabels: [],
    }
  }

  const rulesText = withoutMechanicReminders(
    normalizeRulesText(card.rulesText ?? ''),
    card.mechanicHelp ?? [],
  )
  const base: CardBodyBase = {
    name: card.name,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    imageUrl: card.imageUrl,
    setCode: card.setCode,
    rarity: card.rarity,
    frame: cardAffinity(card),
    material: cardMaterial(card.typeLine),
    stateLabels: cardStateLabels(card),
  }
  const saga = /(?:^|\s|—)Saga(?:$|\s)/i.test(card.typeLine) ? parseSagaRulesText(rulesText) : null
  const progression = isProgressionCard(card) ? parseProgressionRulesText(rulesText) : null
  const reverseFace = card.linkedFaces?.find((face) => face.name !== card.name)

  if (/\bRoom\b/i.test(card.typeLine) && card.linkedFaces?.length) {
    return {
      ...base,
      layout: 'room',
      doors: card.linkedFaces.map((face, index) => ({
        ...face,
        unlocked: card.roomDoors?.[index]?.unlocked === true,
      })),
    }
  }
  if (saga?.chapters.length) {
    return { ...base, layout: 'saga', ...saga }
  }
  if (/\bPlaneswalker\b/i.test(card.typeLine)) {
    return {
      ...base,
      layout: 'planeswalker',
      abilities: parsePlaneswalkerRulesText(rulesText),
      loyalty: currentValue(card, 'loyalty') ?? card.loyalty,
    }
  }
  if (/\bBattle\b/i.test(card.typeLine)) {
    return {
      ...base,
      layout: 'battle',
      rulesText,
      defense: currentValue(card, 'defense') ?? card.defense,
      reverseFace,
    }
  }
  if (/^Split$/i.test(card.faceLayout ?? '') && card.linkedFaces?.length) {
    return { ...base, layout: 'split', mode: card.faceLayout!, faces: card.linkedFaces }
  }
  if (/^(Adventure|Omen)$/i.test(card.faceLayout ?? '') && card.linkedFaces?.length) {
    return {
      ...base,
      layout: 'split',
      mode: card.faceLayout!,
      faces: [
        cardFaceFromView(card),
        ...card.linkedFaces.filter((face) => face.grpId !== card.grpId),
      ],
    }
  }
  if (/^(Transform|Meld|Modal|Flip|Prepare|Specialize)$/i.test(card.faceLayout ?? '')) {
    return {
      ...base,
      layout: 'two-faced',
      rulesText,
      powerToughness: card.powerToughness || undefined,
      reverseFace,
    }
  }
  if (progression?.sections.length) {
    return {
      ...base,
      layout: 'progression',
      ...progression,
      activeLabel: progressionLabel(card),
      powerToughness: card.powerToughness || undefined,
    }
  }
  if (/\b(Dungeon|Plane|Phenomenon|Scheme|Vanguard|Conspiracy|Emblem)\b/i.test(card.typeLine)) {
    return { ...base, layout: 'supplemental', rulesText }
  }
  return {
    ...base,
    layout: 'ordinary',
    rulesText,
    powerToughness: card.powerToughness || undefined,
  }
}

function withoutMechanicReminders(
  text: string,
  help: NonNullable<CardView['mechanicHelp']>,
): string {
  for (const item of help) {
    const title = item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const keywordReminder = new RegExp(
      `(^|\\n|,\\s*)(${title}[ \\t{}0-9WUBRGCXS/—-]*)[ \\t]*\\([^()]*\\)`,
      'gi',
    )
    text = text.replace(
      keywordReminder,
      (_, separator: string, keyword: string) => separator + keyword.trimEnd(),
    )
  }
  return text
}

function cardFaceFromView(card: CardView): CardFaceView {
  return {
    grpId: card.grpId,
    name: card.name,
    typeLine: card.typeLine,
    manaCost: card.manaCost,
    powerToughness: card.powerToughness,
    rulesText: card.rulesText ?? '',
    imageUrl: card.imageUrl,
    loyalty: card.loyalty,
    defense: card.defense,
  }
}

export function parseSagaRulesText(
  rulesText: string,
): Pick<SagaCardBody, 'reminderText' | 'chapters'> {
  const chapters: SagaCardBody['chapters'] = []
  const reminder: string[] = []
  const chapterLine = /^((?:I|II|III|IV|V)(?:\s*,\s*(?:I|II|III|IV|V))*)\s+[—-]\s+(.+)$/

  for (const line of normalizeRulesText(rulesText).split('\n')) {
    const match = line.trim().match(chapterLine)
    if (match) {
      chapters.push({ label: match[1]!, text: match[2]! })
    } else if (line.trim()) {
      reminder.push(line.trim())
    }
  }
  return { reminderText: reminder.join(' '), chapters }
}

export function parsePlaneswalkerRulesText(rulesText: string): RulesSection[] {
  return normalizeRulesText(rulesText)
    .split('\n')
    .flatMap((line) => {
      const match = line.trim().match(/^\[?([+−-]?\d+|0)\]?:\s*(.+)$/)
      return match ? [{ label: match[1]!.replace('-', '−'), text: match[2]! }] : []
    })
}

export function parseProgressionRulesText(
  rulesText: string,
): Pick<ProgressionCardBody, 'introText' | 'sections'> {
  const intro: string[] = []
  const sections: RulesSection[] = []
  let current: RulesSection | undefined

  for (const raw of normalizeRulesText(rulesText).split('\n')) {
    const line = raw.trim()
    const caseMarker = line.match(/^(To solve|Solved)\s+[—-]\s*(.*)$/i)
    const classMarker = line.match(/^(.*?):\s*Level\s+(\d+)$/i)
    const levelMarker = line.match(/^LEVEL\s+(?!up\b)(.+)$/i)
    if (caseMarker) {
      current = { label: titleCase(caseMarker[1]!), text: caseMarker[2]! }
      sections.push(current)
    } else if (classMarker) {
      current = { label: `Level ${classMarker[2]}`, cost: classMarker[1]!, text: '' }
      sections.push(current)
    } else if (levelMarker) {
      current = { label: `Level ${levelMarker[1]}`, text: '' }
      sections.push(current)
    } else if (line) {
      if (current) {
        current.text = [current.text, line].filter(Boolean).join('\n')
      } else {
        intro.push(line)
      }
    }
  }
  return { introText: intro.join('\n'), sections }
}

function cardAffinity(card: Pick<CardView, 'manaCost' | 'typeLine'>): CardAffinity {
  const colors = new Set(card.manaCost.toUpperCase().match(/[WUBRG]/g) ?? [])
  if (/\bland\b/i.test(card.typeLine)) {
    const landColors: Record<string, string> = {
      Plains: 'W',
      Island: 'U',
      Swamp: 'B',
      Mountain: 'R',
      Forest: 'G',
    }
    for (const [subtype, color] of Object.entries(landColors)) {
      if (new RegExp(`\\b${subtype}\\b`, 'i').test(card.typeLine)) {
        colors.add(color)
      }
    }
  }
  if (colors.size > 1) {
    return 'multicolor'
  }
  const [color] = colors
  return (
    ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' } as const)[
      color as 'W' | 'U' | 'B' | 'R' | 'G'
    ] ?? 'colorless'
  )
}

function cardMaterial(typeLine: string): CardMaterial {
  if (/\bland\b/i.test(typeLine)) {
    return 'land'
  }
  if (/\bartifact\b/i.test(typeLine)) {
    return 'artifact'
  }
  return 'ordinary'
}

function cardStateLabels(card: CardView): string[] {
  return [
    card.phasedOut ? 'Phased out' : '',
    card.solved ? 'Solved' : '',
    card.classLevel ? `Level ${card.classLevel}` : '',
    ...(card.grantedKeywords ?? []).map((keyword) => `Gained ${keyword}`),
  ].filter(Boolean)
}

function currentValue(card: CardView, name: string): string | undefined {
  const counter = card.counters?.find((candidate) => candidate.name.toLowerCase() === name)
  return counter?.count ? String(counter.count) : undefined
}

function progressionLabel(card: CardView): string | undefined {
  if (card.solved) {
    return 'Solved'
  }
  if (card.classLevel) {
    return `Level ${card.classLevel}`
  }
  const level = card.counters?.find((counter) => /level/i.test(counter.name))?.count
  return level ? `Level ${level}` : undefined
}

function isProgressionCard(card: CardView): boolean {
  return /\b(Class|Case)\b/i.test(card.typeLine) || /(?:^|\n)LEVEL\s+\d/i.test(card.rulesText ?? '')
}

function normalizeRulesText(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim()
}

function cardKind(typeLine: string): string {
  return (
    [
      'Creature',
      'Land',
      'Instant',
      'Sorcery',
      'Artifact',
      'Enchantment',
      'Planeswalker',
      'Battle',
      'Dungeon',
      'Plane',
    ]
      .find((type) => new RegExp(`\\b${type}\\b`, 'i').test(typeLine))
      ?.toUpperCase() ?? 'CARD'
  )
}

function renderRulesText(text: string): ReactNode[] {
  return text.split(/(\{[^}]+\})/g).map((part, index) => {
    const symbol = parseManaSymbols(part)[0]
    return symbol ? (
      <i key={index} className={cx(symbol.classes, styles.inlineMana)} aria-label={symbol.label} />
    ) : (
      part
    )
  })
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}
