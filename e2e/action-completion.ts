/**
 * Wait for a changing gameplay result and a fresh presented request, or terminal
 * outcome. Request IDs must advance beyond the input and every submitted pass;
 * a newer game-state frame can still retain a stale request. Pending response
 * echoes and presentation lag cannot complete an action.
 * Pass nonempty stack priority once per request. Leave choices to the caller;
 * an expected prompt is an explicit boundary. Poll promptly, with bounded
 * failure timeouts and no mandatory silence window after success.
 */
/** A decision is identified by its request horizon, not merely its game-state ID. */
export type ActionCompletionState = {
  request: number
  decision: string | null
  interaction?: number
  kind: string | null
  stack: number
  waiting: boolean
  lagging: boolean
  terminal: boolean
  connected: boolean
  errors: number
}

/** Resolve only stack priority. Choices remain the scenario's responsibility. */
export async function waitForActionResult(options: {
  before: ActionCompletionState
  read: () => Promise<ActionCompletionState>
  result: () => Promise<boolean>
  pass: (decision: string) => Promise<boolean>
  pause: () => Promise<void>
  now?: () => number
  timeout?: number
  expectedPrompt?: boolean
  nextPrompt?: () => Promise<boolean>
}): Promise<void> {
  const now = options.now ?? Date.now
  const deadline = now() + (options.timeout ?? 20_000)
  let submittedRequest = options.before.request
  let state = options.before
  while (now() < deadline) {
    state = await options.read()
    const diagnostics = () => JSON.stringify({ before: options.before, last: state })
    if (state.errors > options.before.errors) {
      throw new Error(`gameplay action rejected: ${diagnostics()}`)
    }
    if (!state.connected && !state.terminal) {
      throw new Error(`gameplay action disconnected: ${diagnostics()}`)
    }
    const fresh =
      state.request > submittedRequest &&
      state.decision !== null &&
      state.decision !== options.before.decision
    if (!state.lagging && !state.waiting && (fresh || state.terminal)) {
      const result = await options.result()
      if (
        result &&
        (state.terminal ||
          (options.expectedPrompt
            ? state.kind !== 'actions'
            : state.stack === 0 && (state.kind === 'actions' || (await options.nextPrompt?.()))))
      ) {
        return
      }
      if (state.kind !== 'actions' && !state.terminal) {
        throw new Error(`Unexpected gameplay decision: ${diagnostics()}`)
      }
      if (state.kind === 'actions' && state.stack > 0) {
        if (await options.pass(state.decision!)) {
          submittedRequest = state.request
        }
      }
    }
    await options.pause()
  }
  throw new Error(
    `gameplay result timed out: ${JSON.stringify({ before: options.before, last: state })}`,
  )
}
