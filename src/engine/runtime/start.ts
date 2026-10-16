export type GreGameType =
  | 'constructed'
  | 'commander'
  | 'brawl'
  | 'oathbreaker'
  | 'puzzle'
  | 'draft'
  | 'sealed'
  | 'spectator'

export type GreExecution = 'server' | 'browser'

export type GreStartConfig = {
  execution?: GreExecution
  attemptId?: string
  seed?: number
  frontendBuild?: string
  engineBuild?: string
  seat1Deck?: string
  seat2Deck?: string
  challengeId?: string
  candidateId?: string
  puzzle?: string
  puzzleText?: string
  turnLimit?: number
  spectatorMode?: boolean
  gameType?: GreGameType
  matchId?: string
  wireMatchId?: string
  deckId?: string
  authToken?: string
  returnPath?: string
  label?: string
  objective?: string
}
