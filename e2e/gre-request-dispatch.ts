import { errors, type Locator } from '@playwright/test'
import type { ActionCompletionState } from './action-completion'

export type ControlDispatch = (control: Locator) => Promise<boolean>

export async function clickControl(control: Locator): Promise<boolean> {
  await control.click({ timeout: 1_000 })
  return true
}

/** Semantic activation only: pointer hit testing belongs to native-pointer scenarios. */
export function requestDispatch(
  expected: ActionCompletionState,
  goalReached: () => Promise<boolean>,
): ControlDispatch {
  return async (control) => {
    if (await goalReached()) {
      return false
    }
    try {
      // Validation and activation share one browser task so locator waits cannot
      // submit a replacement decision after an asynchronous engine response.
      return await control.evaluate(
        (element, before) => {
          const state = window.__greState?.()
          if (
            !state?.connected ||
            state.gameOver ||
            state.presentationLagging ||
            state.prompt?.waiting ||
            !before.request ||
            state.horizon?.respId !== before.request ||
            JSON.stringify(state.horizon) !== before.decision ||
            state.prompt?.interactionKey !== before.interaction ||
            !element.isConnected ||
            element.matches(':disabled')
          ) {
            return false
          }
          ;(element as HTMLElement).click()
          return true
        },
        expected,
        { timeout: 100 },
      )
    } catch (error) {
      if (error instanceof errors.TimeoutError) {
        return false
      }
      throw error
    }
  }
}
