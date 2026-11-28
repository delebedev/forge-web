import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import '../../shell/public-theme.css'
import { BrowserStoppedPanel } from './BrowserStoppedPanel'

const meta = {
  title: 'Gameplay/Session/Stopped game',
  component: BrowserStoppedPanel,
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  args: {
    error: 'The local engine stopped making progress.',
    recoveryFailed: false,
    courseUnsaved: false,
    onRecover: fn(),
    onStartAgain: fn(),
    onChooseDeck: fn(),
    reportUrl: '#report',
  },
  render: (args) => (
    <div style={{ position: 'relative', height: '100vh' }}>
      <BrowserStoppedPanel {...args} />
    </div>
  ),
} satisfies Meta<typeof BrowserStoppedPanel>

export default meta
type Story = StoryObj<typeof meta>

export const RecoveryOffered: Story = {
  name: 'Recovery offered',
  play: async ({ canvasElement, args }) => {
    const panel = within(within(canvasElement).getByRole('alert'))
    await expect(panel.getByText('Browser game stopped')).toBeVisible()
    await expect(panel.getByText(args.error)).toBeVisible()
    await expect(panel.queryByRole('button', { name: 'Start again' })).toBeNull()
    await userEvent.click(panel.getByRole('button', { name: 'Recover game' }))
    await expect(args.onRecover).toHaveBeenCalledOnce()
  },
}

export const RecoveryFailed: Story = {
  name: 'Recovery failed',
  args: {
    error: 'The recovered decision differs from the saved match.',
    recoveryFailed: true,
    onRecover: undefined,
  },
  play: async ({ canvasElement, args }) => {
    const panel = within(within(canvasElement).getByRole('alert'))
    await expect(panel.getByText('Game could not be recovered')).toBeVisible()
    await expect(panel.getByText(args.error)).toBeVisible()
    await userEvent.click(panel.getByRole('button', { name: 'Start again' }))
    await expect(args.onStartAgain).toHaveBeenCalledOnce()
  },
}

export const UnsavedCourseResult: Story = {
  name: 'Unsaved course result',
  args: { recoveryFailed: true, onRecover: undefined, courseUnsaved: true },
  play: async ({ canvasElement }) => {
    const panel = within(within(canvasElement).getByRole('alert'))
    await expect(panel.queryByRole('button', { name: 'Start again' })).toBeNull()
    await expect(panel.getByRole('button', { name: 'Choose another deck' })).toBeVisible()
  },
}
