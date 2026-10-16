// Generated from the registered Kotlin HTTP contract. Run bun run api:types.
import { z } from 'zod'
import type { components } from './types'
export const AuthViewSchema: z.ZodType<components['schemas']['AuthView']> = z.object({
  playerId: z.string().nullable(),
  guest: z.boolean(),
})
export const RequestLoginCodeRequestInputSchema: z.ZodType<
  components['schemas']['RequestLoginCodeRequestInput']
> = z.object({ email: z.string() })
export const VerifyLoginCodeRequestInputSchema: z.ZodType<
  components['schemas']['VerifyLoginCodeRequestInput']
> = z.object({ email: z.string(), code: z.string() })
export const LoginResponseSchema: z.ZodType<components['schemas']['LoginResponse']> = z.object({
  playerId: z.string(),
  email: z.string(),
})
export const RoadmapItemSchema: z.ZodType<components['schemas']['RoadmapItem']> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  note: z.string().nullable(),
  statusUpdatedAt: z.string().nullable(),
  votes: z.number().int().min(-2147483648).max(2147483647),
  voted: z.boolean(),
})
export const GeneratedPuzzleSchema: z.ZodType<components['schemas']['GeneratedPuzzle']> = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  createdAt: z.string(),
})
export const PuzzleCapabilitiesSchema: z.ZodType<components['schemas']['PuzzleCapabilities']> =
  z.object({ canGenerate: z.boolean() })
export const PuzzleAttemptSchema: z.ZodType<components['schemas']['PuzzleAttempt']> = z.object({
  featuredCard: z.string(),
  puzzleText: z.string().nullable(),
  validation: z.string().nullable(),
  trial: z.string().nullable(),
  withoutFeaturedTrial: z.string().nullable(),
  jevAssessment: z.string().nullable(),
  rejection: z.string().nullable(),
})
export const PuzzleRunSchema: z.ZodType<components['schemas']['PuzzleRun']> = z.object({
  id: z.string(),
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.string(),
  stage: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  sampledCards: z.array(z.string()),
  attempts: z.array(z.lazy(() => PuzzleAttemptSchema)),
  puzzleId: z.string().nullable(),
  error: z.string().nullable(),
})
export const PuzzleRatingRequestInputSchema: z.ZodType<
  components['schemas']['PuzzleRatingRequestInput']
> = z.object({
  reaction: z.string(),
  comment: z.string().nullable().optional(),
  outcome: z.string(),
  actions: z.array(z.string()).optional(),
})
export const GreStartRequestInputSchema: z.ZodType<components['schemas']['GreStartRequestInput']> =
  z.object({
    matchId: z.string().nullable().optional(),
    wireMatchId: z.string().nullable().optional(),
    seat1Deck: z.string().nullable().optional(),
    seat2Deck: z.string().nullable().optional(),
    gameVariant: z.string().nullable().optional(),
    seed: z.number().int().safe().nullable().optional(),
    challengeId: z.string().nullable().optional(),
    candidateId: z.string().nullable().optional(),
    puzzle: z.string().nullable().optional(),
    spectatorMode: z.boolean().nullable().optional(),
  })
export const DraftPlayResponseSchema: z.ZodType<components['schemas']['DraftPlayResponse']> =
  z.object({ matchId: z.string(), wireMatchId: z.string() })
export const MatchCapacityResponseSchema: z.ZodType<
  components['schemas']['MatchCapacityResponse']
> = z.object({
  code: z.string(),
  message: z.string(),
  retryAfterSeconds: z.number().int().min(-2147483648).max(2147483647),
})
export const GreAbandonRequestInputSchema: z.ZodType<
  components['schemas']['GreAbandonRequestInput']
> = z.object({ matchId: z.string() })
export const GreMechanicHelpDtoSchema: z.ZodType<components['schemas']['GreMechanicHelpDto']> =
  z.object({
    keyword: z.string(),
    title: z.string(),
    description: z.string(),
    cost: z.string().nullable(),
  })
export const GreAbilityMetaDtoSchema: z.ZodType<components['schemas']['GreAbilityMetaDto']> =
  z.object({ text: z.string(), keyword: z.string().nullable(), manaCost: z.string().nullable() })
