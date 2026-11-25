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
export const ChallengeSummarySchema: z.ZodType<components['schemas']['ChallengeSummary']> =
  z.object({ challengeId: z.string(), name: z.string(), objective: z.string() })
export const DevelopmentPuzzleSchema: z.ZodType<components['schemas']['DevelopmentPuzzle']> =
  z.object({ name: z.string(), objective: z.string(), text: z.string() })
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
export const CourseRecordSchema: z.ZodType<components['schemas']['CourseRecord']> = z.object({
  eventName: z.string(),
  revision: z.number().int().min(-2147483648).max(2147483647),
  document: z.string(),
})
export const SaveCourseRecordRequestInputSchema: z.ZodType<
  components['schemas']['SaveCourseRecordRequestInput']
> = z.object({ revision: z.number().int().min(-2147483648).max(2147483647), document: z.string() })
export const WebDeckCardSchema: z.ZodType<components['schemas']['WebDeckCard']> = z.object({
  cardName: z.string(),
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
  z.object({ cardName: z.string(), quantity: z.number().int().min(-2147483648).max(2147483647) })
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
  'GET /api/puzzles/runs/{runId}': {
    '200': z.lazy(() => PuzzleRunSchema),
  },
  'GET /api/puzzles/{puzzleId}': {
    '200': z.lazy(() => GeneratedPuzzleSchema),
  },
  'POST /api/puzzles/{puzzleId}/ratings': {},
  'GET /api/public/cards/by-grpids': {
    '200': z.record(
      z.string(),
      z.lazy(() => GreCardMetaDtoSchema),
    ),
  },
  'GET /api/public/cards/image': {},
  'GET /api/dev/challenges': {
    '200': z.array(z.lazy(() => ChallengeSummarySchema)),
  },
  'GET /api/dev/puzzles/{puzzleId}': {
    '200': z.lazy(() => DevelopmentPuzzleSchema),
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
  'GET /api/course-records': {
    '200': z.array(z.lazy(() => CourseRecordSchema)),
  },
  'PUT /api/course-records/{eventName}': {
    '200': z.lazy(() => CourseRecordSchema),
  },
  'DELETE /api/course-records/{eventName}': {},
  'GET /api/course-records/{eventName}': {
    '200': z.lazy(() => CourseRecordSchema),
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
} as const
