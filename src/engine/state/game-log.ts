import {
  ACTION_CAST,
  ACTION_CAST_LEFT,
  ACTION_CAST_RIGHT,
  ACTION_CAST_ADVENTURE,
  ACTION_CAST_MDFC,
  ACTION_CAST_PROTOTYPE,
  ACTION_CAST_LEFT_ROOM,
  ACTION_CAST_RIGHT_ROOM,
  ACTION_CAST_OMEN,
  ACTION_ACTIVATE,
  ACTION_PLAY,
  ACTION_PLAY_MDFC,
  annotationHasType,
  asArray,
  asNumber,
  isRecord,
  ZONE_HAND,
  ZONE_LIBRARY,
  type CardMeta,
  type ProtoObject,
} from './gre-state'
import type { GameState } from './gre-accumulator'
import { EMPTY_ID_CHAIN, resolveId, type IdChain } from './gre-id-chain'

export const GAME_LOG_LIMIT = 100

export type GameLogEntry = { id: number; turn: number; text: string }
type CardReference = { grpId: number }
type LogPart = string | CardReference
type StoredEntry = { id: number; stateId: number; turn: number; parts: LogPart[] }

const PUBLIC_VISIBILITY = 1
const PRIVATE_VISIBILITY = 2
const USER_ACTION = 73
const ZONE_TRANSFER = 1
const DAMAGE_DEALT = 3
const CAST_ACTIONS = new Set([
  ACTION_CAST,
  ACTION_CAST_LEFT,
  ACTION_CAST_RIGHT,
  ACTION_CAST_ADVENTURE,
  ACTION_CAST_MDFC,
  ACTION_CAST_PROTOTYPE,
  ACTION_CAST_LEFT_ROOM,
  ACTION_CAST_RIGHT_ROOM,
  ACTION_CAST_OMEN,
])
const PLAY_ACTIONS = new Set([ACTION_PLAY, ACTION_PLAY_MDFC])
const ABILITY_OBJECT = 3

const TRANSFER_TEXT: Readonly<Record<string, string>> = {
  Resolve: ' resolves.',
  Destroy: ' is destroyed.',
  Sacrifice: ' is sacrificed.',
  Countered: ' is countered.',
  Discard: ' is discarded.',
  Mill: ' is milled.',
  Exile: ' is exiled.',
  Foretell: ' is foretold.',
  Warp: ' is exiled.',
  SBA_Damage: ' dies after damage.',
  SBA_Deathtouch: ' dies after damage.',
  SBA_LegendRule: ' goes to the graveyard under the legend rule.',
  SBA_UnattachedAura: ' goes to the graveyard.',
}

function detail(annotation: ProtoObject, key: string): unknown {
  const row = asArray(annotation['details']).find((raw) => isRecord(raw) && raw['key'] === key)
  return isRecord(row)
    ? (asArray(row['valueString'])[0] ??
        asArray(row['valueInt32'])[0] ??
        asArray(row['valueUint32'])[0])
    : undefined
}

function playerLabel(seat: number, viewer: number): string {
  return seat === viewer ? 'You' : 'Opponent'
}

/** Resolve identity only from an object the viewer may inspect in this frame. */
function visibleCard(state: GameState, id: number): CardReference | null {
  const object = state.tables.objects.get(id)
  if (!object || object.isFacedown === true) {
    return null
  }
  const visible =
    object.visibility === PUBLIC_VISIBILITY ||
    (object.visibility === PRIVATE_VISIBILITY && object.viewers?.includes(state.viewerSeatId))
  if (!visible) {
    return null
  }
  if (object.type === ABILITY_OBJECT) {
    const parent = state.tables.objects.get(object.parentId ?? 0)
    return parent?.type === ABILITY_OBJECT ? null : visibleCard(state, object.parentId ?? 0)
  }
  return (object.grpId ?? 0) > 0 ? { grpId: object.grpId! } : null
}

/** Match-local history folded at the same authoritative boundary as the board. */
export class GameLog {
  private entries: StoredEntry[] = []
  private latestStateId = 0
  private nextId = 0