export const GreCardMetaDtoSchema: z.ZodType<components['schemas']['GreCardMetaDto']> = z.object({
  grpId: z.number().int().min(-2147483648).max(2147483647),
  name: z.string().nullable(),
  setCode: z.string().nullable(),
  rarity: z.string().nullable(),
  titleId: z.number().int().min(-2147483648).max(2147483647).nullable(),
  manaCost: z.string().nullable(),
  power: z.string().nullable(),
  toughness: z.string().nullable(),
  loyalty: z.string().nullable(),
  defense: z.string().nullable(),
  faceLayout: z.string().nullable(),
  types: z.string().nullable(),
  subtypes: z.string().nullable(),
  rulesText: z.string().nullable(),
  imageUrl: z.string().nullable(),
  keywords: z.array(z.string()),
  mechanicHelp: z.array(z.lazy(() => GreMechanicHelpDtoSchema)),
  linkedFaceGrpIds: z.array(z.number().int().min(-2147483648).max(2147483647)),
  abilities: z.record(
    z.string(),
    z.lazy(() => GreAbilityMetaDtoSchema),
  ),
})
export const PublicSeatViewSchema: z.ZodType<components['schemas']['PublicSeatView']> = z.object({
  name: z.string(),
})
export const PublicSpectatorResponseSchema: z.ZodType<
  components['schemas']['PublicSpectatorResponse']
> = z.object({
  matchId: z.string(),
  wireMatchId: z.string(),
  seat1: z.lazy(() => PublicSeatViewSchema),
  seat2: z.lazy(() => PublicSeatViewSchema),
})
export const ViewerCountViewSchema: z.ZodType<components['schemas']['ViewerCountView']> = z.object({
  count: z.number().int().min(-2147483648).max(2147483647),
})
export const EntityRefNullableSchema: z.ZodType<components['schemas']['EntityRefNullable']> = z
  .object({
    instanceId: z.number().int().min(-2147483648).max(2147483647),
    kind: z.string(),
    name: z.string().nullable(),
    grpId: z.number().int().min(-2147483648).max(2147483647).nullable(),
    zone: z.string().nullable(),
    ownerSeat: z.number().int().min(-2147483648).max(2147483647).nullable(),
  })
  .nullable()
export const EntityRefSchema: z.ZodType<components['schemas']['EntityRef']> = z.object({
  instanceId: z.number().int().min(-2147483648).max(2147483647),
  kind: z.string(),
  name: z.string().nullable(),
  grpId: z.number().int().min(-2147483648).max(2147483647).nullable(),
  zone: z.string().nullable(),
  ownerSeat: z.number().int().min(-2147483648).max(2147483647).nullable(),
})
export const GroupAssignmentSchema: z.ZodType<components['schemas']['GroupAssignment']> = z.object({
  zoneType: z.number().int().min(-2147483648).max(2147483647),
  subZoneType: z.number().int().min(-2147483648).max(2147483647),
  instanceIds: z.array(z.number().int().min(-2147483648).max(2147483647)),
})
export const CombatDamageRecipientSchema: z.ZodType<
  components['schemas']['CombatDamageRecipient']
> = z.object({
  recipientId: z.number().int().min(-2147483648).max(2147483647),
  amount: z.number().int().min(-2147483648).max(2147483647),
})
export const CombatDamageAssignmentSchema: z.ZodType<
  components['schemas']['CombatDamageAssignment']
> = z.object({
  assignerId: z.number().int().min(-2147483648).max(2147483647),
  recipients: z.array(z.lazy(() => CombatDamageRecipientSchema)),
})
export const BlockAssignmentSchema: z.ZodType<components['schemas']['BlockAssignment']> = z.object({
  blocker: z.lazy(() => EntityRefSchema),
  attacker: z.lazy(() => EntityRefSchema),
})
export const ManaTypeChoiceSchema: z.ZodType<components['schemas']['ManaTypeChoice']> = z.object({
  ctoId: z.number().int().min(-2147483648).max(2147483647),
  color: z.string(),
})
export const DistributionAmountSchema: z.ZodType<components['schemas']['DistributionAmount']> =
  z.object({
    instanceId: z.number().int().min(-2147483648).max(2147483647),
    amount: z.number().int().min(-2147483648).max(2147483647),
  })
