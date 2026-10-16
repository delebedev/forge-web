declare const __GIT_SHA__: string
declare const __WEBDOOR_WS_BASE__: string

interface Window {
  umami?: {
    track: (
      name: string,
      data?: Record<string, string | number | boolean>,
    ) => void | Promise<unknown>
    identify: (
      id: string,
      data?: Record<string, string | number | boolean>,
    ) => void | Promise<unknown>
  }
}
