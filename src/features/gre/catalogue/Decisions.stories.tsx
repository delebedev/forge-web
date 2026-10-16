import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { BoardStory } from './BoardStory'
import {
  castingBoard,
  combatBoard,
  numericInputBoard,
  openingHandBoard,
  replacementBoard,
  selectionBoard,
  targetingBoard,
  type CastingVariant,
  type NumericInputVariant,
  type SelectionVariant,
} from './fixtures'

type DecisionStoryArgs = {
  case:
    'targeting' | 'casting' | 'selection' | 'replacement' | 'pay for X' | 'combat' | 'opening hand'
  castingVariant: CastingVariant
  numericInputVariant: NumericInputVariant
  selectionVariant: SelectionVariant
  onLegalAction: ReturnType<typeof fn>
}

const openingHandControls = {
  keep: fn(async () => true).mockName('keepOpeningHand'),
  mulligan: fn(async () => true).mockName('takeMulligan'),
}

const attackerControls = {
  choose: fn(async () => true).mockName('toggleAttacker'),
  all: fn(async () => true).mockName('attackAll'),
  submit: fn(async () => true).mockName('submitAttackers'),
}

const numericControls = { adjust: fn(() => true), submit: fn(async () => true) }

const castingControls = {
  chooseCastingOption: fn(async () => true).mockName('chooseCastingOption'),
  chooseCastingOptionSelect: fn(async () => true).mockName('chooseCastingOptionSelect'),
  selectManaType: fn(() => true).mockName('selectManaType'),
  submitManaTypes: fn(async () => true).mockName('submitManaTypes'),
  chooseModalOption: fn(async () => true).mockName('chooseModalOption'),
  toggleModalOption: fn(() => true).mockName('toggleModalOption'),
  adjustModalOption: fn(() => true).mockName('adjustModalOption'),
  submitModalOptions: fn(async () => true).mockName('submitModalOptions'),
  cancel: fn(async () => true).mockName('cancel'),
}

const selectionControls = {
  toggle: fn(() => true).mockName('toggleSelectN'),
  submit: fn(async () => true).mockName('submitSelectN'),
  cancel: fn(async () => true).mockName('cancel'),
}

const targetControls = {
  choose: fn(async () => true).mockName('chooseTarget'),
  submit: fn(async () => true).mockName('submitTargets'),
  cancel: fn(async () => true).mockName('cancelTarget'),
}

const meta = {
  title: 'Gameplay/Decisions',
  id: 'decisions',
  parameters: { layout: 'fullscreen' },
  args: {
    case: 'targeting',
    castingVariant: 'single mode',
    numericInputVariant: 'minimum',
    selectionVariant: 'text choices',
    onLegalAction: fn(),
  },
  argTypes: {
    case: { control: false, table: { disable: true } },
    castingVariant: {
      control: { type: 'inline-radio' },
      options: ['single mode', 'multiple modes'],
    },
    numericInputVariant: {
      control: { type: 'inline-radio' },
      options: ['minimum', 'chosen', 'maximum', 'waiting'],
    },
    selectionVariant: {
      control: { type: 'inline-radio' },
      options: ['text choices', 'card choices'],
    },
    onLegalAction: { table: { disable: true } },
  },
  render: (args, { globals }) => {
    const board =
      args.case === 'targeting'
        ? targetingBoard()
        : args.case === 'casting'
          ? castingBoard(
              (globals['castingVariant'] as CastingVariant | undefined) ?? args.castingVariant,
            )
          : args.case === 'selection'
            ? selectionBoard(
                (globals['selectionVariant'] as SelectionVariant | undefined) ??
                  args.selectionVariant,
              )
            : args.case === 'replacement'
              ? replacementBoard()
              : args.case === 'pay for X'
                ? numericInputBoard(
                    (globals['numericInputVariant'] as NumericInputVariant | undefined) ??
                      args.numericInputVariant,
                  )
                : args.case === 'combat'
                  ? combatBoard()
                  : openingHandBoard()
    return (
      <BoardStory
        board={board}
        onLegalAction={args.onLegalAction}
        promptBinding={
          board.prompt?.kind === 'mulligan'
            ? {
                kind: 'mulligan',
                view: board.prompt,
                controls: openingHandControls,
              }
            : board.prompt?.kind === 'attackers'
              ? {
                  kind: 'attackers',
                  view: board.prompt,
                  controls: attackerControls,
                }
              : board.prompt?.kind === 'numericInput'
                ? {
                    kind: 'numericInput',
                    view: board.prompt,
                    controls: numericControls,
                  }
                : board.prompt?.kind === 'castingOptions'
                  ? {
                      kind: 'castingOptions',
                      view: board.prompt,
                      controls: castingControls,
                    }
                  : board.prompt?.kind === 'selectN'
                    ? {
                        kind: 'selectN',
                        view: board.prompt,
                        controls: selectionControls,
                      }
                    : board.prompt?.kind === 'targets'
                      ? {
                          kind: 'targets',
                          view: board.prompt,
                          controls: targetControls,
                        }
                      : null
        }
      />
    )
  },
} satisfies Meta<DecisionStoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Targeting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const prompt = within(canvasElement.querySelector<HTMLElement>('[data-prompt="targets"]')!)
    await waitFor(() => expect(prompt.getByRole('heading')).toHaveFocus())
    targetControls.choose.mockClear()
    const opponent = prompt.getByRole('button', { name: 'Opponent' })
    opponent.focus()
    await expect(opponent).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(targetControls.choose).toHaveBeenCalledTimes(1)
    await expect(opponent).toHaveAttribute('aria-pressed', 'true')
    targetControls.choose.mockClear()
    await userEvent.click(
      within(
        canvasElement.querySelector<HTMLElement>('[data-zone="battlefield"][data-owner="self"]')!,
      ).getByRole('button', { name: /Raging Goblin/ }),
    )
    await userEvent.click(prompt.getByRole('button', { name: 'Raging Goblin' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Target opponent' }))
    await userEvent.click(opponent)
    await expect(targetControls.choose).toHaveBeenCalledTimes(4)
    await expect(targetControls.choose.mock.calls[0]).toEqual(targetControls.choose.mock.calls[1])
    await expect(targetControls.choose.mock.calls[2]).toEqual(targetControls.choose.mock.calls[3])
  },
  args: { case: 'targeting' },
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Is the source clear, are grouped counts legible, and does the selected player stay connected to the stack? Fixture clicks report exact candidates without advancing game state.',
      },
    },
  },
}

