import { castingInstruction } from '@engine/runtime/prompts/casting'
import { targetingInstruction } from '@engine/runtime/prompts/targeting'
import { selectionInstruction } from '@engine/runtime/prompts/selection'
import { damageInstruction } from '@engine/runtime/prompts/damage'
import { searchInstruction } from '@engine/runtime/prompts/search'
import { describe, expect, it } from 'bun:test'
import { promptHeading, promptOptionSummaries } from './gre-prompt-view'
import type { PromptView } from './gre-state'

describe('promptHeading', () => {
  it('uses friendly labels for raw request codes', () => {
    expect(
      promptHeading(
        ((view: Extract<PromptView, { kind: 'search' }>) => ({
          ...view,
          instruction: searchInstruction(view),
        }))({
          interactionKey: 1,
          kind: 'search',
          searchCandidates: [],
          searchGroups: [],
          message: 'SearchReq',
        }),
      ),
    ).toBe('Search your library')
    expect(
      promptHeading(
        ((view: Extract<PromptView, { kind: 'assignDamage' }>) => ({
          ...view,
          instruction: damageInstruction(view),
        }))({
          interactionKey: 1,
          kind: 'assignDamage',
          damageAssigners: [],
          message: 'AssignDamageReq',
        }),
      ),
    ).toBe('Assign combat damage')
    expect(
      promptHeading(
        ((view: Extract<PromptView, { kind: 'selectN' }>) => ({
          ...view,
          instruction: selectionInstruction(view),
        }))({
          interactionKey: 1,
          kind: 'selectN',
          selectNCandidates: [],
          message: 'PayCostsReq (0/1 selected)',
        }),
      ),
    ).toBe('Pay costs')
  })

  it('keeps human engine messages', () => {
    expect(
      promptHeading(
        ((view: Extract<PromptView, { kind: 'targets' }>) => ({
          ...view,
          instruction: targetingInstruction(view),
        }))({
          interactionKey: 1,
          kind: 'targets',
          candidates: [],
          message: 'Select target for Shock',
        }),
      ),
    ).toBe('Select target for Shock')
  })
})

describe('promptOptionSummaries', () => {
  it('summarizes target prompts for debug tooling', () => {
    const prompt: PromptView = ((view: Extract<PromptView, { kind: 'targets' }>) => ({
      ...view,
      instruction: targetingInstruction(view),
    }))({
      interactionKey: 1,
      kind: 'targets',
      message: 'SelectTargetsReq',
      candidates: [
        {
          targetInstanceId: 42,
          targetIdx: 1,
          legalAction: 1,
          name: 'Opponent',
          grpId: 0,
          selected: false,
        },
      ],
    })

    expect(promptOptionSummaries(prompt)).toEqual([{ iid: 42, name: 'Opponent' }])
  })

  it('summarizes casting options without exposing protocol payloads', () => {
    const prompt: PromptView = ((view: Extract<PromptView, { kind: 'castingOptions' }>) => ({
      ...view,
      instruction: castingInstruction(view),
    }))({
      interactionKey: 1,
      kind: 'castingOptions',
      message: 'CastingTimeOptionsReq',
      castingOptions: [
        {
          interactionKey: 1,
          ctoId: 1,
          optionType: 7,
          grpId: 8,
          abilityGrpId: 7,
          minSelect: 1,
          maxSelect: 2,
          selectionPayable: true,
          label: 'Kicked',
          manaColors: [],
          selectedManaColor: null,
          modalOptions: [
            {
              index: 0,
              grpId: 9,
              label: 'First mode',
              additionalCost: '{1}',
              available: true,
              selectable: true,
              selected: true,
            },
          ],
          selectNOptions: [{ id: 3, label: 'Red' }],
        },
      ],
    })

    expect(promptOptionSummaries(prompt)).toEqual([
      {
        idx: 0,
        label: 'Kicked',
        modal: ['First mode'],
        select: ['Red'],
        modes: [
          { label: 'First mode', cost: '{1}', available: true, selectable: true, selected: true },
        ],
        selection: { min: 1, max: 2, selected: [0], payable: true, submitting: false },
      },
    ])
  })
})
