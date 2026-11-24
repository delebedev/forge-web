export type GreGameType =
  'constructed' | 'commander' | 'brawl' | 'oathbreaker' | 'puzzle' | 'draft' | 'sealed'

export type GreExecution = 'browser'

export type GreStartConfig = {
  execution?: GreExecution
  /** A limited course game: its event and the number of games the course had finished before it. */
  courseEvent?: string
  courseSeed?: number | null
  courseGame?: number
  attemptId?: string
  seed?: number
  frontendBuild?: string
  engineBuild?: string
  seat1Deck?: string
  seat2Deck?: string
  challengeId?: string
  puzzleText?: string
  turnLimit?: number
  gameType?: GreGameType
  matchId?: string
  deckId?: string
  returnPath?: string
  label?: string
  objective?: string
}
