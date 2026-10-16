import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { BoardStory } from './BoardStory'
import { outsideHandBoard } from './fixtures'

const meta = {
  title: 'Gameplay/Actions',
  id: 'actions',
  component: BoardStory,
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  args: { onLegalAction: fn() },
} satisfies Meta<typeof BoardStory>

export default meta
type Story = StoryObj<typeof meta>

export const OutsideTheHand: Story = {
  name: 'Outside the hand',
  args: { board: outsideHandBoard() },
  parameters: {
    docs: {
      description: {
        story:
          'Does a long legal-only rail remain reachable without covering the hand or pass action? Open both faces of the same Adventure card and inspect the exact callback payloads in Storybook.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Choose action for Bramble Familiar from exile' }),
    )
    await userEvent.click(
      canvas.getByRole('button', { name: 'Cast Bramble Familiar (Adventure) from exile' }),
    )
    await expect(args.onLegalAction).toHaveBeenCalledWith(
      args.board.legalActions.find(
        (action) => action.label === 'Cast Bramble Familiar (Adventure) from exile',
      ),
    )
    await userEvent.click(
      canvas.getByRole('button', { name: 'Choose action for Bramble Familiar from exile' }),
    )
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Cast Bramble Familiar (Adventure alternate) from exile',
      }),
    )
    await expect(args.onLegalAction).toHaveBeenLastCalledWith(
      args.board.legalActions.find(
        (action) => action.label === 'Cast Bramble Familiar (Adventure alternate) from exile',
      ),
    )
  },
}
