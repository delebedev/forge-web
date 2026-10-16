/**
 * TargetSpec is the persistent record of targets confirmed for a stack object.
 * It is intentionally projected into arrows here rather than exposed as raw
 * GRE annotation data to board components.
 */
import type { BoardArrow } from './arrow-view'
import {
  annotationHasType,
  asArray,
  asNumber,
  type GreTables,
  type ProtoObject,
  ZONE_STACK,
} from './gre-state'

export const ANNOTATION_TARGET_SPEC = 26

type TargetSpec = {
  annotationId: number
  affectorId: number
  affectedIds: number[]
}

export function isLiveTargetSpec(annotation: ProtoObject, tables: GreTables): boolean {
  const spec = targetSpec(annotation)
  return spec != null && stackInstanceIds(tables).has(spec.affectorId)
}

/** Derive one relationship edge per selected target, preserving group order. */
export function targetSpecArrows(
  annotations: Iterable<ProtoObject>,
  tables: GreTables,
  viewerSeatId: number,
  opponentSeatId: number,
): BoardArrow[] {
  const stackIds = stackInstanceIds(tables)
  const arrows: BoardArrow[] = []

  for (const annotation of annotations) {
    const spec = targetSpec(annotation)
    if (!spec || !stackIds.has(spec.affectorId)) {
      continue
    }

    for (const [targetIndex, targetId] of spec.affectedIds.entries()) {
      arrows.push({
        id: `target-spec-${spec.annotationId}-${targetIndex}`,
        kind: 'targetSpec',
        from: String(spec.affectorId),
        to: targetKey(targetId, tables, viewerSeatId, opponentSeatId),
      })
    }
  }

  return arrows
}

function targetSpec(annotation: ProtoObject): TargetSpec | null {
  if (!annotationHasType(annotation, ANNOTATION_TARGET_SPEC, 'TargetSpec')) {
    return null
  }
  const annotationId = asNumber(annotation['id'])
  const affectorId = asNumber(annotation['affectorId'])
  const affectedIds = asArray(annotation['affectedIds'])
    .map(asNumber)
    .filter((id) => id > 0)
  if (annotationId <= 0 || affectorId <= 0 || affectedIds.length === 0) {
    return null
  }
  return { annotationId, affectorId, affectedIds }
}

function stackInstanceIds(tables: GreTables): Set<number> {
  return new Set(
    Array.from(tables.zones.values())
      .filter((zone) => zone.type === ZONE_STACK)
      .flatMap((zone) => zone.objectInstanceIds),
  )
}

function targetKey(
  targetId: number,
  tables: GreTables,
  viewerSeatId: number,
  opponentSeatId: number,
): string {
  if (!tables.players.has(targetId)) {
    return String(targetId)
  }
  if (targetId === viewerSeatId) {
    return 'self'
  }
  if (targetId === opponentSeatId) {
    return 'opponent'
  }
  return String(targetId)
}
