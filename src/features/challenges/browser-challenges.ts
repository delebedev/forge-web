import challenges from './browser-challenges.generated.json' with { type: 'json' }

export const BROWSER_CHALLENGES = challenges

export function browserChallenge(id: string) {
  return BROWSER_CHALLENGES.find((challenge) => challenge.id === id)
}

export function nextBrowserChallenge(id: string) {
  const index = BROWSER_CHALLENGES.findIndex((challenge) => challenge.id === id)
  return BROWSER_CHALLENGES[(index + 1) % BROWSER_CHALLENGES.length]!
}

export function browserChallengePath(id: string): string {
  return `/challenge/${id}`
}

export function dailyBrowserChallengeId(date = new Date()): string {
  const day = Math.floor(date.getTime() / 86_400_000)
  return BROWSER_CHALLENGES[day % BROWSER_CHALLENGES.length]!.id
}

export function dailyBrowserChallengePath(date = new Date()): string {
  return browserChallengePath(dailyBrowserChallengeId(date))
}