export const Casting: Story = {
  play: async ({ canvasElement, args, globals }) => {
    const canvas = within(canvasElement)
    if ((globals['castingVariant'] ?? args.castingVariant) === 'multiple modes') {
      await expect(
        canvas.getByRole('button', { name: '+ {1} — Destroy target enchantment. Unavailable' }),
      ).toBeDisabled()
      const submit = canvas.getByRole('button', { name: 'Submit modes' })
      await expect(submit).toBeEnabled()
      castingControls.submitModalOptions.mockClear()
      await userEvent.click(submit)
      await expect(castingControls.submitModalOptions).toHaveBeenCalledTimes(1)
    } else {
      const option = canvas.getByRole('button', {
        name: "Blizzard — {0} — Return target creature to its owner's hand.",
      })
      await expect(option).toHaveAttribute('data-cto-id', '9')
      await expect(option).toHaveAttribute('data-grp-id', '189134')
      await expect(option).toHaveAttribute('data-ability-grp-id', '189137')
      castingControls.chooseModalOption.mockClear()
      await userEvent.click(option)
      await expect(castingControls.chooseModalOption).toHaveBeenCalledTimes(1)
    }
  },
  args: { case: 'casting' },
  parameters: {
    controls: { include: ['castingVariant'] },
    chromatic: {
      modes: {
        desktop: { viewport: { width: 1440, height: 900 }, castingVariant: 'single mode' },
        'multiple modes': {
          viewport: { width: 1440, height: 900 },
          castingVariant: 'multiple modes',
        },
      },
    },
    docs: {
      description: {
        story:
          'Are single-choice costs and bounded multi-mode costs readable without exposing protocol vocabulary? Switch between the two casting contracts; fixture callbacks are reported without simulating payment.',
      },
    },
  },
}

export const Selection: Story = {
  play: async ({ canvasElement, args, globals }) => {
    await waitFor(() =>
      expect(
        within(canvasElement.querySelector<HTMLElement>('[data-prompt]')!).getByRole('heading'),
      ).toHaveFocus(),
    )
    if ((globals['selectionVariant'] ?? args.selectionVariant) === 'card choices') {
      const choice = within(
        canvasElement.querySelector<HTMLElement>('[data-prompt="selectN"]')!,
      ).getByRole('button', { name: 'Lightning Bolt' })
      selectionControls.toggle.mockClear()
      choice.focus()
      await expect(choice).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect(selectionControls.toggle).toHaveBeenCalledTimes(1)
      await expect(
        await screen.findByRole('complementary', { name: 'Lightning Bolt inspection' }),
      ).toBeInTheDocument()
      choice.blur()
      await waitFor(() =>
        expect(
          screen.queryByRole('complementary', { name: 'Lightning Bolt inspection' }),
        ).not.toBeInTheDocument(),
      )
      await userEvent.hover(choice)
      await expect(
        await screen.findByRole('complementary', { name: 'Lightning Bolt inspection' }),
      ).toBeInTheDocument()
      await userEvent.unhover(choice)
    } else {
      const choices = canvasElement.querySelectorAll('[data-prompt="selectN"] [data-choice-id]')
      await expect(choices).toHaveLength(3)
      await expect(choices[0]).not.toHaveAttribute('data-instance-id')
    }
  },
  args: { case: 'selection' },
  parameters: {
    controls: { include: ['selectionVariant'] },
    chromatic: {
      modes: {
        desktop: {
          viewport: { width: 1440, height: 900 },
          selectionVariant: 'text choices',
        },
        'card choices': {
          viewport: { width: 1440, height: 900 },
          selectionVariant: 'card choices',
        },
      },
    },
    docs: {
      description: {
        story:
          'Can players distinguish static text choices from inspectable card choices while preserving exact identities? Switch variants, then focus or hover a card-backed option.',
      },
    },
  },
}

