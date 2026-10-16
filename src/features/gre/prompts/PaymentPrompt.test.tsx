import { bindingFor, encodedPromptHarness } from '@engine/runtime/prompts/prompt-test-harness'
import { buttons } from './prompt-renderer-test-helpers'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaymentPrompt } from './PaymentPrompt'

test('GatherCounters renders bounded per-source amount controls', () => {
  const html = renderToStaticMarkup(
    <PaymentPrompt
      view={{
        interactionKey: 15,
        kind: 'payCosts',
        message: 'Remove counters',
        amountToGather: 2,
        canSubmit: false,
        canCancel: true,
        gatherCounterCandidates: [
          {
            interactionKey: 15,
            instanceId: 101,
            grpId: 201,
            name: 'Hopeful Initiate',
            minAmount: 0,
            maxAmount: 1,
            amount: 1,
          },
          {
            interactionKey: 15,
            instanceId: 102,
            grpId: 202,
            name: 'Backup Agent',
            minAmount: 0,
            maxAmount: 2,
            amount: 0,
          },
        ],
      }}
      controls={null}
    />,
  )

  expect(html).toContain('Remove one counter from Backup Agent')
  expect(html).toContain('Remove one fewer counter from Hopeful Initiate')
  expect(html).toContain('>Cancel</button>')
  expect(html).not.toContain('Done paying')
})

test('payment renderer invokes bound offers and keeps waiting and read-only controls disabled', async () => {
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest({
    type: 36,
    msgId: 1,
    gameStateId: 4,
    payCostsReq: { paymentActions: { actions: [{ actionType: 12, instanceId: 101 }] } },
  })
  const bound = bindingFor(h.owner, 'payCosts')
  const active = buttons(PaymentPrompt({ view: bound.view, controls: bound.controls }))
  active.find((button) => button.props['data-instance-id'] === 101)!.props.onClick()
  await Bun.sleep(0)
  expect(h.sent).toHaveLength(1)
  const waiting = bindingFor(h.owner, 'payCosts')
  expect(
    buttons(PaymentPrompt({ view: waiting.view, controls: waiting.controls })).every(
      (button) => button.props.disabled,
    ),
  ).toBe(true)
  expect(
    buttons(PaymentPrompt({ view: bound.view, controls: null })).every(
      (button) => button.props.disabled,
    ),
  ).toBe(true)
})

test('bound payment finish does not require a selection-ready flag', () => {
  const html = renderToStaticMarkup(
    <PaymentPrompt
      view={{ kind: 'payCosts', interactionKey: 1, message: '', canSubmit: false }}
      controls={{
        pay: async () => true,
        finish: async () => true,
        adjust: () => false,
        submit: async () => false,
        cancel: async () => false,
      }}
    />,
  )
  expect(html.match(/<button[^>]*>Done paying<\/button>/)?.[0]).not.toContain('disabled')
})
