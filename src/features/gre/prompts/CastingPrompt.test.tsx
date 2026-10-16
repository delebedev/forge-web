import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CastingPromptView, CastingOptionCandidate } from '@engine/state/gre-state'
import type { CastingControls } from '@engine/runtime/prompts/family'
import { CastingPrompt } from './CastingPrompt'
import { buttons } from './prompt-renderer-test-helpers'
import { promptHarness, bindingFor } from '@engine/runtime/prompts/prompt-test-harness'
const controls: CastingControls = {
  chooseCastingOption: async () => true,
  chooseCastingOptionSelect: async () => true,
  selectManaType: () => true,
  submitManaTypes: async () => true,
  chooseModalOption: async () => true,
  toggleModalOption: () => true,
  adjustModalOption: () => true,
  submitModalOptions: async () => true,
  cancel: async () => true,
}
test('costed casting modes render unavailable state without repeating localized costs', () => {
  const prompt: CastingPromptView = {
    interactionKey: 12,
    kind: 'castingOptions',
    message: 'Choose modes',
    castingOptions: [
      {
        interactionKey: 1,
        ctoId: 2,
        optionType: 10,
        grpId: 42,
        abilityGrpId: 43,
        minSelect: 1,
        maxSelect: 2,
        selectionPayable: false,
        label: 'Spree',
        manaColors: [],
        selectedManaColor: null,
        modalOptions: [
          {
            index: 0,
            grpId: 44,
            label: '+ {1} — Destroy target artifact.',
            additionalCost: '{1}',
            available: true,
            selectable: true,
            selected: true,
          },
          {
            index: 1,
            grpId: 45,
            label: 'Second choice',
            additionalCost: '{3}',
            available: true,
            selectable: false,
            selected: false,
          },
          {
            index: 0,
            grpId: 46,
            label: '+ {1} — Destroy target enchantment.',
            additionalCost: '{1}',
            available: false,
            selectable: false,
            selected: false,
          },
        ],
        selectNOptions: [],
      },
    ],
  }

  const html = renderToStaticMarkup(
    <CastingPrompt view={prompt as CastingPromptView} controls={controls} />,
  )

  expect(html.match(/Additional cost \{1\}/g)).toBeNull()
  expect(html).toContain('Additional cost {3}')
  expect(html).toContain('Destroy target enchantment.</span><small')
  expect(html).toContain('>Unavailable</small>')
  expect(html).toContain('Cannot pay with current selection</span>')
  expect(html).toContain('selected modes cannot be paid together')
  expect(html.match(/disabled=""/g)).toHaveLength(3)
})

test('mana choices render semantic options and require one choice per cto', () => {
  const option = (ctoId: number, selectedManaColor: number | null): CastingOptionCandidate => ({
    interactionKey: 1,
    ctoId,
    optionType: 9,
    grpId: 42,
    abilityGrpId: 0,
    minSelect: 0,
    maxSelect: 0,
    selectionPayable: true,
    label: 'Choose a mana type',
    manaColors: [10, ctoId],
    selectedManaColor,
    modalOptions: [],
    selectNOptions: [],
  })
  const prompt: CastingPromptView = {
    interactionKey: 13,
    kind: 'castingOptions',
    message: 'CastingTimeOptionsReq',
    castingOptions: [option(2, 10), option(4, null)],
  }

  const html = renderToStaticMarkup(
    <CastingPrompt view={prompt as CastingPromptView} controls={controls} />,
  )
  expect(html).toContain('Hybrid symbol 1')
  expect(html).toContain('Hybrid symbol 2')
  expect(html).toContain('Two generic')
  expect(html).toContain('Blue')
  expect(html).toContain('Red')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('Submit mana choices')
  expect(html).toMatch(/Submit mana choices<\/button>/)
  expect(html).toContain('disabled=""')
  const playerFacingHtml = html.replaceAll(/ data-[a-z-]+="[^"]*"/g, '')
  expect(playerFacingHtml).not.toContain('ctoId')
  expect(playerFacingHtml).not.toContain('Mana choice 2')
  expect(playerFacingHtml).not.toContain('Mana choice 4')
})

test('life payments show their amount beside the mana alternative', () => {
  const html = renderToStaticMarkup(
    <CastingPrompt
      controls={controls}
      view={{
        interactionKey: 14,
        kind: 'castingOptions',
        message: 'Choose payments',
        castingOptions: [
          {
            interactionKey: 1,
            ctoId: 2,
            optionType: 9,
            grpId: 42,
            abilityGrpId: 0,
            minSelect: 0,
            maxSelect: 0,
            selectionPayable: true,
            label: 'Choose a payment',
            manaColors: [6, 3],
            selectedManaColor: 6,
            modalOptions: [],
            selectNOptions: [],
          },
        ],
      }}
    />,
  )
  expect(html).toContain('Payment 1')
  expect(html).toContain('Pay 2 life')
  expect(html).toContain('Black')
  expect(html).not.toContain('Phyrexian')
})

