import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { BoardStory } from './BoardStory'
import {
  replayDecisionBoard,
  tallStackDecisionBoard,
  selectionBoard,
  targetingBoard,
  combatBoard,
} from './fixtures'

const meta = {
  title: 'Gameplay/Replay',
  id: 'view-modes',
  component: BoardStory,
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  args: { onLegalAction: fn() },
} satisfies Meta<typeof BoardStory>

export default meta
type Story = StoryObj<typeof meta>

export const ReplayDecision: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const board = canvas.getByRole('region', { name: 'Battlefield' })
    await expect(board).toHaveAttribute('data-replay', 'true')
    await expect(
      canvas.queryByRole('button', { name: /Pass|End turn|End Match|Leave Match/ }),
    ).not.toBeInTheDocument()
    await expect(board.querySelector('[data-action-key]')).not.toBeInTheDocument()
    await userEvent.click(
      canvasElement.querySelector<HTMLButtonElement>(
        'button[data-zone="graveyard"][data-owner="self"]',
      )!,
    )
    await expect(screen.getByRole('dialog', { name: /Your Graveyard/ })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Your Graveyard/ })).not.toBeInTheDocument(),
    )
  },
  name: 'Replay decision',
  args: { board: replayDecisionBoard(), replay: true, interactive: false },
  parameters: {
    docs: {
      description: {
        story:
          'Can viewers inspect every recorded casting mode beside the compact stack without gaining game commands? The decision is intentionally inert and remains readable.',
      },
    },
  },
}

export const TallStackDecision: Story = {
  name: 'Tall stack decision',
  args: { board: tallStackDecisionBoard(), replay: true, interactive: false },
  parameters: {
    docs: {
      description: {
        story:
          'Can viewers inspect a crowded recorded stack while its optional decision remains readable without gaining game commands? The decision is intentionally inert.',
      },
    },
  },
}

const inspectReadOnlyDecision: NonNullable<Story['play']> = async ({ canvasElement, args }) => {
  const prompt = canvasElement.querySelector<HTMLElement>('[data-prompt]')!
  const choice = prompt.querySelector<HTMLButtonElement>(
    'button[data-instance-id][aria-disabled="true"]:not([disabled])',
  )!
  await expect(choice).toBeInTheDocument()
  const before = prompt.innerHTML
  within(prompt).getByRole('heading').focus()
  for (let step = 0; step < 20 && choice !== document.activeElement; step++) {
    await userEvent.tab()
  }
  await expect(choice).toHaveFocus()
  const card = canvasElement.querySelector<HTMLElement>(
    `[data-card][data-instance-id="${choice.dataset['instanceId']}"]`,
  )!
  await expect(
    await screen.findByRole('complementary', { name: `${card.dataset['card']} inspection` }),
  ).toBeVisible()
  args.onLegalAction.mockClear()
  await userEvent.keyboard('{Enter}')
  await userEvent.keyboard(' ')
  await userEvent.click(choice)
  await expect(prompt.innerHTML).toBe(before)
  await expect(args.onLegalAction).not.toHaveBeenCalled()
  await expect(within(prompt).getByRole('button', { name: /^Submit/ })).toBeDisabled()
}

export const CardSelection: Story = {
  play: inspectReadOnlyDecision,
  args: { board: selectionBoard('card choices'), replay: true, interactive: false },
}
export const TargetInspection: Story = {
  play: inspectReadOnlyDecision,
  args: { board: targetingBoard(), replay: true, interactive: false },
}
export const CombatInspection: Story = {
  play: inspectReadOnlyDecision,
  args: { board: combatBoard(), replay: true, interactive: false },
}
