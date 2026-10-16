/**
 * The app's single root: it dispatches on `router.route` and decides which
 * views get the authenticated shell chrome around them.
 *
 * `game`, `replay`, `match`, `decks`, and `limited` render inside `AppShell`
 * and need a session.
 *
 * `dev`, `landing`, `about`, `login`, and `not-found` render standalone.
 * `dev` is a bare bootstrap screen
 * that hands off to `/match/:matchId` once a session exists; the rest are
 * public surfaces that must render whether or not a session has resolved.
 */

import { greSession } from '@engine/runtime/gre-session'
import { useRouter } from '@app/router'
import { DecksView } from '@features/decks/DecksView'
import { LandingPage } from '@features/landing/LandingPage'
import { AboutPage } from '@features/about/AboutPage'
import { RoadmapPage } from '@features/roadmap/RoadmapPage'
import { LoginPage } from '@features/auth/LoginPage'
import { NotFoundPage } from '@features/not-found/NotFoundPage'
import { ChallengesView } from '@features/challenges/ChallengesView'
import { BrowserChallenge } from '@features/challenges/BrowserChallenge'
import { AppShell } from '@shell/AppShell'
import { lazy, Suspense } from 'react'
import { GameSetupRoute } from '@features/game-setup/GameSetupRoute'
import { LimitedRoute } from '@features/limited/LimitedRoute'
import { MatchRoute } from '@features/gre/MatchRoute'
import { ReplayView } from '@features/replay/ReplayView'
import { useAuthSnapshot } from '@shared/auth/hooks'
import { REPLAY_ENABLED, SEALED_ENABLED } from '@shared/flags'

const EntryDirections = import.meta.env.DEV
  ? lazy(() =>
      import('@features/dev/EntryDirections').then((module) => ({
        default: module.EntryDirections,
      })),
    )
  : null
const DevLoader = import.meta.env.DEV
  ? lazy(() => import('@features/dev/DevLoader').then((module) => ({ default: module.DevLoader })))
  : null

export function ShellRoot() {
  const router = useRouter()
  const auth = useAuthSnapshot()

  if (router.route === 'landing' || router.route === 'login' || router.route === 'about') {
    return <LandingPage screen={router.route} login={<LoginPage />} about={<AboutPage />} />
  }
  if (router.route === 'roadmap') {
    return <RoadmapPage />
  }
  if (router.route === 'not-found') {
    return <NotFoundPage />
  }
  if (router.route === 'browser-challenge') {
    const id = router.params['challengeId'] ?? ''
    return <BrowserChallenge challengeId={id} />
  }
  if (router.route === 'dev' && DevLoader) {
    return (
      <Suspense fallback={null}>
        <DevLoader
          puzzleId={router.params['puzzleId']}
          deckQuery={router.query.get('deck') ?? undefined}
        />
      </Suspense>
    )
  }
  if (router.route === 'dev-entry' && EntryDirections) {
    return (
      <Suspense fallback={null}>
        <EntryDirections login={<LoginPage preview />} />
      </Suspense>
    )
  }
  if (router.route === 'limited' && router.query.get('mode') === 'sealed' && !SEALED_ENABLED) {
    return <NotFoundPage />
  }
  if (router.route === 'replay' && !REPLAY_ENABLED) {
    return <NotFoundPage />
  }

  // Hold the shell until the session resolves. Views
  // inside it read the player id on mount and do not retry, so rendering them
  // against an unresolved session silently produces an empty page — the deck
  // list fetched with no player and stayed empty for the life of the route.
  //
  // `replay` is exempt: a transcript is a file, not a session, and it reads no
  // player id. Gating it would make a viewer that needs no backend unreachable
  // without one.
  if (router.route !== 'replay' && router.route !== 'challenges' && !auth.isAuthenticated) {
    return auth.ready ? (
      <LandingPage screen="login" login={<LoginPage />} about={<AboutPage />} />
    ) : null
  }

  return (
    <AppShell onLeaveMatch={() => void greSession.leave()}>
      {router.route === 'game' && <GameSetupRoute />}
      {router.route === 'replay' && <ReplayView />}
      {router.route === 'match' && <MatchRoute />}
      {router.route === 'decks' && <DecksView initialDeckId={router.params['deckId']} />}
      {router.route === 'limited' && <LimitedRoute />}
      {router.route === 'challenges' && (
        <ChallengesView challengeId={router.params['challengeId']} />
      )}
    </AppShell>
  )
}
