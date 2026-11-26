import { expect, test } from 'bun:test'
import { CourseRecordStore } from './course-records.ts'
import { testDatabase } from './test/test-support.ts'

const EVENT = 'QuickDraft_FDN_20260101'
const store = (maxDocumentBytes?: number, maxAccountBytes?: number) =>
  new CourseRecordStore(testDatabase(), maxDocumentBytes, maxAccountBytes)

test('saves advance the revision and a stale revision conflicts', () => {
  const records = store()
  expect(() => records.save('p1', EVENT, 1, '{"a":1}')).toThrow('changed in another window')
  expect(records.save('p1', EVENT, 0, '{"a":1}').revision).toBe(1)
  expect(() => records.save('p1', EVENT, 0, '{"a":2}')).toThrow('changed in another window')
  expect(records.save('p1', EVENT, 1, '{"a":2}').revision).toBe(2)
  expect(records.find('p1', EVENT)?.document).toBe('{"a":2}')
  expect(records.find('p2', EVENT)).toBeNull()
  expect(records.list('p1').map((record) => record.eventName)).toEqual([EVENT])
  expect(() => records.delete('p1', EVENT, 1)).toThrow('changed in another window')
  expect(records.delete('p1', EVENT, 2)).toBe(true)
  expect(records.delete('p1', EVENT, 2)).toBe(false)
  expect(records.find('p1', EVENT)).toBeNull()
  expect(records.list('p1')).toEqual([])
})

test('a recreated course does not accept a revision read before the delete', () => {
  const records = store()
  records.save('p1', EVENT, 0, '{"a":1}')
  records.delete('p1', EVENT, 1)
  expect(() => records.save('p1', EVENT, 1, '{"stale":1}')).toThrow('changed in another window')
  expect(records.save('p1', EVENT, 0, '{"a":2}').revision).toBe(3)
  expect(() => records.save('p1', EVENT, 1, '{"stale":1}')).toThrow('changed in another window')
})

test('documents must be JSON objects with a valid event name', () => {
  const records = store()
  for (const document of ['[]', '1', 'not json', '']) {
    expect(() => records.save('p1', EVENT, 0, document)).toThrow(
      'A course document must be a JSON object',
    )
  }
  expect(() => records.save('p1', 'bad-name', 0, '{}')).toThrow('Invalid event name')
})

test('documents are limited per record and per account', () => {
  const records = store(16, 24)
  expect(() => records.save('p1', EVENT, 0, `{"a":"${'x'.repeat(16)}"}`)).toThrow(
    'A course document is limited to 16 bytes',
  )
  records.save('p1', 'Sealed_A', 0, `{"a":"${'x'.repeat(6)}"}`)
  expect(() => records.save('p1', 'Sealed_B', 0, `{"a":"${'x'.repeat(6)}"}`)).toThrow(
    'Saved courses are limited to 24 bytes per account',
  )
  expect(records.save('p1', 'Sealed_A', 1, `{"a":"${'y'.repeat(6)}"}`).revision).toBe(2)
})
