import { ErrorBoundary } from '@sentry/react'
import { greStore } from '@engine/runtime/gre-store'
import { setReportingContext } from '@shared/observability/reporting'
import { createRoot } from 'react-dom/client'
import { RouterProvider, installRoutes } from '@shared/router'
import { resolveRoute } from './routes'
import { ShellRoot } from './ShellRoot'
import { WhatsNewProvider } from '@features/whats-new/WhatsNewController'

installRoutes(resolveRoute)

/** One React root for the whole app. */
export function mountApp(target: HTMLElement): void {
  const updateReportingContext = () => setReportingContext(greStore.reportingContext())
  updateReportingContext()
  greStore.subscribe(updateReportingContext)
  createRoot(target).render(
    <ErrorBoundary fallback={<></>}>
      <RouterProvider>
        <WhatsNewProvider>
          <ShellRoot />
        </WhatsNewProvider>
      </RouterProvider>
    </ErrorBoundary>,
  )
}