  reset(): void {
    this.entries = []
    this.latestStateId = 0
    this.nextId = 0
  }

  append(
    previous: GameState,
    state: GameState,
    full: boolean,
    ids: IdChain = EMPTY_ID_CHAIN,
  ): void {
    // A recovered boundary may roll back later decisions. Discard their events.
    if (full) {
      this.entries = this.entries.filter((entry) => entry.stateId <= state.gameStateId)
      this.latestStateId = state.gameStateId
      return
    }
    if (state.gameStateId <= this.latestStateId) {
      return
    }
    this.latestStateId = state.gameStateId
    const add = (parts: LogPart[]) => {
      this.entries.push({
        id: this.nextId++,
        stateId: state.gameStateId,
        turn: state.turn.turnNumber,
        parts,
      })
    }
    const seen = new Set<string>()
    const card = (id: number) => visibleCard(state, resolveId(ids, id))
    for (const annotation of state.annotations) {
      const key = JSON.stringify(annotation)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      const affected = asArray(annotation['affectedIds']).map(asNumber)
      const actor = asNumber(annotation['affectorId'])
      if (annotationHasType(annotation, USER_ACTION, 'UserActionTaken')) {
        const action = asNumber(detail(annotation, 'actionType'))
        const self = actor === state.viewerSeatId
        const verb = CAST_ACTIONS.has(action)
          ? self
            ? ' cast '
            : ' casts '
          : PLAY_ACTIONS.has(action)
            ? self
              ? ' play '
              : ' plays '
            : action === ACTION_ACTIVATE
              ? self
                ? ' activate an ability of '
                : ' activates an ability of '
              : null
        if (verb) {
          add([
            playerLabel(actor, state.viewerSeatId),
            verb,
            card(affected[0] ?? 0) ?? 'a card',
            '.',
          ])
        }
      } else if (annotationHasType(annotation, DAMAGE_DEALT, 'DamageDealt')) {
        const amount = asNumber(detail(annotation, 'damage'))
        const source = card(actor) ?? visibleCard(previous, actor)
        if (amount > 0) {
          for (const id of affected) {
            const target = state.tables.players.has(id)
              ? id === state.viewerSeatId
                ? 'you'
                : 'opponent'
              : (card(id) ?? 'a card')
            add(
              source
                ? [source, ` deals ${amount} damage to `, target, '.']
                : [`${amount} damage to `, target, '.'],
            )
          }
        }
      } else if (annotationHasType(annotation, ZONE_TRANSFER, 'ZoneTransfer')) {
        const category = detail(annotation, 'category')
        const destination = state.tables.zones.get(asNumber(detail(annotation, 'zone_dest')))
        const suffix =
          category === 'Bounce' || category === 'Return'
            ? destination?.type === ZONE_HAND
              ? ' returns to hand.'
              : destination?.type === ZONE_LIBRARY
                ? ' returns to the library.'
                : ' returns.'
            : typeof category === 'string'
              ? TRANSFER_TEXT[category]
              : undefined
        if (suffix) {
          for (const id of affected) {
            add([card(id) ?? 'A card', suffix])
          }
        }
      }
    }
    for (const [seat, player] of state.tables.players) {
      const before = previous.tables.players.get(seat)?.lifeTotal
      const after = player.lifeTotal
      if (before != null && after != null && before !== after) {
        const change = after - before
        const subject = playerLabel(seat, state.viewerSeatId)
        const verb =
          change > 0
            ? seat === state.viewerSeatId
              ? 'gain'
              : 'gains'
            : seat === state.viewerSeatId
              ? 'lose'
              : 'loses'
        add([`${subject} ${verb} ${Math.abs(change)} life (${before} → ${after}).`])
      }
    }
    this.entries = this.entries.slice(-GAME_LOG_LIMIT)
  }

  snapshot(meta: ReadonlyMap<number, CardMeta>): GameLogEntry[] {
    return this.entries.map(({ id, turn, parts }) => ({
      id,
      turn,
      text: parts
        .map((part) => (typeof part === 'string' ? part : (meta.get(part.grpId)?.name ?? 'a card')))
        .join(''),
    }))
  }
}
