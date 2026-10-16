export const DAILY_PUZZLE_COMPLETED_KEY = 'forge:daily-puzzle:completed'

type DailyStorage = Pick<Storage, 'getItem' | 'setItem'>

let completedThisPage = ''

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function hasCompletedDailyPuzzle(
  date = new Date(),
  storage: DailyStorage | null = browserStorage(),
): boolean {
  const day = utcDay(date)
  if (completedThisPage === day) {
    return true
  }
  try {
    return storage?.getItem(DAILY_PUZZLE_COMPLETED_KEY) === day
  } catch {
    return false
  }
}

export function markDailyPuzzleComplete(
  date = new Date(),
  storage: DailyStorage | null = browserStorage(),
): void {
  completedThisPage = utcDay(date)
  try {
    storage?.setItem(DAILY_PUZZLE_COMPLETED_KEY, completedThisPage)
  } catch {
    // The current page still remembers completion when browser storage is unavailable.
  }
}

function browserStorage(): DailyStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
