/**
 * Semantic GRE frame vocabulary for engine tests.
 *
 * A test driving `GreStore` through a `GreFrameSink` names an event — a full
 * state, a diff, an action offer — but repeats the wire envelope each time.
 * These constructors carry only the payload fields the caller passes, so the
 * fixture keeps the exact shape the test intends. Type values are the numeric
 * ones `gre-proto.ts` decodes, not protobuf enum names.
 */
import {
  GAME_STATE_TYPE_FULL,
  type Action,
  type GameObject,
  type Zone,
} from '@engine/state/gre-state'

const GRE_MESSAGE_GAME_STATE = 1
const GRE_MESSAGE_ACTIONS_AVAILABLE = 2
/** `GameStateType.Diff`, the non-Full tier that merges onto the fold. */
const GAME_STATE_TYPE_DIFF = 2

export type GameStateFrameFields = {
  zones?: Zone[]
  gameObjects?: GameObject[]
  diffDeletedInstanceIds?: number[]
  annotations?: unknown[]
  persistentAnnotations?: unknown[]
  update?: number
}

export type GreGameStateFrame<F extends GameStateFrameFields = GameStateFrameFields> = {
  type: number
  gameStateId: number
  gameStateMessage: { type: number; gameStateId: number } & F
}

function gameStateFrame<F extends GameStateFrameFields>(
  gameStateId: number,
  gameStateType: number,
  fields: F,
): GreGameStateFrame<F> {
  return {
    type: GRE_MESSAGE_GAME_STATE,
    gameStateId,
    gameStateMessage: { type: gameStateType, gameStateId, ...fields },
  }
}

/** A full state replaces the accumulated tables instead of merging onto them. */
export function fullGameState<F extends GameStateFrameFields>(
  gameStateId: number,
  fields: F,
): GreGameStateFrame<F> {
  return gameStateFrame(gameStateId, GAME_STATE_TYPE_FULL, fields)
}

/** A diff state merges onto the accumulated tables. */
export function diffGameState<F extends GameStateFrameFields>(
  gameStateId: number,
  fields: F,
): GreGameStateFrame<F> {
  return gameStateFrame(gameStateId, GAME_STATE_TYPE_DIFF, fields)
}

export function availableActions(gameStateId: number, msgId: number, actions: Action[]) {
  return {
    type: GRE_MESSAGE_ACTIONS_AVAILABLE,
    gameStateId,
    msgId,
    actionsAvailableReq: { actions },
  }
}
