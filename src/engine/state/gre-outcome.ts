import { outcomeDetail, outcomeTitle, type ViewerResult } from './gre-labels'
import { asNumber, isRecord, type ProtoObject } from './gre-state'

export type GameOutcome = {
  resultType: number
  reason: number
  winningTeamId: number
  viewerTeamId: number
  viewerResult: ViewerResult
  title: string
  detail: string
}

export function outcomeFromIntermission(
  intermission: ProtoObject | null,
  viewerTeamId: number,
): GameOutcome | null {
  const result = intermission?.['result']
  return isRecord(result) ? outcomeFromResult(result, viewerTeamId) : null
}

export function outcomeFromResults(results: unknown[], viewerTeamId: number): GameOutcome | null {
  const result =
    results.find((value) => isRecord(value) && asNumber(value['scope']) === 2) ??
    results.find((value) => isRecord(value))
  return isRecord(result) ? outcomeFromResult(result, viewerTeamId) : null
}

function outcomeFromResult(result: ProtoObject, viewerTeamId: number): GameOutcome {
  const resultType = asNumber(result['result'])
  const reason = asNumber(result['reason'])
  const winningTeamId = asNumber(result['winningTeamId'])
  const viewerResult = viewerResultFor(resultType, winningTeamId, viewerTeamId)
  const title = outcomeTitle(viewerResult, winningTeamId)
  const detail = outcomeDetail(viewerResult, winningTeamId, reason)
  return { resultType, reason, winningTeamId, viewerTeamId, viewerResult, title, detail }
}

function viewerResultFor(
  resultType: number,
  winningTeamId: number,
  viewerTeamId: number,
): ViewerResult {
  if (resultType === 2) {
    return 'draw'
  }
  if (resultType !== 3 || winningTeamId <= 0 || viewerTeamId <= 0) {
    return 'unknown'
  }
  return winningTeamId === viewerTeamId ? 'win' : 'loss'
}
