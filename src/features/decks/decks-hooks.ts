import { useSyncExternalStore } from 'react'
import { createExternalStore } from '@shared/react/create-external-store'
import { decksStore, type DecksSnapshot } from './decks-store'

const decksExternal = createExternalStore(decksStore)

export function useDecksSnapshot(): DecksSnapshot {
  return useSyncExternalStore(
    decksExternal.subscribe,
    decksExternal.getSnapshot,
    decksExternal.getSnapshot,
  )
}
