import type { BrowserGreState } from './types'

declare global {
  interface Window {
    __greState?: () => BrowserGreState | null
    __greBrowserAdvice?: () => Promise<unknown>
  }
}
