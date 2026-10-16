import { expect, test } from 'bun:test'
import { greNormalizer } from './gre-enum-names'
import { parseTranscriptBundle, transcriptFrames } from './gre-transcript'
import { GAME_STATE_TYPE_FULL } from '@engine/state/gre-state'

const BUNDLE_PATH = 'dev/transcripts/sample.greplay.json'

test('a type-name-prefixed enum resolves to the same number as the bare name', async () => {
  const normalizer = await greNormalizer()

  const prefixed = normalizer.normalizeAs('GameStateMessage', {
    type: 'GameStateType_Full',
    annotations: [{ id: 1, type: ['AnnotationType_PhaseOrStepModified'] }],
  })
  const bare = normalizer.normalizeAs('GameStateMessage', {
    type: 'Full',
    annotations: [{ id: 1, type: ['PhaseOrStepModified'] }],
  })

  expect(prefixed.misses).toEqual([])
  expect(bare.misses).toEqual([])
  expect(prefixed.message['type']).toBe(GAME_STATE_TYPE_FULL)
  expect(prefixed.message).toEqual(bare.message)
})

test('PhaseOrStepModified normalizes to 8, not the 0 a silent miss would produce', async () => {
  const normalizer = await greNormalizer()
  const { message, misses } = normalizer.normalizeAs('GameStateMessage', {
    annotations: [{ id: 1, type: ['AnnotationType_PhaseOrStepModified'] }],
  })

  // 0 is AnnotationType.None_af5a — a legal value, which is exactly why an
  // unmatched name must never be defaulted to it.
  expect(misses).toEqual([])
  expect((message['annotations'] as { type: number[] }[])[0]!.type).toEqual([8])
})

test('an unknown enum name is reported, never guessed', async () => {
  const normalizer = await greNormalizer()
  const { message, misses } = normalizer.normalizeAs('GameStateMessage', {
    annotations: [{ id: 1, type: ['AnnotationType_NotARealAnnotation'] }],
  })

  expect(misses).toEqual([
    {
      path: 'GameStateMessage.annotations[0].type[0]',
      enumName: 'AnnotationType',
      value: 'AnnotationType_NotARealAnnotation',
    },
  ])
  expect((message['annotations'] as { type: unknown[] }[])[0]!.type).toEqual([
    'AnnotationType_NotARealAnnotation',
  ])
})

test('fields the descriptor does not know pass through instead of being dropped', async () => {
  const normalizer = await greNormalizer()
  const { message } = normalizer.normalizeAs('GameStateMessage', {
    gameStateId: 3,
    notAField: 'kept',
  })

  expect(message['gameStateId']).toBe(3)
  expect(message['notAField']).toBe('kept')
})

test('every enum name in the sample transcript resolves', async () => {
  const bundle = parseTranscriptBundle(await Bun.file(BUNDLE_PATH).json())
  const normalizer = await greNormalizer()
  const frames = transcriptFrames(bundle)

  const misses = frames.flatMap((frame) => normalizer.normalize(frame.message).misses)
  const distinct = [...new Set(misses.map((miss) => `${miss.enumName}.${miss.value}`))]

  // A transcript that normalizes with misses still renders — it renders wrongly,
  // with enum-keyed reads landing on defaults. This assertion is the guard.
  expect(distinct).toEqual([])
  expect(frames.length).toBeGreaterThan(100)
})

test('the sample transcript folds to numeric enums the store can read', async () => {
  const bundle = parseTranscriptBundle(await Bun.file(BUNDLE_PATH).json())
  const normalizer = await greNormalizer()

  const annotationTypes = new Set<unknown>()
  for (const frame of transcriptFrames(bundle)) {
    const gsm = normalizer.normalize(frame.message).message['gameStateMessage']
    if (typeof gsm !== 'object' || gsm === null) {
      continue
    }
    for (const annotation of ((gsm as Record<string, unknown>)['annotations'] as
      { type?: unknown[] }[] | undefined) ?? []) {
      for (const type of annotation.type ?? []) {
        annotationTypes.add(type)
      }
    }
  }

  expect(annotationTypes.size).toBeGreaterThan(3)
  for (const type of annotationTypes) {
    expect(typeof type).toBe('number')
  }
  // ZoneTransfer, the type animation dwell keys off, must actually be present.
  expect(annotationTypes.has(1)).toBe(true)
})
