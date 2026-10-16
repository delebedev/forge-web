export type EntityRef = {
  instanceId: number
  kind: 'card' | 'player' | string
  name?: string | null
  grpId?: number | null
  zone?: string | null
  ownerSeat?: number | null
}

export type CopilotProposal = {
  intent: string
  promptType: string
  seat: number
  promptKey?: string | null
  gameStateId?: number | null
  respId?: number | null
  card?: EntityRef | null
  abilityGrpId?: number | null
  alternativeGrpId?: number | null
  targets: EntityRef[]
  targetGroups: Record<string, number[]>
  blocks: Array<{ blocker: EntityRef; attacker: EntityRef }>
  modalGrpIds: number[]
  manaTypes: Array<{ ctoId: number; color: string }>
  numericValue?: number | null
  distribution: Array<{ instanceId: number; amount: number }>
  combatDamageAssignments: Array<{
    assignerId: number
    recipients: Array<{ recipientId: number; amount: number }>
  }>
  groupAssignments: Array<{ zoneType: number; subZoneType: number; instanceIds: number[] }>
  accept?: boolean | null
  ctoId?: number | null
  replacementEffectId?: number | null
  responseIds: number[]
  reason?: string | null
}

export type DecisionHorizon = {
  kind: string
  promptKey: string
  gameStateId: number
  respId: number
}

export type BrowserGreState = {
  matchId: string
  horizon: DecisionHorizon | null
  presentationLagging?: boolean
  positionKey?: string
  prompt: { kind: string } | null
  gameOver: boolean
  outcome: { title: string; result: string } | null
  status?: string
  connected?: boolean
  turn?: number
  phase?: string
  step?: string
  gsId?: number
}

export type FailureClassification =
  | 'invalid_input'
  | 'advisor_unavailable'
  | 'driver_unsupported'
  | 'ui_missing'
  | 'stalled'
  | 'budget_exhausted'
  | 'interrupted'
  | 'environment'

export type VisibleInteraction = {
  at: string
  control: string
  observed: string
  proposalIntent: string
}

export type DecisionRecord = {
  at: string
  before: BrowserGreState
  proposal: CopilotProposal
  interactions: VisibleInteraction[]
  rejection?: { classification: 'advisor_unavailable'; message: string }
  after?: BrowserGreState
}

export type RunInput =
  | { kind: 'puzzle'; puzzleId: string }
  | { kind: 'candidate'; sourcePath: string; puzzleText: string; tryEngine: boolean }
  | { kind: 'url'; url: string }
  | {
      kind: 'ordinary'
      format: 'constructed' | 'commander'
      deck?: string
      opponentDeck?: string
      seed?: number
      execution?: 'browser'
    }

export type RunConfig = {
  baseUrl: string
  browser: 'chromium' | 'chrome' | 'edge' | 'firefox' | 'webkit'
  headed: boolean
  slowMoMs: number
  maxActions: number
  startupTimeoutMs: number
  timeoutMs: number
  progressTimeoutMs: number
  stallLimit: number
  outputDir: string
  screenshot: boolean
  trace: boolean
  video: boolean
  userDataDir?: string
  storageState?: string
}

export type RunTerminal = {
  kind: 'win' | 'loss' | 'draw' | 'budget' | 'interrupted' | 'failure'
  classification?: FailureClassification
  message?: string
  details?: Record<string, unknown>
}

export type RunReport = {
  schemaVersion: 1
  startedAt: string
  finishedAt: string
  input: RunInput
  config: RunConfig
  revision: { localCheckout: { forgeWeb: string; engine: { leyline: string; forge: string } } }
  observedBackendRelease: string
  seed: string
  matchId?: string
  finalState?: BrowserGreState
  decisions: DecisionRecord[]
  terminal: RunTerminal
  candidate?: {
    validation: { loaded: boolean; observed: string }
    engineTrial: { attempted: boolean; solved: boolean | null; observed?: string }
    browser: { solved: boolean; terminal: RunTerminal['kind'] }
  }
  evidence: {
    report: string
    screenshots: string[]
    trace?: string
    video?: string
  }
}
