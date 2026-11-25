import { z } from 'zod'

export { ParseDecklistErrorResponseSchema } from './wire-schemas'
import type { components } from './types'

// Card shapes come from the browser card index and browser engine, not the product server.
const int32 = z.number().int().min(-2147483648).max(2147483647)

export const GreMechanicHelpSchema = z.object({
  keyword: z.string(),
  title: z.string(),
  description: z.string(),
  cost: z.string().nullable(),
})
export const GreAbilityMetaSchema = z.object({
  text: z.string(),
  keyword: z.string().nullable(),
  manaCost: z.string().nullable(),
})
export const GreCardMetaDtoSchema = z.object({
  grpId: int32,
  name: z.string().nullable(),
  setCode: z.string().nullable(),
  rarity: z.string().nullable(),
  titleId: int32.nullable(),
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
  mechanicHelp: z.array(GreMechanicHelpSchema),
  linkedFaceGrpIds: z.array(int32),
  abilities: z.record(z.string(), GreAbilityMetaSchema),
})
export type GreCardMetaDto = z.output<typeof GreCardMetaDtoSchema>

export const DraftCardSchema = z.object({
  name: z.string(),
  grpId: int32.nullable(),
  manaCost: z.string().nullable(),
  typeLine: z.string().nullable(),
  rarity: z.string().nullable(),
  colors: z.array(z.string()),
  setCode: z.string().nullable(),
  collectorNumber: z.string().nullable(),
  score: z.number().nullable(),
})
export const DecklistCardSchema = z.object({ grpId: int32, quantity: int32, card: DraftCardSchema })
export const ParseDecklistResponseSchema = z.object({
  mainboard: z.array(DecklistCardSchema),
  sideboard: z.array(DecklistCardSchema),
  commandZone: z.array(DecklistCardSchema),
})

// Placeholder cards are view values. Fields follow the DTO; metadata may be unresolved.
type WireDraftCard = z.output<typeof DraftCardSchema>
export type DraftCard = Omit<WireDraftCard, 'grpId' | 'score'> &
  Partial<Pick<WireDraftCard, 'grpId' | 'score'>> &
  Partial<
    Pick<GreCardMetaDto, 'rulesText' | 'power' | 'toughness' | 'loyalty' | 'defense' | 'faceLayout'>
  > & { linkedFaces?: GreCardMetaDto[] }
export type DecklistCard = z.output<typeof DecklistCardSchema>
export type ParseDecklistResponse = z.output<typeof ParseDecklistResponseSchema>
export type ParseDecklistErrorResponse = components['schemas']['ParseDecklistErrorResponse']
/** A limited set as the browser card index lists it. */
export const SealedSetSchema = z.object({
  code: z.string(),
  name: z.string(),
  date: z.string().nullable(),
  type: z.string().nullable(),
  cardCount: z.number().int().nullable(),
  description: z.string().nullable(),
  mechanics: z.array(z.string()).nullable(),
  archetypes: z
    .array(z.object({ pair: z.string(), name: z.string(), strategy: z.string().nullable() }))
    .nullable(),
})
export type SealedSet = z.output<typeof SealedSetSchema>

// Advice and deck browser values are presentation models, not product HTTP DTOs.
export const DraftAdviceRecommendationSchema = z.object({
  name: z.string(),
  rank: z.number(),
  commentary: z.string().optional(),
})

export const DraftAdviceSchema = z.object({
  recommendations: z.array(DraftAdviceRecommendationSchema).optional().default([]),
  notes: z.array(z.string()).optional().default([]),
  error: z.string().nullable().optional(),
})

export const DeckSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  coverName: z.string().optional(),
  description: z.string().nullable().optional(),
  set: z.string().nullable().optional(),
  colors: z.array(z.string()),
  cardCount: z.number(),
  hasCommander: z.boolean().optional().default(false),
  userOwned: z.boolean().nullable().optional(),
})

export const DeckCardSchema = z.object({
  name: z.string(),
  quantity: z.number(),
  manaCost: z.string().nullable().optional(),
  typeLine: z.string().nullable().optional(),
  setCode: z.string().nullable().optional(),
  collectorNumber: z.string().nullable().optional(),
  colors: z.array(z.string()),
  cmc: z.number(),
  power: z.string().nullable().optional(),
  toughness: z.string().nullable().optional(),
  rulesText: z.string().nullable().optional(),
  loyalty: z.string().nullable().optional(),
  defense: z.string().nullable().optional(),
  faceLayout: z.string().nullable().optional(),
  linkedFaces: z.array(GreCardMetaDtoSchema).optional(),
})

export const DeckStatsSchema = z.object({
  totalCards: z.number(),
  creatures: z.number(),
  nonCreatures: z.number(),
  lands: z.number(),
  manaCurve: z.record(z.string(), z.number()),
  averageCmc: z.number(),
})

export const DeckDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  set: z.string().nullable().optional(),
  colors: z.array(z.string()),
  cards: z.array(DeckCardSchema),
  commandZone: z.array(DeckCardSchema).optional(),
  sideboard: z.array(DeckCardSchema).optional(),
  metadataComplete: z.boolean().optional(),
  stats: DeckStatsSchema,
  hasCommander: z.boolean().optional().default(false),
  content: z.string().nullable().optional(),
  userOwned: z.boolean().nullable().optional(),
})

export type DraftAdviceRecommendation = z.infer<typeof DraftAdviceRecommendationSchema>
export type DraftAdvice = z.infer<typeof DraftAdviceSchema>
export type DeckSummary = z.infer<typeof DeckSummarySchema>
export type DeckCard = z.infer<typeof DeckCardSchema>
export type DeckStats = z.infer<typeof DeckStatsSchema>
export type DeckDetail = z.infer<typeof DeckDetailSchema>

export type AiMode = 'random' | 'mirror' | 'pick'
