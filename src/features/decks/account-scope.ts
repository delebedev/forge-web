import { useState } from 'react'

export interface AccountScope {
  accountId: string | null
  generation: number
}

/**
 * Advances when a known account gives way to another account or to a guest, so a
 * draft keyed by the generation is discarded. The first session restore or sign-in,
 * from no account to an account, keeps the draft: it belongs to the person signing in.
 */
export function nextAccountScope(scope: AccountScope, accountId: string | null): AccountScope {
  if (scope.accountId === accountId) {
    return scope
  }
  return {
    accountId,
    generation: scope.accountId === null ? scope.generation : scope.generation + 1,
  }
}

/** The account generation for keying a component that holds a per-account draft. */
export function useAccountScope(accountId: string | null): number {
  const [scope, setScope] = useState<AccountScope>({ accountId, generation: 0 })
  const next = nextAccountScope(scope, accountId)
  if (next !== scope) {
    setScope(next)
  }
  return next.generation
}
