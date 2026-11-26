import type { MessageTypeEntry, TrafficStats } from '@engine/state/gre-state'
import type { GreAnnotationEvidence } from '@engine/runtime/gre-store'
import type { GreStartConfig } from '@engine/runtime/start'

export type GreDebugPrompt = {
  interactionKey: number
  kind: string
  message: string
  canSubmit?: boolean
  waiting?: boolean
  options: unknown[]
}

export type GreDebugHorizon = {
  kind: string
  promptKey: string
  gameStateId: number
  respId: number
}

export type GreDebugDiagnostics = {
  lastMessage: string
  errorCount: number
  traffic: TrafficStats
  recentTypes: MessageTypeEntry[]
}

export type GreDebugEvidence = {
  gsId: number
  prompt: GreDebugPrompt | null
  status: string
  connected: boolean
  diagnostics: GreDebugDiagnostics
}

export type GreDebugCard = {
  iid: number
  name: string
  pt?: string
  mana?: string
  tapped?: boolean
  atk?: boolean
  play?: string
  roomDoors?: Array<{ grpId: number; name: string; manaCost: string; unlocked: boolean }>
}

export type GreDebugAnnotation = GreAnnotationEvidence

export type GreDebugState = GreDebugEvidence & {
  matchId: string
  horizon: GreDebugHorizon | null
  presentationLagging: boolean
  positionKey: string
  gameOver: boolean
  turn: number
  phase: string
  step: string
  activeSeat: number
  prioritySeat: number
  viewerSeat: number
  life: { you: number; opp: number }
  counts: {
    you: { library: number; graveyard: number; exile: number; sideboard: number; stack: number }
    opp: { hand: number; library: number; graveyard: number; exile: number } | null
  }
  hand: GreDebugCard[]
  board: { you: GreDebugCard[]; opp: GreDebugCard[] }
  stack: string[]
  actions: string[]
  annotations: GreDebugAnnotation[]
  logs: string[]
  outcome: { title: string; result: string } | null
}

export type GreDebugResult = {
  ok: boolean
  /** The action changed staged browser intent and should not wait for a server message. */
  local?: boolean
  error?: string
  state?: GreDebugState | null
  before?: GreDebugEvidence
  after?: GreDebugEvidence
}

export type GreDebugWindow = {
  __greState: () => GreDebugState | null
  __greEnumValue: (enumName: string, valueName: string) => Promise<number>
  __greAct: (verb: string, ...args: (string | number)[]) => Promise<GreDebugResult>
  __greActWait: (verb: string, ...args: (string | number)[]) => Promise<GreDebugResult>
  __greStart: (config?: GreStartConfig) => Promise<GreDebugResult>
  __greBrowserAdvice: () => Promise<unknown>
  __greBrowserDiagnostics: () => Promise<unknown>
}