export const CopilotProposalSchema: z.ZodType<components['schemas']['CopilotProposal']> = z.object({
  intent: z.string(),
  promptType: z.string(),
  seat: z.number().int().min(-2147483648).max(2147483647),
  promptKey: z.string().nullable(),
  gameStateId: z.number().int().min(-2147483648).max(2147483647).nullable(),
  respId: z.number().int().min(-2147483648).max(2147483647).nullable(),
  card: z.lazy(() => EntityRefNullableSchema),
  abilityGrpId: z.number().int().min(-2147483648).max(2147483647).nullable(),
  alternativeGrpId: z.number().int().min(-2147483648).max(2147483647).nullable(),
  targets: z.array(z.lazy(() => EntityRefSchema)),
  targetGroups: z.record(z.string(), z.array(z.number().int().min(-2147483648).max(2147483647))),
  groupAssignments: z.array(z.lazy(() => GroupAssignmentSchema)),
  combatDamageAssignments: z.array(z.lazy(() => CombatDamageAssignmentSchema)),
  blocks: z.array(z.lazy(() => BlockAssignmentSchema)),
  modalGrpIds: z.array(z.number().int().min(-2147483648).max(2147483647)),
  manaTypes: z.array(z.lazy(() => ManaTypeChoiceSchema)),
  numericValue: z.number().int().min(-2147483648).max(2147483647).nullable(),
  distribution: z.array(z.lazy(() => DistributionAmountSchema)),
  accept: z.boolean().nullable(),
  ctoId: z.number().int().min(-2147483648).max(2147483647).nullable(),
  replacementEffectId: z.number().int().min(-2147483648).max(2147483647).nullable(),
  responseIds: z.array(z.number().int().min(-2147483648).max(2147483647)),
  responses: z.array(z.string()),
  reason: z.string().nullable(),
})
export const DevPuzzleCandidateRequestInputSchema: z.ZodType<
  components['schemas']['DevPuzzleCandidateRequestInput']
> = z.object({ text: z.string() })
export const PuzzleValidationResultSchema: z.ZodType<
  components['schemas']['PuzzleValidationResult']
> = z.object({
  status: z.enum(['Loaded', 'Invalid', 'Unsupported', 'EngineFailure']),
  issues: z.array(z.string()),
  name: z.string().nullable(),
  goal: z.string().nullable(),
  turns: z.number().int().min(-2147483648).max(2147483647).nullable(),
  inputCardCount: z.number().int().min(-2147483648).max(2147483647),
})
export const DevPuzzleCandidateValidationResponseSchema: z.ZodType<
  components['schemas']['DevPuzzleCandidateValidationResponse']
> = z.object({
  candidateId: z.string().nullable(),
  validation: z.lazy(() => PuzzleValidationResultSchema),
})
export const PuzzleTrialLimitsSchema: z.ZodType<components['schemas']['PuzzleTrialLimits']> =
  z.object({
    maxDecisions: z.number().int().min(-2147483648).max(2147483647),
    maxElapsedMillis: z.number().int().safe(),
  })
export const PuzzleTrialDecisionSchema: z.ZodType<components['schemas']['PuzzleTrialDecision']> =
  z.object({
    index: z.number().int().min(-2147483648).max(2147483647),
    intent: z.string(),
    promptType: z.string(),
    promptKey: z.string().nullable(),
    gameStateId: z.number().int().min(-2147483648).max(2147483647).nullable(),
    respId: z.number().int().min(-2147483648).max(2147483647).nullable(),
  })
export const PuzzleTrialOutcomeNullableSchema: z.ZodType<
  components['schemas']['PuzzleTrialOutcomeNullable']
> = z
  .object({
    playerSeatId: z.number().int().min(-2147483648).max(2147483647),
    winningTeam: z.number().int().min(-2147483648).max(2147483647),
    won: z.boolean(),
  })
  .nullable()
