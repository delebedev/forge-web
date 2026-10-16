/**
 * Wraps any `snapshot()`/`subscribe()` source — the shape every store in
 * `lib/stores` and `lib/gre` exposes — into the getSnapshot/subscribe pair
 * `useSyncExternalStore` expects, caching the snapshot so repeated reads
 * within a render return the same value. Used by `shell/stores.ts`,
 * `components/gre/priority-runtime.ts`, and `components/limited/limited-stores.ts`.
 */

export type SnapshotSource<T> = {
  snapshot(): T
  subscribe(listener: () => void): () => void
}

export type ExternalStore<T> = {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  destroy(): void
}

export function createExternalStore<T>(source: SnapshotSource<T>): ExternalStore<T> {
  let snapshot = source.snapshot()
  const listeners = new Set<() => void>()
  const unsubscribeSource = source.subscribe(() => {
    snapshot = source.snapshot()
    for (const listener of listeners) {
      listener()
    }
  })

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    destroy() {
      unsubscribeSource()
      listeners.clear()
    },
  }
}
