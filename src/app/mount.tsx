import { ErrorBoundary } from '@sentry/react'
import { greStore } from '@engine/runtime/gre-store'
import { setReportingContext } from '@shared/reporting'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@app/router'
import { ShellRoot } from './ShellRoot'
import { WhatsNewProvider } from '@features/whats-new/WhatsNewController'

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
