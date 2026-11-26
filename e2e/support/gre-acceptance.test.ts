import { expect, test } from 'bun:test'
import type { Page } from '@playwright/test'
import { acceptanceSide, annotationSeen, targetDecisionRetired } from './gre-acceptance'

test('priority conditions accept only declared player sides', () => {
  expect(acceptanceSide('ours', 'priority')).toBe('ours')
  expect(acceptanceSide('opponent', 'priority')).toBe('opponent')
  for (const value of ['our', 'opponents', '', 1, null]) {
    expect(() => acceptanceSide(value, 'priority')).toThrow('Unsupported priority side')
  }
})

type Annotation = NonNullable<ReturnType<Window['__greState']>>['annotations'][number]

function annotationPage(annotations: Annotation[], enumValue = 99): Page {
  return {
    evaluate: async (_callback: unknown, argument?: unknown) =>
      argument == null ? annotations : enumValue,
  } as unknown as Page
}

test('direct annotation expectations inspect current scenario telemetry', async () => {
  const page = annotationPage([
    { seq: 4, gsId: 10, phase: 'Main1', turn: 1, types: ['TargetSpec'], details: {} },
    { seq: 6, gsId: 12, phase: 'Main1', turn: 1, types: ['ManaPaid'], details: {} },
  ])

  expect(await annotationSeen(page, 'TargetSpec', { annotationSeq: -1 })).toBe(true)
  expect(await annotationSeen(page, 'ManaPaid', { annotationSeq: -1 })).toBe(true)
})

test('pass-until annotation expectations require telemetry newer than the wait baseline', async () => {
  const beforeEcho = annotationPage([
    { seq: 8, gsId: 20, phase: 'Main1', turn: 2, types: ['CounterAdded'], details: {} },
  ])
  const afterEcho = annotationPage([
    { seq: 8, gsId: 20, phase: 'Main1', turn: 2, types: ['CounterAdded'], details: {} },
    { seq: 9, gsId: 21, phase: 'Main1', turn: 2, types: ['CounterAdded'], details: {} },
  ])

  expect(await annotationSeen(beforeEcho, 'CounterAdded', { annotationSeq: 8 })).toBe(false)
  expect(await annotationSeen(afterEcho, 'CounterAdded', { annotationSeq: 8 })).toBe(true)
})

test('detail-bearing annotation expectations require exact values', async () => {
  const page = annotationPage([
    {
      seq: 3,
      gsId: 7,
      phase: 'Main1',
      turn: 1,
      types: ['AbilityWordActive'],
      details: { AbilityWordName: ['Devotion'], value: [5], threshold: [5] },
    },
  ])

  expect(
    await annotationSeen(
      page,
      {
        type: 'AbilityWordActive',
        details: { AbilityWordName: 'Devotion', value: 5, threshold: 5 },
      },
      { annotationSeq: -1 },
    ),
  ).toBe(true)
  expect(
    await annotationSeen(
      page,
      {
        type: 'AbilityWordActive',
        details: { AbilityWordName: 'Descend' },
      },
      { annotationSeq: -1 },
    ),
  ).toBe(false)
})

test('target selection echoes do not retire the target decision', () => {
  const targetEcho = {
    request: 12,
    decision: '{"kind":"targets","gameStateId":10,"respId":12}',
    kind: 'targets',
    interaction: 7,
    stack: 1,
    waiting: false,
    lagging: false,
    terminal: false,
    connected: true,
    errors: 0,
  }
  expect(targetDecisionRetired(targetEcho, 7)).toBe(false)
  expect(
    targetDecisionRetired({ ...targetEcho, request: 13, decision: 'new-target-echo' }, 7),
  ).toBe(false)
  expect(targetDecisionRetired({ ...targetEcho, kind: 'actions', waiting: true }, 7)).toBe(false)
  expect(targetDecisionRetired({ ...targetEcho, kind: 'actions', lagging: true }, 7)).toBe(false)
  expect(targetDecisionRetired({ ...targetEcho, kind: 'actions', decision: null }, 7)).toBe(false)
  expect(targetDecisionRetired({ ...targetEcho, kind: 'actions' }, 7)).toBe(true)
  expect(targetDecisionRetired({ ...targetEcho, terminal: true }, 7)).toBe(true)
  expect(targetDecisionRetired({ ...targetEcho, interaction: 8 }, 7)).toBe(true)
  expect(targetDecisionRetired({ ...targetEcho, interaction: 8, waiting: true }, 7)).toBe(false)
})
