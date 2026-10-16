import { expect, test } from 'bun:test'
import { EMPTY_ID_CHAIN, processIdChanges, resolveId, traceBack } from './gre-id-chain'
import { ANNOTATION_OBJECT_ID_CHANGED } from './gre-state'

/**
 * Annotation `type` is numeric on the wire (`gre-proto.ts` decodes with
 * `enums: Number`). These fixtures use the number deliberately: a predicate
 * matching only the 'ObjectIdChanged' string leaves the chain permanently
 * empty in production while a string-typed fixture would still go green.
 */
function idChanged(
  origId: number,
  newId: number,
  type: number | string = ANNOTATION_OBJECT_ID_CHANGED,
) {
  return {
    type: [type],
    details: [
      { key: 'orig_id', valueInt32: [origId] },
      { key: 'new_id', valueInt32: [newId] },
    ],
  }
}

test('a numerically-typed ObjectIdChanged annotation populates both directions', () => {
  const chain = processIdChanges(EMPTY_ID_CHAIN, [idChanged(100, 200)])

  expect(chain.forward.get(100)).toBe(200)
  expect(chain.backward.get(200)).toBe(100)
})

test('the enum name is accepted too, for fixtures that carry it', () => {
  const chain = processIdChanges(EMPTY_ID_CHAIN, [idChanged(100, 200, 'ObjectIdChanged')])

  expect(chain.forward.get(100)).toBe(200)
})

test('unrelated annotations leave the chain untouched by identity', () => {
  const chain = processIdChanges(EMPTY_ID_CHAIN, [{ type: [1], details: [] }])

  expect(chain).toBe(EMPTY_ID_CHAIN)
})

test('resolveId walks a multi-hop chain to the newest id', () => {
  let chain = processIdChanges(EMPTY_ID_CHAIN, [idChanged(100, 200)])
  chain = processIdChanges(chain, [idChanged(200, 300)])

  expect(resolveId(chain, 100)).toBe(300)
  expect(resolveId(chain, 300)).toBe(300)
  expect(resolveId(chain, 999)).toBe(999)
})

test('traceBack returns the lineage oldest-first', () => {
  let chain = processIdChanges(EMPTY_ID_CHAIN, [idChanged(100, 200)])
  chain = processIdChanges(chain, [idChanged(200, 300)])

  expect(traceBack(chain, 300)).toEqual([100, 200, 300])
})

test('a cyclic chain terminates instead of hanging', () => {
  let chain = processIdChanges(EMPTY_ID_CHAIN, [idChanged(100, 200)])
  chain = processIdChanges(chain, [idChanged(200, 100)])

  expect(resolveId(chain, 100)).toBeGreaterThan(0)
  expect(traceBack(chain, 100).length).toBeGreaterThan(0)
})

test('valueUint32 details are read as well as valueInt32', () => {
  const chain = processIdChanges(EMPTY_ID_CHAIN, [
    {
      type: [ANNOTATION_OBJECT_ID_CHANGED],
      details: [
        { key: 'orig_id', valueUint32: [100] },
        { key: 'new_id', valueUint32: [200] },
      ],
    },
  ])

  expect(chain.forward.get(100)).toBe(200)
})
