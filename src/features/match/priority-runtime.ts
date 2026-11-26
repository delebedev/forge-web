/** React subscription to the runtime’s acknowledged priority controls. */

import { useSyncExternalStore } from 'react'
import { priority, type PriorityUiState } from '@engine/priority/priority'
import { createExternalStore } from '@shared/react/create-external-store'

const priorityExternal = createExternalStore({
  snapshot: (): PriorityUiState => priority.uiSnapshot(),
  subscribe: (listener: () => void) => priority.subscribe(listener),
})

export function usePrioritySnapshot(): PriorityUiState {
  return useSyncExternalStore(
    priorityExternal.subscribe,
    priorityExternal.getSnapshot,
    priorityExternal.getSnapshot,
  )
}
