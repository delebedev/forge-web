/**
 * ObjectIdChanged id chain — traces a game object across zone transfers even
 * when its instanceId changes (e.g. a card leaving the stack and re-entering
 * play under a new id). The presentation read-model uses it to keep a move
 * connected to its prior card when the protocol reallocates the id.
 */
import {
  ANNOTATION_OBJECT_ID_CHANGED,
  annotationHasType,
  asArray,
  asNumber,
  isRecord,
  type ProtoObject,
} from './gre-state'

export type IdChain = {
  /** old instanceId -> new instanceId */
  forward: Map<number, number>
  /** new instanceId -> old instanceId */
  backward: Map<number, number>
}

export const EMPTY_ID_CHAIN: IdChain = { forward: new Map(), backward: new Map() }

/** Fold ObjectIdChanged annotations from one GSM frame into the chain. Reset to
 *  EMPTY_ID_CHAIN on Full frames (caller's responsibility — mirrors applyGsm). */
export function processIdChanges(chain: IdChain, annotations: ProtoObject[]): IdChain {
  let forward = chain.forward
  let backward = chain.backward
  let changed = false
  for (const annotation of annotations) {
    if (!isObjectIdChanged(annotation)) {
      continue
    }
    const { origId, newId } = idChangeDetails(annotation)
    if (origId == null || newId == null) {
      continue
    }
    if (!changed) {
      forward = new Map(forward)
      backward = new Map(backward)
      changed = true
    }
    forward.set(origId, newId)
    backward.set(newId, origId)
  }
  return changed ? { forward, backward } : chain
}

/** Resolve an instanceId to its latest id by following the forward chain. */
export function resolveId(chain: IdChain, instanceId: number): number {
  let current = instanceId
  const seen = new Set<number>()
  while (chain.forward.has(current)) {
    if (seen.has(current)) {
      break
    } // cycle guard
    seen.add(current)
    current = chain.forward.get(current)!
  }
  return current
}

/** Trace an instanceId back to its original id, oldest-first. */
export function traceBack(chain: IdChain, instanceId: number): number[] {
  const trail = [instanceId]
  let current = instanceId
  const seen = new Set<number>()
  while (chain.backward.has(current)) {
    if (seen.has(current)) {
      break
    } // cycle guard
    seen.add(current)
    current = chain.backward.get(current)!
    trail.unshift(current)
  }
  return trail
}

function isObjectIdChanged(annotation: ProtoObject): boolean {
  return annotationHasType(annotation, ANNOTATION_OBJECT_ID_CHANGED, 'ObjectIdChanged')
}

function idChangeDetails(annotation: ProtoObject): { origId: number | null; newId: number | null } {
  let origId: number | null = null
  let newId: number | null = null
  for (const detail of asArray(annotation['details'])) {
    if (!isRecord(detail)) {
      continue
    }
    if (detail['key'] === 'orig_id') {
      origId = firstDetailValue(detail)
    }
    if (detail['key'] === 'new_id') {
      newId = firstDetailValue(detail)
    }
  }
  return { origId, newId }
}

function firstDetailValue(detail: ProtoObject): number | null {
  const int32 = asArray(detail['valueInt32'])
  if (int32.length > 0) {
    return asNumber(int32[0])
  }
  const uint32 = asArray(detail['valueUint32'])
  if (uint32.length > 0) {
    return asNumber(uint32[0])
  }
  return null
}
