import { useSyncExternalStore } from 'react'
import { createExternalStore } from '@shared/react/create-external-store'
import { authStore, type AuthSnapshot } from './auth'

const authExternal = createExternalStore(authStore)

export function useAuthSnapshot(): AuthSnapshot {
  return useSyncExternalStore(
    authExternal.subscribe,
    authExternal.getSnapshot,
    authExternal.getSnapshot,
  )
}
