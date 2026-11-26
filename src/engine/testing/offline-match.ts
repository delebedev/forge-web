import { RetiredReplayDeliveries } from '@engine/replay/retired-replay-deliveries'
import { GreStore, type GreStoreDependencies } from '@engine/runtime/gre-store'

/** Acknowledges every replay chunk the way the replay endpoint commits it. */
export const acknowledgingReplayUpload = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const chunk = JSON.parse(String(init?.body)) as { events: { seq: number }[] }
  const after = Number((init?.headers as Record<string, string>)['X-Replay-After-Seq'])
  return new Response(String(chunk.events.at(-1)?.seq ?? after))
}) as typeof fetch

/**
 * Match-store dependencies that keep a test off the network and the page report
 * budget. Overrides replace single dependencies a test observes.
 */
export function offlineStoreDependencies(
  overrides: Partial<GreStoreDependencies> = {},
): GreStoreDependencies {
  const report = overrides.report ?? (() => {})
  return {
    replayUpload: acknowledgingReplayUpload,
    retiredReplays: new RetiredReplayDeliveries(report),
    ...overrides,
    report,
  }
}

export function offlineGreStore(overrides: Partial<GreStoreDependencies> = {}): GreStore {
  return new GreStore(offlineStoreDependencies(overrides))
}
