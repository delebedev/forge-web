/**
 * The router: matches `routes.ts` against `location`, exposes `path`, `route`,
 * `params`, `query`, `lastMatchPath`, and `navigate`, backed by
 * `useSyncExternalStore` over History API events.
 */

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { updateHead } from '@shared/seo'
import { ROUTES, matchRoute, type RouteName } from '@app/routes'
import { considerSessionReplay } from '@shared/session-replay'

export interface RouterState {
  path: string
  route: RouteName
  params: Record<string, string>
  query: URLSearchParams
  lastMatchPath: string | null
}

export interface RouterApi extends RouterState {
  navigate(path: string, replace?: boolean): void
}

function resolve(lastMatchPath: string | null): RouterState {
  const path = location.pathname
  const query = new URLSearchParams(location.search)

  for (const r of ROUTES) {
    const result = matchRoute(r.pattern, path)
    if (result) {
      const route = r.component as RouteName
      updateHead(route, result.params)
      return {
        path,
        route,
        params: result.params,
        query,
        lastMatchPath: route === 'match' ? path : lastMatchPath,
      }
    }
  }

  updateHead('not-found')
  return { path, route: 'not-found' as RouteName, params: {}, query, lastMatchPath }
}

class RouterStore {
  private state: RouterState
  private listeners = new Set<() => void>()

  constructor() {
    // `resolve()` calls `updateHead()`, which needs `document` — checking
    // `location` alone isn't sufficient, since a non-browser test can define
    // one without the other (e.g. a store-test stubbing `location` for its
    // own unrelated purposes, while this store is pulled in transitively via
    // `reactNavigate`'s importers).
    this.state =
      typeof document !== 'undefined'
        ? resolve(null)
        : {
            path: '/',
            route: 'game' as RouteName,
            params: {},
            query: new URLSearchParams(),
            lastMatchPath: null,
          }
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.sync)
    }
  }

  private sync = (): void => {
    this.state = resolve(this.state.lastMatchPath)
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
