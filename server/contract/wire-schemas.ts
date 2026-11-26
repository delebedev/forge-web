// Product HTTP contract shared by the product server and the browser. See docs/http-contract.md.
import { z } from 'zod'

const int32 = z.number().int().min(-2147483648).max(2147483647)

export const AuthViewSchema = z.object({
  playerId: z.string().nullable(),
  guest: z.boolean(),
})
export type AuthView = z.infer<typeof AuthViewSchema>

export const RequestLoginCodeRequestInputSchema = z.object({ email: z.string() })
export type RequestLoginCodeRequest = z.infer<typeof RequestLoginCodeRequestInputSchema>

export const VerifyLoginCodeRequestInputSchema = z.object({ email: z.string(), code: z.string() })
export type VerifyLoginCodeRequest = z.infer<typeof VerifyLoginCodeRequestInputSchema>

export const LoginResponseSchema = z.object({
  playerId: z.string(),
  email: z.string(),
})
export type LoginResponse = z.infer<typeof LoginResponseSchema>

export const RoadmapItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  note: z.string().nullable(),
  statusUpdatedAt: z.string().nullable(),
  votes: int32,
  voted: z.boolean(),
})
export type RoadmapItem = z.infer<typeof RoadmapItemSchema>

export const GeneratedPuzzleSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  createdAt: z.string(),
})
export type GeneratedPuzzle = z.infer<typeof GeneratedPuzzleSchema>

export const PuzzleRatingRequestInputSchema = z.object({
  reaction: z.string(),
  comment: z.string().nullable().optional(),
  outcome: z.string(),
  actions: z.array(z.string()).optional(),
})
export type PuzzleRatingRequest = z.infer<typeof PuzzleRatingRequestInputSchema>

export const CourseRecordSchema = z.object({
  eventName: z.string(),
  revision: int32,
  document: z.string(),
})
export type CourseRecord = z.infer<typeof CourseRecordSchema>

export const SaveCourseRecordRequestInputSchema = z.object({
  revision: int32,
  document: z.string(),
})
export type SaveCourseRecordRequest = z.infer<typeof SaveCourseRecordRequestInputSchema>

export const WebDeckCardSchema = z.object({
  cardName: z.string(),
  quantity: int32,
})
export type WebDeckCard = z.infer<typeof WebDeckCardSchema>

export const DeckViewSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  name: z.string(),
  format: z.string(),
  mainDeck: z.array(WebDeckCardSchema),
  sideboard: z.array(WebDeckCardSchema),
  commandZone: z.array(WebDeckCardSchema),
})
export type DeckView = z.infer<typeof DeckViewSchema>

export const WebDeckCardInputSchema = WebDeckCardSchema

/** Omitted sections are empty and an omitted format is Standard. */
export const CreateDeckRequestInputSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  format: z.string().optional(),
  mainDeck: z.array(WebDeckCardInputSchema),
  sideboard: z.array(WebDeckCardInputSchema).optional(),
  commandZone: z.array(WebDeckCardInputSchema).optional(),
})
export type CreateDeckRequest = z.infer<typeof CreateDeckRequestInputSchema>

export const ParseDecklistErrorResponseSchema = z.object({ errors: z.array(z.string()) })
export type ParseDecklistErrorResponse = z.infer<typeof ParseDecklistErrorResponseSchema>

/** JSON response bodies by endpoint and status. Empty and text responses have no entry. */
export const responseSchemas = {
  'GET /api/auth/me': { '200': AuthViewSchema },
  'POST /api/auth/request-code': {},
  'POST /api/auth/verify': { '200': LoginResponseSchema },
  'POST /api/auth/logout': {},
  'GET /api/roadmap': { '200': z.array(RoadmapItemSchema) },
  'PUT /api/roadmap/{itemId}/vote': {},
  'DELETE /api/roadmap/{itemId}/vote': {},
  'GET /api/puzzles': { '200': z.array(GeneratedPuzzleSchema) },
  'GET /api/puzzles/{puzzleId}': { '200': GeneratedPuzzleSchema },
  'POST /api/puzzles/{puzzleId}/ratings': {},
  'GET /api/public/cards/image': {},
  'GET /api/course-records': { '200': z.array(CourseRecordSchema) },
  'PUT /api/course-records/{eventName}': { '200': CourseRecordSchema },
  'DELETE /api/course-records/{eventName}': {},
  'GET /api/course-records/{eventName}': { '200': CourseRecordSchema },
  'POST /api/decks': { '200': DeckViewSchema, '400': ParseDecklistErrorResponseSchema },
  'GET /api/decks': { '200': z.array(DeckViewSchema) },
  'PUT /api/decks/{deckId}': { '200': DeckViewSchema, '400': ParseDecklistErrorResponseSchema },
  'DELETE /api/decks/{deckId}': {},
  'GET /api/decks/{deckId}': { '200': DeckViewSchema },
} as const