export const Replacement: Story = {
  args: { case: 'replacement' },
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Can a player distinguish competing replacement effects by their source and effect text while the exact response identity stays out of visible copy?',
      },
    },
  },
}

export const PayForX: Story = {
  play: async ({ canvasElement, args, globals }) => {
    const canvas = within(canvasElement)
    const variant = globals['numericInputVariant'] ?? args.numericInputVariant
    if (variant === 'waiting') {
      const prompt = within(
        canvasElement.querySelector<HTMLElement>('[data-prompt="numericInput"]')!,
      )
      for (const button of prompt.getAllByRole('button')) {
        await expect(button).toBeDisabled()
      }
    } else {
      await expect(canvas.getByRole('button', { name: 'Decrease X' }))[
        variant === 'minimum' ? 'toBeDisabled' : 'toBeEnabled'
      ]()
      await expect(canvas.getByRole('button', { name: 'Increase X' }))[
        variant === 'maximum' ? 'toBeDisabled' : 'toBeEnabled'
      ]()
    }
  },
  name: 'Pay for X',
  args: { case: 'pay for X' },
  parameters: {
    controls: { include: ['numericInputVariant'] },
    chromatic: {
      modes: {
        desktop: { viewport: { width: 1440, height: 900 }, numericInputVariant: 'minimum' },
        maximum: { viewport: { width: 1440, height: 900 }, numericInputVariant: 'maximum' },
        waiting: { viewport: { width: 1440, height: 900 }, numericInputVariant: 'waiting' },
      },
    },
    docs: {
      description: {
        story:
          'Are the lower and upper bounds, a chosen value, and the waiting state clear for an X payment? Switch configurations to inspect each state; fixture callbacks are reported without submitting payment.',
      },
    },
  },
}

export const Combat: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByRole('heading', { name: 'Declare attackers' })).toHaveFocus(),
    )
    const choice = canvasElement.querySelector<HTMLButtonElement>(
      '[data-prompt="attackers"] [data-option-index]',
    )!
    attackerControls.choose.mockClear()
    attackerControls.submit.mockClear()
    choice.focus()
    await userEvent.keyboard('{Enter}')
    await expect(attackerControls.choose).toHaveBeenCalledTimes(1)
    await expect(
      await screen.findByRole('complementary', { name: 'Raging Goblin inspection' }),
    ).toBeVisible()
    choice.blur()
    await waitFor(() =>
      expect(
        screen.queryByRole('complementary', { name: 'Raging Goblin inspection' }),
      ).not.toBeInTheDocument(),
    )
    await userEvent.click(
      canvasElement.querySelector<HTMLElement>(
        '[data-zone="battlefield"][data-owner="self"] [data-card="Raging Goblin"]',
      )!,
    )
    await expect(attackerControls.choose).toHaveBeenCalledTimes(2)
    await expect(attackerControls.choose.mock.calls[0]).toEqual(
      attackerControls.choose.mock.calls[1],
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Submit attackers' }))
    await expect(attackerControls.submit).toHaveBeenCalledTimes(1)
  },
  args: { case: 'combat' },
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Can a player recognize the selected attacker, its recipient, and the commit action? Fixture callbacks report the supplied attacker identity without resolving combat.',
      },
    },
  },
}

export const OpeningHand: Story = {
  play: async ({ canvasElement }) => {
    const prompt = within(canvasElement.querySelector<HTMLElement>('[data-prompt="mulligan"]')!)
    openingHandControls.keep.mockClear()
    openingHandControls.mulligan.mockClear()
    const keep = prompt.getByRole('button', { name: 'Keep hand' })
    keep.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(prompt.getByRole('button', { name: 'Mulligan' }))
    await expect(openingHandControls.keep.mock.calls).toEqual([[]])
    await expect(openingHandControls.mulligan.mock.calls).toEqual([[]])
    await expect(
      canvasElement.querySelectorAll('[data-zone="hand"][data-owner="self"] [data-card]'),
    ).toHaveLength(7)
  },
  name: 'Opening hand',
  args: { case: 'opening hand' },
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Is a credible opening hand readable before any battlefield state exists? Check card inspection, keep, and mulligan focus order.',
      },
    },
  },
}
