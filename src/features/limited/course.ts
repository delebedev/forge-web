import {
  saveCourse,
  type Course,
  type CourseDeckRow,
  type CourseDocument,
} from '@shared/api/course-records'
import { toWebDeckCards } from '@shared/cards/catalog'

/** The decks and course identity a limited game launches with. */
export type LimitedMatchLaunch = {
  seat1Deck: string
  seat2Deck: string
  courseEvent: string
  courseGame: number
}

export const draftEventName = (set: string) => `QuickDraft_${set}_20260223`
export const sealedEventName = (set: string) => `Sealed_${set}_20260307`

/** A fresh seed for a new draft or sealed pool. */
export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}

export function emptyCourse(
  kind: CourseDocument['kind'],
  set: string,
  seed: number,
  catalogVersion: string,
): CourseDocument {
  return {
    kind,
    set,
    seed,
    picks: [],
    catalogVersion,
    pool: [],
    deck: null,
    botDecks: [],
    wins: 0,
    losses: 0,
    phase: kind === 'draft' ? 'drafting' : 'deck_build',
  }
}

function deckText(main: CourseDeckRow[], sideboard: CourseDeckRow[] = []): string {
  const rows = (cards: CourseDeckRow[]) => cards.map((card) => `${card.quantity} ${card.cardName}`)
  return [
    '[Deck]',
    ...rows(main),
    ...(sideboard.length ? ['[Sideboard]', ...rows(sideboard)] : []),
  ].join('\n')
}

/**
 * The next game of a course. Draft opponents take the pod's bot decks in seat
 * order; sealed has no pod, so the opponent plays a copy of the player's deck.
 */
export function courseMatch(course: Course): LimitedMatchLaunch {
  const { deck, botDecks, wins, losses } = course.document
  if (!deck) {
    throw new Error('Build a deck before playing.')
  }
  const game = wins + losses
  const seat1Deck = deckText(deck.mainDeck, deck.sideboard)
  const bot = botDecks.length ? botDecks[game % botDecks.length]! : null
  return {
    seat1Deck,
    seat2Deck: bot ? deckText(toWebDeckCards(bot)) : seat1Deck,
    courseEvent: course.eventName,
    courseGame: game,
  }
}

/** Saves the submitted deck and returns the course with the launch for its next game. */
export async function submitCourseDeck(
  course: Course,
  mainboard: string[],
  sideboard: string[],
): Promise<{ course: Course; launch: LimitedMatchLaunch }> {
  if (course.document.phase === 'finished') {
    throw new Error('This course is complete. Start a new one to play again.')
  }
  const saved = await saveCourse({
    ...course,
    document: {
      ...course.document,
      deck: { mainDeck: toWebDeckCards(mainboard), sideboard: toWebDeckCards(sideboard) },
      phase: 'games',
    },
  })
  return { course: saved, launch: courseMatch(saved) }
}