test('repeatable casting modes render counts, bounded controls, submit, and cancel', () => {
  const html = renderToStaticMarkup(
    <CastingPrompt
      view={{
        interactionKey: 13,
        kind: 'castingOptions',
        message: 'Choose modes',
        canCancel: true,
        castingOptions: [
          {
            interactionKey: 1,
            ctoId: 4,
            optionType: 10,
            grpId: 42,
            abilityGrpId: 43,
            minSelect: 3,
            maxSelect: 3,
            repeatsAllowed: true,
            selectionPayable: true,
            label: 'Choose modes',
            manaColors: [],
            selectedManaColor: null,
            modalOptions: [
              {
                index: 0,
                grpId: 44,
                label: 'Proliferate.',
                additionalCost: null,
                available: true,
                selectable: false,
                selected: true,
                selectedCount: 2,
              },
              {
                index: 1,
                grpId: 45,
                label: 'Phase out.',
                additionalCost: null,
                available: true,
                selectable: false,
                selected: true,
                selectedCount: 1,
              },
            ],
            selectNOptions: [],
          },
        ],
      }}
      controls={controls}
    />,
  )

  expect(html).toContain('3 selected · choose 3–3')
  expect(html).toContain('Proliferate. selected 2 times')
  expect(html).toContain('Phase out. selected 1 times')
  expect(html).toContain('>Submit modes</button>')
  expect(html).toContain('>Cancel</button>')
})

test('optional vote offers abstention and no cancel control', () => {
  const { owner } = promptHarness()
  owner.applyFamilyRequest({
    type: 46,
    msgId: 7,
    gameStateId: 8,
    allowCancel: 2,
    prompt: { parameters: [{ parameterName: 'choiceKind', type: 1, stringValue: 'vote' }] },
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        {
          ctoId: 3,
          castingTimeOptionType: 10,
          modalReq: { minSel: 0, maxSel: 1, modalOptions: [{ grpId: 401 }] },
        },
      ],
    },
  })
  const bound = bindingFor(owner, 'castingOptions')
  const html = renderToStaticMarkup(<CastingPrompt view={bound.view} controls={bound.controls} />)
  expect(html).toContain('>Abstain</button>')
  expect(html).not.toContain('>Cancel</button>')
})

test('renderer pointer callbacks edit and deliver through the real binding; waiting and readonly are disabled', () => {
  const { owner, sent } = promptHarness()
  owner.applyFamilyRequest({
    type: 46,
    msgId: 7,
    gameStateId: 8,
    allowCancel: 2,
    castingTimeOptionsReq: {
      castingTimeOptionReq: [
        {
          ctoId: 3,
          castingTimeOptionType: 10,
          modalReq: {
            minSel: 2,
            maxSel: 2,
            repeatedSelectAllowed: true,
            modalOptions: [{ grpId: 401 }],
          },
        },
      ],
    },
  })
  const bound = bindingFor(owner, 'castingOptions')
  const add = buttons(CastingPrompt({ view: bound.view, controls: bound.controls })).find(
    (button) => button.props['aria-label'] === 'Add First choice',
  )!
  expect(add).toBeDefined()
  add.props.onClick()
  add.props.onClick()
  const ready = bindingFor(owner, 'castingOptions')
  expect(ready.view.castingOptions[0]!.modalOptions[0]!.selectedCount).toBe(2)
  const tree = CastingPrompt({ view: ready.view, controls: ready.controls })
  for (const inert of [
    CastingPrompt({ view: ready.view, controls: null }),
    CastingPrompt({ view: { ...ready.view, waiting: true }, controls: ready.controls }),
  ]) {
    expect(buttons(inert).every((button) => button.props.disabled)).toBe(true)
  }
  const submit = buttons(tree).find((button) => button.props.children === 'Submit modes')!
  expect(submit.props.disabled).toBeFalsy()
  submit.props.onClick()
  expect(sent[0]?.payload).toMatchObject({
    respId: 7,
    gameStateId: 8,
    castingTimeOptionsResp: {
      castingTimeOptionResp: { ctoId: 3, chooseModalResp: { grpIds: [401, 401] } },
    },
  })
})
