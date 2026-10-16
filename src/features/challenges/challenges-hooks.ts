import { useSyncExternalStore } from 'react'
import { createExternalStore } from '@shared/react/create-external-store'
import { challengesStore, type ChallengesSnapshot } from './challenges-store'

const challengesExternal = createExternalStore(challengesStore)

export function useChallengesSnapshot(): ChallengesSnapshot {
  return useSyncExternalStore(
    challengesExternal.subscribe,
    challengesExternal.getSnapshot,
    challengesExternal.getSnapshot,
  )
}
