import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { LimitedStoryFrame, limitedSets } from './Limited.stories.fixtures'
import { SetPicker } from './SetPicker'

const meta = {
  title: 'Gameplay/Draft/Set selection',
  id: 'gameplay-draft-set-selection',
  component: SetPicker,
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  args: {
    sets: limitedSets,
    selectedCode: 'FDN',
    onSelect: fn(),
  },
  render: (args) => (
    <LimitedStoryFrame>
      <div style={{ width: 760, maxWidth: '100%', margin: '0 auto' }}>
        <SetPicker {...args} />
      </div>
    </LimitedStoryFrame>
  ),
} satisfies Meta<typeof SetPicker>

export default meta
type Story = StoryObj<typeof meta>

export const BrowseSets: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Change set' }))
    const dialog = within(
      within(canvasElement.ownerDocument.body).getByRole('dialog', { name: 'Choose a set' }),
    )
    await userEvent.type(dialog.getByRole('textbox', { name: 'Search sets' }), 'Tarkir')
    const tarkir = dialog.getByRole('button', { name: /Tarkir: Dragonstorm/ })
    await expect(tarkir).toBeVisible()
    await userEvent.click(tarkir)
    await expect(args.onSelect).toHaveBeenCalledWith('TDM')
  },
}
