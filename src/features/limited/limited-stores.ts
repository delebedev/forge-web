/**
 * Read side of the store seam for the limited/draft surface: one
 * `createExternalStore` per store, each wrapped in a
 * `useSyncExternalStore` hook. Kept local to `components/limited` rather than
 * `shell/stores.ts` because draft/sealed are only read here, unlike
 * decks/auth/GRE which chrome also reads.
 */

import { useSyncExternalStore } from 'react'
import { draftStore, type DraftSnapshot } from '@features/limited/draft-store'
import { sealedStore, type SealedSnapshot } from '@features/limited/sealed-store'
import { createExternalStore } from '@shared/react/create-external-store'

const draftExternal = createExternalStore(draftStore)
const sealedExternal = createExternalStore(sealedStore)

export function useDraftSnapshot(): DraftSnapshot {
  return useSyncExternalStore(
    draftExternal.subscribe,
    draftExternal.getSnapshot,
    draftExternal.getSnapshot,
  )
}

export function useSealedSnapshot(): SealedSnapshot {
  return useSyncExternalStore(
    sealedExternal.subscribe,
    sealedExternal.getSnapshot,
    sealedExternal.getSnapshot,
  )
}
