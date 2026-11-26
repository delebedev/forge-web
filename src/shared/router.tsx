/**
 * The router store: exposes `path`, `route`, `params`, `query`, `lastMatchPath`,
 * and `navigate`, backed by `useSyncExternalStore` over History API events. The
 * application installs its route table with `installRoutes`.
 */

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { considerSessionReplay } from '@shared/observability/session-replay'

export interface RouterState {
  path: string
  route: string
  params: Record<string, string>
  query: URLSearchParams
  lastMatchPath: string | null
}

export interface RouterApi extends RouterState {
  navigate(path: string, replace?: boolean): void
}

/** Resolves the current `location` against the application's route table. */
export type RouteResolver = (lastMatchPath: string | null) => RouterState

class RouterStore {
  private state: RouterState = {
    path: '/',
    route: 'game',
    params: {},
    query: new URLSearchParams(),
    lastMatchPath: null,
  }
  private resolve: RouteResolver | null = null
  private listeners = new Set<() => void>()

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.sync)
    }
  }

  install(resolve: RouteResolver): void {
    this.resolve = resolve
    // Resolution updates the document head, so a non-browser test that defines
    // `location` without `document` keeps the initial state.
    if (typeof document !== 'undefined') {
      this.state = resolve(null)
    }
  }

  private sync = (): void => {
    if (this.resolve) {
      this.state = this.resolve(this.state.lastMatchPath)
    }
    considerSessionReplay()
    for (const listener of this.listeners) {
      listener()
    }
  }

  getSnapshot = (): RouterState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  navigate = (path: string, replace = false): void => {
    const full = location.pathname + location.search
    if (path === full) {
      return
    }
    if (replace) {
      history.replaceState(null, '', path)
    } else {
      history.pushState(null, '', path)
    }
    this.sync()
  }
}

/** One store per page load. */
const routerStore = new RouterStore()

/** Installs the application's route table and resolves the current location. */
export function installRoutes(resolve: RouteResolver): void {
  routerStore.install(resolve)
}

/** Stable identity, importable outside a component — `gre-session.ts` and `stores/auth.ts` navigate through this directly. */
export const reactNavigate: RouterApi['navigate'] = routerStore.navigate

const RouterContext = createContext<RouterStore | null>(null)

export function RouterProvider({ children }: { children: ReactNode }) {
  return <RouterContext.Provider value={routerStore}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterApi {
  const store = useContext(RouterContext)
  if (!store) {
    throw new Error('useRouter must be used within a RouterProvider')
  }
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { ...state, navigate: store.navigate }
}
