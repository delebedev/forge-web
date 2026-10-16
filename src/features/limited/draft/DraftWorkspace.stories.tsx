import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { LimitedStoryFrame, draftedPool, draftPack } from '../Limited.stories.fixtures'
import { DraftWorkspace } from './DraftWorkspace'

const meta = {
  title: 'Gameplay/Draft/Picking',
  id: 'gameplay-draft-picking',
  component: DraftWorkspace,
  parameters: {
    layout: 'fullscreen',
    controls: { include: ['picking', 'error'] },
  },
  args: {
    pack: draftPack,
    pool: draftedPool,
    round: 0,
    pick: 3,
    picking: false,
    error: null,
    onPick: fn(),
  },
  render: (args) => (
    <LimitedStoryFrame padded={false}>
      <DraftWorkspace {...args} />
    </LimitedStoryFrame>
  ),
} satisfies Meta<typeof DraftWorkspace>

export default meta
type Story = StoryObj<typeof meta>

export const PackAndPool: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Natural' }))
    await expect(canvas.getByRole('button', { name: 'Ranked' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Ranked' }))
    await userEvent.click(canvas.getByRole('button', { name: /Day of Judgment/ }))
    await expect(args.onPick).toHaveBeenCalledWith(draftPack[0])
    const pool = within(canvas.getByRole('complementary', { name: 'Draft pool' }))
    await userEvent.hover(pool.getByText('Llanowar Elves'))
    const inspection = within(
      canvas.getByRole('complementary', { name: 'Llanowar Elves inspection' }),
    )
    await expect(inspection.getByText('1/1')).toBeVisible()
    await expect(inspection.getByText(/Add/)).toBeVisible()
    await userEvent.unhover(pool.getByText('Llanowar Elves'))
    if (canvasElement.ownerDocument.activeElement instanceof HTMLElement) {
      canvasElement.ownerDocument.activeElement.blur()
    }
  },
}

export const PackWithoutScores: Story = {
  args: {
    pack: draftPack.map((card) => ({ ...card, score: null })),
  },
}
