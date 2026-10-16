import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from '@app/router'
import { trackWhatsNewClosed, trackWhatsNewOpened } from '@shared/analytics'
import { useAuthSnapshot } from '@shared/auth/hooks'
import { useBoardSnapshot, useGreSessionSnapshot } from '@engine/runtime/hooks'
import { loadWhatsNew, type WhatsNewDay } from './feed'
import { WhatsNewModal } from './WhatsNewModal'
import { WhatsNewSeenState } from './seen'

type ManualSource = 'landing' | 'header'
type OpenSource = ManualSource | 'auto'

interface WhatsNewContextValue {
  openWhatsNew: (source: ManualSource) => void
}

interface OpenState {
  source: OpenSource
  accountId: string | null
  presented: boolean
}

export interface WhatsNewAutoEligibility {
  developmentBuild: boolean
  route: string
  ready: boolean
  authenticated: boolean
  guest: boolean
  accountId: string | null
  activePlayerMatch: boolean
  anotherDialogOpen: boolean
  latestDate: string
}

export function shouldAutoPresentWhatsNew(input: WhatsNewAutoEligibility): boolean {
  return (
    !input.developmentBuild &&
    input.ready &&
    input.authenticated &&
    !input.guest &&
    Boolean(input.accountId) &&
    (input.route === 'game' || input.route === 'decks') &&
    !input.activePlayerMatch &&
    !input.anotherDialogOpen &&
    Boolean(input.latestDate)
  )
}

const WhatsNewContext = createContext<WhatsNewContextValue | null>(null)

export function WhatsNewProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const auth = useAuthSnapshot()
  const board = useBoardSnapshot()
  const session = useGreSessionSnapshot()
  const [opening, setOpening] = useState<OpenState | null>(null)
  const [days, setDays] = useState<WhatsNewDay[]>([])
  const [feedReady, setFeedReady] = useState(false)
  const openingRef = useRef<OpenState | null>(null)
  const seenState = useMemo(() => new WhatsNewSeenState(), [])
  const latestDate = days[0]?.date ?? ''

  useEffect(() => {
    let active = true
    void loadWhatsNew().then((loaded) => {
      if (active) {
        setDays(loaded)
        setFeedReady(true)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const openWhatsNew = useCallback(
    (source: ManualSource): void => {
      if (openingRef.current) {
        return
      }
      const next: OpenState = {
        source,
        accountId: auth.isAuthenticated && !auth.guest ? (auth.player?.id ?? null) : null,
        presented: false,
      }
      openingRef.current = next
      setOpening(next)
    },
    [auth.guest, auth.isAuthenticated, auth.player?.id],
  )

  const closeWhatsNew = useCallback((): void => {
    const current = openingRef.current
    if (!current) {
      return
    }
    openingRef.current = null
    trackWhatsNewClosed({ source: current.source, latestDate })
    setOpening(null)
  }, [latestDate])

  const markPresented = useCallback((): void => {
    const current = openingRef.current
    if (!current || current.presented) {
      return
    }
    current.presented = true
    trackWhatsNewOpened({ source: current.source, latestDate })
    if (current.accountId && latestDate) {
      seenState.markSeen(current.accountId, latestDate)
    }
  }, [latestDate, seenState])

  const activePlayerMatch = Boolean(
    session.config?.matchId && !session.isSpectator && !board.gameOver,
  )

  useEffect(() => {
    const accountId = auth.player?.id ?? null
    if (
      !feedReady ||
      openingRef.current ||
      !shouldAutoPresentWhatsNew({
        developmentBuild: import.meta.env.DEV,
        route: router.route,
        ready: auth.ready,
        authenticated: auth.isAuthenticated,
        guest: auth.guest,
        accountId,
        activePlayerMatch,
        anotherDialogOpen:
          typeof document !== 'undefined' && Boolean(document.querySelector('[role="dialog"]')),
        latestDate,
      })
    ) {
      return
    }
    if (!accountId || seenState.hasSeen(accountId, latestDate)) {
      return
    }
    const next: OpenState = { source: 'auto', accountId, presented: false }
    openingRef.current = next
    setOpening(next)
  }, [
    activePlayerMatch,
    auth.guest,
    auth.isAuthenticated,
    auth.player?.id,
    auth.ready,
    feedReady,
    latestDate,
    router.route,
    seenState,
  ])

  return (
    <WhatsNewContext.Provider value={{ openWhatsNew }}>
      {children}
      {opening && (
        <div className="public-theme">
          <WhatsNewModal open days={days} onClose={closeWhatsNew} onPresented={markPresented} />
        </div>
      )}
    </WhatsNewContext.Provider>
  )
}

export function useWhatsNew(): WhatsNewContextValue {
  const value = useContext(WhatsNewContext)
  if (!value) {
    throw new Error('useWhatsNew must be used within WhatsNewProvider')
  }
  return value
}