export const PuzzleTrialResultSchema: z.ZodType<components['schemas']['PuzzleTrialResult']> =
  z.object({
    status: z.enum([
      'Won',
      'Lost',
      'Unsupported',
      'AdvisorUnavailable',
      'Stalled',
      'DecisionBudgetExceeded',
      'TimeBudgetExceeded',
      'Interrupted',
      'EngineFailure',
    ]),
    definitionId: z.string(),
    matchId: z.string().nullable(),
    engineSeed: z.number().int().safe().nullable(),
    limits: z.lazy(() => PuzzleTrialLimitsSchema),
    elapsedMillis: z.number().int().safe(),
    decisions: z.array(z.lazy(() => PuzzleTrialDecisionSchema)),
    outcome: z.lazy(() => PuzzleTrialOutcomeNullableSchema),
    reason: z.string().nullable(),
  })
export const ChallengeSummarySchema: z.ZodType<components['schemas']['ChallengeSummary']> =
  z.object({ challengeId: z.string(), name: z.string(), objective: z.string() })
export const CollectionViewSchema: z.ZodType<components['schemas']['CollectionView']> = z.object({
  grpIds: z.array(z.number().int().min(-2147483648).max(2147483647)),
})
export const CardMetadataEntrySchema: z.ZodType<components['schemas']['CardMetadataEntry']> =
  z.object({
    grpId: z.number().int().min(-2147483648).max(2147483647),
    name: z.string().nullable(),
  })
export const CardMetadataViewSchema: z.ZodType<components['schemas']['CardMetadataView']> =
  z.object({ cards: z.array(z.lazy(() => CardMetadataEntrySchema)) })
export const DraftCardDtoSchema: z.ZodType<components['schemas']['DraftCardDto']> = z.object({
  name: z.string(),
  grpId: z.number().int().min(-2147483648).max(2147483647).nullable(),
  manaCost: z.string().nullable(),
  typeLine: z.string().nullable(),
  rarity: z.string().nullable(),
  colors: z.array(z.string()),
  setCode: z.string().nullable(),
  collectorNumber: z.string().nullable(),
  score: z.number().nullable(),
})
export const ParseDecklistRequestInputSchema: z.ZodType<
  components['schemas']['ParseDecklistRequestInput']
> = z.object({ text: z.string() })
export const ParseDecklistErrorResponseSchema: z.ZodType<
  components['schemas']['ParseDecklistErrorResponse']
> = z.object({ errors: z.array(z.string()) })
export const DecklistCardDtoSchema: z.ZodType<components['schemas']['DecklistCardDto']> = z.object({
  grpId: z.number().int().min(-2147483648).max(2147483647),
  quantity: z.number().int().min(-2147483648).max(2147483647),
  card: z.lazy(() => DraftCardDtoSchema),
})
export const ParseDecklistResponseSchema: z.ZodType<
  components['schemas']['ParseDecklistResponse']
> = z.object({
  mainboard: z.array(z.lazy(() => DecklistCardDtoSchema)),
  sideboard: z.array(z.lazy(() => DecklistCardDtoSchema)),
  commandZone: z.array(z.lazy(() => DecklistCardDtoSchema)),
})
export const ValidateDecklistRequestInputSchema: z.ZodType<
  components['schemas']['ValidateDecklistRequestInput']
> = z.object({ text: z.string(), gameType: z.string().nullable().optional() })
export const CourseViewSchema: z.ZodType<components['schemas']['CourseView']> = z.object({
  eventName: z.string(),
  module: z.string(),
  wins: z.number().int().min(-2147483648).max(2147483647),
  losses: z.number().int().min(-2147483648).max(2147483647),
  cardPool: z.array(z.number().int().min(-2147483648).max(2147483647)),
  deckId: z.string().nullable(),
})
export const WebDeckCardSchema: z.ZodType<components['schemas']['WebDeckCard']> = z.object({
  grpId: z.number().int().min(-2147483648).max(2147483647),
  quantity: z.number().int().min(-2147483648).max(2147483647),
})
export const DeckViewSchema: z.ZodType<components['schemas']['DeckView']> = z.object({
  id: z.string(),
  playerId: z.string(),
  name: z.string(),
  format: z.string(),
  mainDeck: z.array(z.lazy(() => WebDeckCardSchema)),
  sideboard: z.array(z.lazy(() => WebDeckCardSchema)),
  commandZone: z.array(z.lazy(() => WebDeckCardSchema)),
})
export const WebDeckCardInputSchema: z.ZodType<components['schemas']['WebDeckCardInput']> =
  z.object({
    grpId: z.number().int().min(-2147483648).max(2147483647),
    quantity: z.number().int().min(-2147483648).max(2147483647),
  })
