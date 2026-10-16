import { useSyncExternalStore } from 'react'
import { createExternalStore } from '@shared/react/create-external-store'
import { greSession, type GreSessionSnapshot } from './gre-session'
import { greStore } from './gre-store'
import type { BoardSnapshot } from './snapshot'

const sessionExternal = createExternalStore(greSession)
const boardExternal = createExternalStore(greStore)

export function useGreSessionSnapshot(): GreSessionSnapshot {
  return useSyncExternalStore(
    sessionExternal.subscribe,
    sessionExternal.getSnapshot,
    sessionExternal.getSnapshot,
  )
}

export function useBoardSnapshot(): BoardSnapshot {
  return useSyncExternalStore(
    boardExternal.subscribe,
    boardExternal.getSnapshot,
    boardExternal.getSnapshot,
  )
}
