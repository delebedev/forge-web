import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { LimitedStoryFrame, deckPool } from './Limited.stories.fixtures'
import { LimitedDeckBuilder } from './LimitedDeckBuilder'

const meta = {
  title: 'Gameplay/Draft/Deck build',
  id: 'gameplay-draft-deck-build',
  component: LimitedDeckBuilder,
  parameters: {
    layout: 'fullscreen',
    controls: { include: ['submitting', 'error'] },
  },
  args: {
    pool: deckPool,
    initialSide: 'mainboard',
    poolLabel: 'Sideboard',
    error: null,
    submitting: false,
    onSubmit: fn(),
  },
  render: (args) => (
    <LimitedStoryFrame>
      <LimitedDeckBuilder {...args} />
    </LimitedStoryFrame>
  ),
} satisfies Meta<typeof LimitedDeckBuilder>

export default meta
type Story = StoryObj<typeof meta>

export const FortyCardDeck: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const start = canvas.getByRole('button', { name: 'Start Game' })
    await expect(start).toBeEnabled()
    await userEvent.click(start)
    await expect(args.onSubmit).toHaveBeenCalledOnce()
  },
}
