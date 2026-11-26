import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { BoardStory } from './BoardStory'
import { interruptedBoard, outcomeBoard } from './fixtures'

const meta = {
  title: 'Gameplay/Session',
  id: 'session',
  component: BoardStory,
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  args: { onLegalAction: fn() },
} satisfies Meta<typeof BoardStory>

export default meta
type Story = StoryObj<typeof meta>

export const Interrupted: Story = {
  args: { board: interruptedBoard() },
  parameters: {
    docs: {
      description: {
        story:
          'Are connection loss, retained board context, and recovery diagnostics clear without pretending that input is available?',
      },
    },
  },
}

export const MatchOutcome: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const dialog = within(canvas.getByRole('dialog'))
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Back to Play' })).toHaveFocus())
    await userEvent.tab()
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Play Again' })).toHaveFocus())
  },
  name: 'Match outcome',
  args: { board: outcomeBoard() },
  parameters: {
    docs: {
      description: {
        story:
          'Does the terminal result take focus, stay readable over the board, and keep both next actions inside the modal focus loop?',
      },
    },
  },
}