export const CreateDeckRequestInputSchema: z.ZodType<
  components['schemas']['CreateDeckRequestInput']
> = z.object({
  playerId: z.string(),
  name: z.string(),
  format: z.string().optional(),
  mainDeck: z.array(z.lazy(() => WebDeckCardInputSchema)),
  sideboard: z.array(z.lazy(() => WebDeckCardInputSchema)).optional(),
  commandZone: z.array(z.lazy(() => WebDeckCardInputSchema)).optional(),
})
export const StartDraftRequestInputSchema: z.ZodType<
  components['schemas']['StartDraftRequestInput']
> = z.object({ playerId: z.string(), eventName: z.string() })
export const DraftSessionViewSchema: z.ZodType<components['schemas']['DraftSessionView']> =
  z.object({
    eventName: z.string(),
    status: z.string(),
    packNumber: z.number().int().min(-2147483648).max(2147483647),
    pickNumber: z.number().int().min(-2147483648).max(2147483647),
    draftPack: z.array(z.number().int().min(-2147483648).max(2147483647)),
    pickedCards: z.array(z.number().int().min(-2147483648).max(2147483647)),
  })
export const PickDraftRequestInputSchema: z.ZodType<
  components['schemas']['PickDraftRequestInput']
> = z.object({
  playerId: z.string(),
  eventName: z.string(),
  cardId: z.number().int().min(-2147483648).max(2147483647),
})
export const SubmitDeckRequestInputSchema: z.ZodType<
  components['schemas']['SubmitDeckRequestInput']
> = z.object({
  playerId: z.string(),
  eventName: z.string(),
  name: z.string().optional(),
  deckId: z.string().nullable().optional(),
  mainDeck: z.array(z.lazy(() => WebDeckCardInputSchema)),
  sideboard: z.array(z.lazy(() => WebDeckCardInputSchema)).optional(),
})
export const PlayDraftRequestInputSchema: z.ZodType<
  components['schemas']['PlayDraftRequestInput']
> = z.object({ playerId: z.string(), eventName: z.string() })
export const LimitedSetArchetypeViewSchema: z.ZodType<
  components['schemas']['LimitedSetArchetypeView']
