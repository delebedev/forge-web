import { expect, test } from 'bun:test'
import { fullControlOf, stopsOf, yieldingOf } from './priority-policy'

test('explicit stops preserve phase and turn scope, ignoring baseline preferences', () => {
  expect(
    stopsOf({
      stops: [{ stopType: 3, appliesTo: 3, status: 1 }],
      transientStops: [
        { stopType: 1, appliesTo: 2, status: 1 },
        { stopType: 11, appliesTo: 3, status: 1 },
        { stopType: 10, appliesTo: 1, status: 1 },
        { stopType: 2, appliesTo: 3, status: 2 },
      ],
    }),
  ).toEqual(new Set(['opponent:upkeep', 'self:firststrike', 'self:end', 'opponent:end']))
})

test('normal self resolution is not a cancellable turn or stack yield', () => {
  expect(yieldingOf({ autoPassOption: 6 })).toBe(false)
  expect(yieldingOf({ autoPassOption: 5 })).toBe(true)
  expect(yieldingOf({ stackAutoPassOption: 9 })).toBe(true)
  expect(fullControlOf({ autoPassOption: 7 })).toBe(true)
  expect(fullControlOf({ autoPassOption: 4 })).toBe(false)
})
