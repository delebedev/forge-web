import type { BoardSnapshot } from '@engine/runtime/snapshot'
import type { BoardArrow } from '@engine/state/arrow-view'
import type { CardView, LegalAction, MechanicHelp, PlayerView } from '@engine/state/gre-state'

const VIEWER_SEAT = 1
const OPPONENT_SEAT = 2

export type CardOptions = {
  id?: number
  grpId?: number
  pt?: string
  mana?: string
  type?: string
  rules?: string
  tapped?: boolean
  attacking?: boolean
  art?: string
  playable?: boolean
  activatable?: boolean
  keywords?: string[]
  mechanicHelp?: MechanicHelp[]
  owner?: 'self' | 'opponent'
}

export type BoardOptions = {
  hand?: CardView[]
  battlefield?: CardView[]
  opponentBattlefield?: CardView[]
  graveyard?: CardView[]
  exile?: CardView[]
  opponentGraveyard?: CardView[]
  opponentExile?: CardView[]
  stack?: CardView[]
  targetArrows?: BoardArrow[]
  legalActions?: LegalAction[]
  nonHandActionCards?: BoardSnapshot['nonHandActionCards']
  life?: [number, number]
  opponentHandCount?: number
  libraryCount?: number
  libraryTop?: CardView | null
  turnNumber?: number
  phase?: string
  step?: string
  activeSeat?: 'self' | 'opponent'
  priority?: 'self' | 'opponent'
}

const BASIC_LAND_ART: Record<string, string> = {
  Forest: 'https://cards.scryfall.io/normal/front/2/2/22463284-2478-4b1e-9a37-6dd2383266cf.jpg',
  Island: 'https://cards.scryfall.io/normal/front/5/a/5a74175b-2418-4226-8435-1490532e644f.jpg',
  Plains: 'https://cards.scryfall.io/normal/front/5/f/5f9b6584-ad27-410d-b6f1-c25c91630aea.jpg',
  Mountain: 'https://cards.scryfall.io/normal/front/4/2/426b0211-3d5d-4e53-bcf6-21823c655ffd.jpg',
}

const BASIC_LAND_MANA: Record<string, string> = {
  Forest: 'G',
  Island: 'U',
  Plains: 'W',
  Mountain: 'R',
  Swamp: 'B',
}

