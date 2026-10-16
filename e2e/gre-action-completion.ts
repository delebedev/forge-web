/**
 * Browser adapter for action completion. YAML owns gameplay intent and control
 * mode. Reuse its changing result after resolve_stack; an already-met invariant
 * cannot establish completion. A declared next pass_until prompt may be the
 * boundary after automatic resolution, and remains unanswered for the script.
 * The pure request/presentation rules live in action-completion.ts.
 */
import { test, expect, type Page } from '@playwright/test'
import { waitForActionResult, type ActionCompletionState } from './action-completion'

export async function completionState(page: Page): Promise<ActionCompletionState> {
  return page.evaluate(() => {
    const state = window.__greState?.()
    if (!state) {
      throw new Error('gameplay state unavailable')
    }
    return {
      decision: state.horizon ? JSON.stringify(state.horizon) : null,
      request: state.horizon?.respId ?? 0,
      interaction: state.prompt?.interactionKey,
      kind: state.horizon?.kind ?? null,
      stack: state.stack.length,
      lagging: state.presentationLagging,
      waiting: state.prompt?.waiting === true,
      terminal: state.gameOver,
      connected: state.connected,
      errors: state.diagnostics.errorCount,
    }
  })
}

export async function resolveResult(
  page: Page,
  options: {
    before: ActionCompletionState
    result: () => Promise<boolean>
    expected: unknown
    expectedPrompt?: boolean
    nextPrompt?: () => Promise<boolean>
  },
): Promise<void> {
  await test.step('resolve gameplay result', async () => {
    try {
      await waitForActionResult({
        before: options.before,
        read: () => completionState(page),
        result: options.result,
        expectedPrompt: options.expectedPrompt,
        nextPrompt: options.nextPrompt,
        pass: async (decision) => {
          if ((await completionState(page)).decision !== decision) {
            return false
          }
          const scope = page.locator('[data-board]:not([data-stack="0"])')
          const pass = scope
            .getByRole('button', { name: /^(Pass|Resolve|Pass priority)$/ })
            .and(page.locator('button:not([data-action-key])'))
            .filter({ visible: true })
            .first()
          await expect(pass).toBeEnabled({ timeout: 1_000 })
          await pass.click()
          return true
        },
        pause: () => page.waitForTimeout(50),
      })
    } catch (error) {
      const last = await page.evaluate(() => window.__greState?.()).catch(() => null)
      throw new Error(
        `${String(error)}\nExpected: ${JSON.stringify(options.expected)}\nLast gameplay state: ${JSON.stringify(last)}`,
        { cause: error },
      )
    }
  })
}
