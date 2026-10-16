import { z } from 'zod'

import type { components } from './types'
import { GreCardMetaDtoSchema } from './wire-schemas'
export {
  DraftCardDtoSchema as DraftCardSchema,
  DecklistCardDtoSchema as DecklistCardSchema,
  ParseDecklistResponseSchema,
  ParseDecklistErrorResponseSchema,
  LimitedSetViewSchema as SealedSetSchema,
} from './wire-schemas'

// Placeholder cards are view values. Fields follow the DTO; metadata may be unresolved.
type WireDraftCard = components['schemas']['DraftCardDto']
export type DraftCard = Omit<WireDraftCard, 'grpId' | 'score'> &
  Partial<Pick<WireDraftCard, 'grpId' | 'score'>> &
  Partial<
    Pick<
      components['schemas']['GreCardMetaDto'],
      'rulesText' | 'power' | 'toughness' | 'loyalty' | 'defense' | 'faceLayout'
    >
  > & { linkedFaces?: components['schemas']['GreCardMetaDto'][] }
export type DecklistCard = components['schemas']['DecklistCardDto']
export type ParseDecklistResponse = components['schemas']['ParseDecklistResponse']
export type ParseDecklistErrorResponse = components['schemas']['ParseDecklistErrorResponse']
export type SealedSet = components['schemas']['LimitedSetView']

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
  grpId: z.number().nullable().optional(),
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
