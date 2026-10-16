import { ANALYTICS_RELEASE, analyticsTraffic, trackBugReportOpened } from './analytics'
import type { GreCloseCategory } from '@engine/runtime/gre-transport'

const TALLY_FORM = 'https://tally.so/r/pbGADP'

export function productionFeedbackEnabled(): boolean {
  return typeof window !== 'undefined' && window.location?.origin === 'https://forgeweb.app'
}

export type BugReportContext = {
  source: 'sidebar' | 'header' | 'board' | 'roadmap'
  accountId?: string
  matchId?: string
  deckId?: string
  closeCategory?: GreCloseCategory
  closeCode?: number
  connectionStatus?: 'connected' | 'disconnected'
  execution?: 'server' | 'browser'
  attemptId?: string
  frontendBuild?: string
  engineBuild?: string
}

export type BugReport = BugReportContext & { reportId: string; url: string }

export function prepareBugReport(context: BugReportContext): BugReport {
  const reportId = crypto.randomUUID()
  if (!productionFeedbackEnabled()) {
    return { ...context, reportId, url: '/about#contact-title' }
  }
  const params = new URLSearchParams({
    report_id: reportId,
    release: ANALYTICS_RELEASE,
    source: context.source,
    traffic: analyticsTraffic(),
  })
  if (context.accountId) {
    params.set('account_id', context.accountId)
  }
  if (context.matchId) {
    params.set('match_id', context.matchId)
  }
  if (context.execution) {
    params.set('execution', context.execution)
  }
  if (context.attemptId) {
    params.set('attempt_id', context.attemptId)
  }
  if (context.frontendBuild) {
    params.set('frontend_build', context.frontendBuild)
  }
  if (context.engineBuild) {
    params.set('engine_build', context.engineBuild)
  }
  if (context.deckId) {
    params.set('deck_id', context.deckId)
  }
  return { ...context, reportId, url: `${TALLY_FORM}?${params}` }
}

export function trackBugReportOpen(report: BugReport): void {
  if (!productionFeedbackEnabled()) {
    return
  }
  trackBugReportOpened({
    reportId: report.reportId,
    source: report.source,
    accountId: report.accountId,
    matchId: report.matchId,
    deckId: report.deckId,
    closeCategory: report.closeCategory,
    closeCode: report.closeCode,
    connectionStatus: report.connectionStatus,
  })
}

export function createBugReport(context: BugReportContext): BugReport {
  const report = prepareBugReport(context)
  trackBugReportOpen(report)
  return report
}
