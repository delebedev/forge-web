import { expect, test } from 'bun:test'
import { bindingFor, decodeGre, encodedPromptHarness, promptHarness } from './prompt-test-harness'
import { enumValue } from '@engine/wire/gre-proto'

const request = (msgId = 7, error = '') => ({
  type: 58,
  msgId,
  gameStateId: msgId + 10,
  stringInputReq: { sourceId: 101 },
  prompt: {
    parameters: [
      { parameterName: 'choiceKind', type: 6, stringValue: 'cardName' },
      { parameterName: 'instruction', type: 6, stringValue: 'Choose a card name.' },
      { parameterName: 'validationError', type: 6, stringValue: error },
    ],
  },
})

test('card name requires nonempty text and encodes one correlated explicit answer', async () => {
  const { owner, sent, observed } = encodedPromptHarness()
  owner.applyFamilyRequest(request())
  const bound = bindingFor(owner, 'cardNameInput')
  expect(bound.view.canSubmit).toBe(false)
  expect(await bound.controls.submit()).toBe(false)
  expect(bound.controls.edit('   ')).toBe(true)
  expect(await bound.controls.submit()).toBe(false)
  expect(bound.controls.edit(' Grizzly Bears ')).toBe(true)
  owner.refreshPendingPrompts()
  expect(owner.prompt).toMatchObject({ value: ' Grizzly Bears ', canSubmit: true })
  expect(await bound.controls.submit()).toBe(true)
  expect(await bound.controls.submit()).toBe(false)
  expect(sent).toHaveLength(1)
  expect(await decodeGre(sent[0])).toEqual({
    type: await enumValue('ClientMessageType', 'StringInputResp_097b'),
    systemSeatId: 1,
    gameStateId: 17,
    respId: 7,
    stringInputResp: { inputValue: 'Grizzly Bears' },
  })
  expect(observed.some((view) => view?.waiting)).toBe(true)
  expect(owner.prompt).toBeNull()
})

test('invalid feedback starts a fresh empty draft and stale controls cannot answer it', async () => {
  const { owner, sent } = promptHarness()
  owner.applyFamilyRequest(request())
  const old = bindingFor(owner, 'cardNameInput').controls
  old.edit('Unknown name')
  await old.submit()
  owner.applyFamilyRequest(request(8, 'Enter a valid card name allowed by this effect.'))
  expect(owner.prompt).toMatchObject({
    value: '',
    validationError: 'Enter a valid card name allowed by this effect.',
    canSubmit: false,
  })
  expect(old.edit('Island')).toBe(false)
  expect(await old.submit()).toBe(false)
  const current = bindingFor(owner, 'cardNameInput').controls
  current.edit('Island')
  await current.submit()
  expect(sent).toHaveLength(2)
  expect(sent[1]?.payload).toEqual({
    gameStateId: 18,
    respId: 8,
    stringInputResp: { inputValue: 'Island' },
  })
})

test('source replacement during card-name encoding cannot deliver into the successor', async () => {
  const h = encodedPromptHarness({}, { deferDelivery: true })
  h.owner.applyFamilyRequest(request())
  const current = bindingFor(h.owner, 'cardNameInput').controls
  current.edit('Island')
  const pending = current.submit()
  const delivery = await h.waitForDelivery()
  h.nextSource()
  h.owner.applyFamilyRequest(request(8))
  delivery.release()
  expect(await pending).toBe(false)
  expect(h.sent).toHaveLength(0)
  expect(h.owner.prompt).toMatchObject({ kind: 'cardNameInput', value: '', canSubmit: false })
})

test('unmarked string requests remain explicitly unsupported and read-only choices have no controls', () => {
  const h = promptHarness()
  h.owner.applyFamilyRequest({ ...request(), prompt: {} })
  expect(h.owner.prompt).toMatchObject({ kind: 'unsupported' })
  h.owner.applyFamilyRequest(request())
  h.readOnly()
  expect(h.owner.bindPrompt(h.owner.prompt)?.controls).toBeNull()
})