/** A deterministic identity scope for one authored fixture. */
export function createFixture(startId = 100) {
  let nextId = startId

  function card(name: string, options: CardOptions = {}): CardView {
    const isLand = /land/i.test(options.type ?? '')
    return {
      instanceId: options.id ?? ++nextId,
      grpId: options.grpId ?? 0,
      name,
      typeLine: options.type ?? (options.pt ? 'Creature' : 'Instant'),
      manaCost: options.mana ?? '',
      powerToughness: options.pt ?? '',
      rulesText: options.rules ?? '',
      tapped: options.tapped ?? false,
      attacking: options.attacking ?? false,
      playableLand: isLand && (options.playable ?? false),
      playableSpell: !isLand && (options.playable ?? false),
      playableActivation: options.activatable ?? false,
      imageUrl: options.art ?? '',
      controllerSeatId: options.owner === 'opponent' ? OPPONENT_SEAT : VIEWER_SEAT,
      keywords: options.keywords ?? [],
      mechanicHelp: options.mechanicHelp ?? [],
    }
  }

  function land(name: string, options: Omit<CardOptions, 'type' | 'pt'> = {}): CardView {
    const mana = BASIC_LAND_MANA[name]
    return card(name, {
      art: BASIC_LAND_ART[name],
      rules: mana ? `{T}: Add {${mana}}.` : '',
      ...options,
      type: `Basic Land — ${name}`,
    })
  }

  function action(
    label: string,
    options: {
      card?: CardView
      stop?: boolean
      actionType?: number
      zoneType?: number
      facetId?: number
      abilityGrpId?: number
      uniqueAbilityId?: number
      sourceId?: number
      alternativeGrpId?: number
      alternativeSourceZcid?: number
    } = {},
  ): LegalAction {
    const instanceId = options.card?.instanceId ?? ++nextId
    const alternativeGrpId = options.alternativeGrpId ?? 0
    return {
      actionType: options.actionType ?? 1,
      instanceId,
      grpId: options.card?.grpId ?? 0,
      facetId: options.facetId ?? 0,
      abilityGrpId: options.abilityGrpId ?? 0,
      uniqueAbilityId: options.uniqueAbilityId ?? 0,
      sourceId: options.sourceId ?? 0,
      alternativeGrpId,
      alternativeSourceZcid: options.alternativeSourceZcid ?? 0,
      zoneType: options.zoneType ?? 2,
      hasAlternativeCost: alternativeGrpId > 0,
      label,
      cardName: options.card?.name ?? label,
      shouldStop: options.stop ?? false,
    }
  }

  function board(options: BoardOptions = {}): BoardSnapshot {
    const hand = options.hand ?? []
    const battlefield = options.battlefield ?? []
    const opponentBattlefield = options.opponentBattlefield ?? []
    const graveyard = options.graveyard ?? []
    const exile = options.exile ?? []
    const opponentGraveyard = options.opponentGraveyard ?? []
    const opponentExile = options.opponentExile ?? []
    const [viewerLife, opponentLife] = options.life ?? [20, 20]
    const libraryCount = options.libraryCount ?? 33
    const activeSeatId = options.activeSeat === 'opponent' ? OPPONENT_SEAT : VIEWER_SEAT
    const prioritySeatId = options.priority
      ? options.priority === 'opponent'
        ? OPPONENT_SEAT
        : VIEWER_SEAT
      : activeSeatId
    const player = (
      seatId: number,
      life: number,
      isViewer: boolean,
      counts: { hand: number; library: number; graveyard: number; exile: number },
    ): PlayerView => ({
      seatId,
      teamId: seatId,
      lifeTotal: life,
      startingLifeTotal: 20,
      handCount: counts.hand,
      libraryCount: counts.library,
      graveyardCount: counts.graveyard,
      exileCount: counts.exile,
      isViewer,
      hasPriority: prioritySeatId === seatId,
      isActive: activeSeatId === seatId,
    })

    return {
      connected: true,
      status: 'connected',
      connectionClose: null,
      gameStateId: 1,
      phaseName: options.phase ?? 'Main1',
      stepName: options.step ?? '',
      turnNumber: options.turnNumber ?? 5,
      activeSeatId,
      prioritySeatId,
      decisionSeatId: prioritySeatId,
      gameOver: false,
      outcome: null,
      viewer: player(VIEWER_SEAT, viewerLife, true, {
        hand: hand.length,
        library: libraryCount,
        graveyard: graveyard.length,
        exile: exile.length,
      }),
      opponent: player(OPPONENT_SEAT, opponentLife, false, {
        hand: options.opponentHandCount ?? 3,
        library: libraryCount,
        graveyard: opponentGraveyard.length,
        exile: opponentExile.length,
      }),
      hand,
      battlefield,
      graveyard,
      exile,
      sideboard: [],
      libraryTop: options.libraryTop ?? null,
      opponentHand: [],
      opponentBattlefield,
      opponentGraveyard,
      opponentExile,
      stack: options.stack ?? [],
      stackCount: options.stack?.length ?? 0,
      targetArrows: options.targetArrows ?? [],
      legalActions: options.legalActions ?? [],
      nonHandActionCards: (options.legalActions ?? []).flatMap((legalAction) => {
        const override = options.nonHandActionCards?.find(
          (candidate) => candidate.action === legalAction,
        )
        if (override) {
          return [override]
        }
        const actionCard = [...graveyard, ...exile].find(
          (candidate) => candidate.instanceId === legalAction.instanceId,
        )
        return actionCard ? [{ action: legalAction, card: actionCard }] : []
      }),
      prompt: null,
      canPass: true,
      viewerSeatId: VIEWER_SEAT,
      opponentSeatId: OPPONENT_SEAT,
      currentMatchId: 'catalogue',
      currentGameType: 'constructed',
      messageTypeFeed: [],
      lastMessage: '',
      trafficStats: { sentBytes: 0, recvBytes: 0, sentMessages: 0, recvMessages: 0 },
      logs: [],
      errorCount: 0,
    }
  }

  return { action, board, card, land }
}
