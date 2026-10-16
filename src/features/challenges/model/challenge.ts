import type { components } from '@shared/api/types'

type ChallengeSummary = components['schemas']['ChallengeSummary']

export interface Challenge {
  id: string
  name: string
  objective: string
}

export function challengeSummaryToChallenge(summary: ChallengeSummary): Challenge {
  return {
    id: summary.challengeId,
    name: summary.name,
    objective: summary.objective,
  }
}
