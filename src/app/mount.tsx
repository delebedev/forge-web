import { ErrorBoundary } from '@sentry/react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@app/router'
import { ShellRoot } from './ShellRoot'
import { WhatsNewProvider } from '@features/whats-new/WhatsNewController'

/** One React root for the whole app. */
export function mountApp(target: HTMLElement): void {
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