> = z.object({ pair: z.string(), name: z.string(), strategy: z.string().nullable() })
export const LimitedSetViewSchema: z.ZodType<components['schemas']['LimitedSetView']> = z.object({
  code: z.string(),
  name: z.string(),
  date: z.string().nullable(),
  type: z.string().nullable(),
  cardCount: z.number().int().min(-2147483648).max(2147483647).nullable(),
  description: z.string().nullable(),
  mechanics: z.array(z.string()).nullable(),
  archetypes: z.array(z.lazy(() => LimitedSetArchetypeViewSchema)).nullable(),
})
export const responseSchemas = {
  'GET /api/auth/me': {
    '200': z.lazy(() => AuthViewSchema),
  },
  'POST /api/auth/guest': {
    '200': z.lazy(() => AuthViewSchema),
  },
  'POST /api/auth/request-code': {},
  'POST /api/auth/verify': {
    '200': z.lazy(() => LoginResponseSchema),
  },
  'POST /api/auth/logout': {},
  'GET /api/roadmap': {
    '200': z.array(z.lazy(() => RoadmapItemSchema)),
  },
  'PUT /api/roadmap/{itemId}/vote': {},
  'DELETE /api/roadmap/{itemId}/vote': {},
  'GET /api/puzzles': {
    '200': z.array(z.lazy(() => GeneratedPuzzleSchema)),
  },
  'GET /api/puzzles/capabilities': {
    '200': z.lazy(() => PuzzleCapabilitiesSchema),
  },
  'POST /api/puzzles/generate': {
    '202': z.lazy(() => PuzzleRunSchema),
  },
  'GET /api/puzzles/runs/{runId}': {
    '200': z.lazy(() => PuzzleRunSchema),
  },
  'GET /api/puzzles/{puzzleId}': {
    '200': z.lazy(() => GeneratedPuzzleSchema),
  },
  'POST /api/puzzles/{puzzleId}/ratings': {},
  'POST /api/gre/start': {
    '200': z.lazy(() => DraftPlayResponseSchema),
    '503': z.lazy(() => MatchCapacityResponseSchema),
  },
  'POST /api/gre/abandon': {},
  'GET /api/public/cards/by-grpids': {
    '200': z.record(
      z.string(),
      z.lazy(() => GreCardMetaDtoSchema),
    ),
  },
  'GET /api/public/cards/image': {},
  'POST /api/public/spectator/start': {
    '200': z.lazy(() => PublicSpectatorResponseSchema),
    '503': z.lazy(() => MatchCapacityResponseSchema),
  },
  'GET /api/public/spectate/viewers': {
    '200': z.lazy(() => ViewerCountViewSchema),
  },
  'GET /api/dev/matches/{matchId}/advice': {
    '200': z.lazy(() => CopilotProposalSchema),
  },
  'POST /api/dev/puzzle-candidates': {
    '200': z.lazy(() => DevPuzzleCandidateValidationResponseSchema),
  },
  'POST /api/dev/puzzle-candidates/{candidateId}/trial': {
    '200': z.lazy(() => PuzzleTrialResultSchema),
  },
  'GET /api/dev/challenges': {
    '200': z.array(z.lazy(() => ChallengeSummarySchema)),
  },
  'GET /api/dev/puzzles/{puzzleId}': {
    '200': z.lazy(() => ChallengeSummarySchema),
  },
  'GET /api/collection': {
    '200': z.lazy(() => CollectionViewSchema),
  },
  'GET /api/cards/metadata': {
    '200': z.lazy(() => CardMetadataViewSchema),
  },
  'GET /api/cards/search': {
    '200': z.array(z.lazy(() => DraftCardDtoSchema)),
  },
  'POST /api/cards/parse-decklist': {
    '200': z.lazy(() => ParseDecklistResponseSchema),
    '400': z.lazy(() => ParseDecklistErrorResponseSchema),
  },
  'POST /api/cards/validate-decklist': {
    '400': z.lazy(() => ParseDecklistErrorResponseSchema),
  },
  'GET /api/courses': {
    '200': z.array(z.lazy(() => CourseViewSchema)),
  },
  'POST /api/decks': {
    '200': z.lazy(() => DeckViewSchema),
    '400': z.lazy(() => ParseDecklistErrorResponseSchema),
  },
  'GET /api/decks': {
    '200': z.array(z.lazy(() => DeckViewSchema)),
  },
  'PUT /api/decks/{deckId}': {
    '200': z.lazy(() => DeckViewSchema),
    '400': z.lazy(() => ParseDecklistErrorResponseSchema),
  },
  'DELETE /api/decks/{deckId}': {},
  'GET /api/decks/{deckId}': {
    '200': z.lazy(() => DeckViewSchema),
  },
  'POST /api/draft/start': {
    '200': z.lazy(() => DraftSessionViewSchema),
  },
  'POST /api/draft/pick': {
    '200': z.lazy(() => DraftSessionViewSchema),
  },
  'GET /api/draft/status': {
    '200': z.lazy(() => DraftSessionViewSchema),
  },
  'POST /api/draft/deck': {
    '200': z.lazy(() => CourseViewSchema),
  },
  'POST /api/draft/play': {
    '200': z.lazy(() => DraftPlayResponseSchema),
    '503': z.lazy(() => MatchCapacityResponseSchema),
  },
  'DELETE /api/draft': {},
  'GET /api/sealed/sets': {
    '200': z.array(z.lazy(() => LimitedSetViewSchema)),
  },
  'POST /api/sealed/start': {
    '200': z.lazy(() => CourseViewSchema),
  },
  'POST /api/sealed/deck': {
    '200': z.lazy(() => CourseViewSchema),
  },
  'POST /api/sealed/play': {
    '200': z.lazy(() => DraftPlayResponseSchema),
    '503': z.lazy(() => MatchCapacityResponseSchema),
  },
  'DELETE /api/sealed': {},
} as const
