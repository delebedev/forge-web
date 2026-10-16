/**
 * Container for the active draft-pack screen. Reads `draftStore` for the
 * live pack/pool and owns the development-only auto-pick effect. The
 * store-free workspace owns presentation state.
 */

import { useEffect, useState } from 'react'
import type { DraftCard } from '@shared/api/contracts'
import { draftStore } from '@features/limited/draft-store'
import { useDraftSnapshot } from '../limited-stores'
import { DraftWorkspace } from './DraftWorkspace'

export function DraftPicking() {
  const draft = useDraftSnapshot()

  const [autoPicking, setAutoPicking] = useState(false)

  // Development shortcut: exercise the real pick endpoint until the draft completes.
  useEffect(() => {
    if (draft.error) {
      setAutoPicking(false)
      return
    }
    if (autoPicking && draft.pack.length > 0 && !draft.picking) {
      void draftStore.pickCard(draft.pack[0]!.name)
    }
    if (autoPicking && draft.pack.length === 0) {
      setAutoPicking(false)
    }
  }, [autoPicking, draft.error, draft.pack, draft.picking])

  function handlePick(card: DraftCard): void {
    if (draft.picking) {
      return
    }
    void draftStore.pickCard(card.name)
  }

  return (
    <DraftWorkspace
      pack={draft.pack}
      pool={draft.pool}
      round={draft.round}
      pick={draft.pick}
      picking={draft.picking}
      error={draft.error}
      autoPicking={autoPicking}
      onPick={handlePick}
      onAutoPick={import.meta.env.DEV ? () => setAutoPicking(true) : undefined}
    />
  )
}
