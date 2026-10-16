import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { MotionBoardStory } from './BoardStory'
import { motionBoards } from './fixtures'

const meta = {
  title: 'Gameplay/Motion',
  id: 'motion',
  component: MotionBoardStory,
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  args: { onLegalAction: fn() },
} satisfies Meta<typeof MotionBoardStory>

export default meta
type Story = StoryObj<typeof meta>

export const CardTravel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const controls = within(canvas.getByLabelText('Fixture controls'))
    await userEvent.click(controls.getByRole('button', { name: 'Step' }))
    await expect(controls.getByText('2 of 3')).toBeVisible()
    await waitFor(async () => {
      const sprite = canvasElement.querySelector<HTMLElement>(
        '[data-motion-from="hand"][data-motion-to="stack"]',
      )
      await expect(sprite).toBeInTheDocument()
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await expect(sprite).not.toBeVisible()
      } else {
        await expect(sprite).toBeVisible()
      }
    })
    await userEvent.click(controls.getByRole('button', { name: 'Step' }))
    await expect(controls.getByText('3 of 3')).toBeVisible()
    await expect(controls.getByRole('button', { name: 'Step' })).toBeDisabled()
    await userEvent.click(controls.getByRole('button', { name: 'Reset' }))
    await expect(controls.getByText('1 of 3')).toBeVisible()
    await expect(controls.getByRole('button', { name: 'Reset' })).toBeDisabled()
  },
  name: 'Card travel',
  args: { boards: motionBoards() },
  parameters: {
    docs: {
      description: {
        story:
          'Does one card travel from hand to stack to graveyard while the board stays mounted and life feedback remains continuous? Press Step twice, Reset, then inspect reduced motion.',
      },
    },
  },
}

export const ReducedMotion: Story = {
  ...CardTravel,
  name: 'Reduced motion',
  parameters: {
    ...CardTravel.parameters,
    chromatic: { prefersReducedMotion: 'reduce' },
  },
}
