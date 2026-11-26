import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { BoardStory } from './BoardStory'
import { attachmentsBoard, type AttachmentStage } from './fixtures'

type AttachmentsArgs = { stage: AttachmentStage; onLegalAction: ReturnType<typeof fn> }

const meta = {
  title: 'Gameplay/Objects/Attachments',
  id: 'objects',
  parameters: { layout: 'fullscreen' },
  args: { stage: 'attached', onLegalAction: fn() },
  argTypes: {
    stage: {
      control: { type: 'inline-radio' },
      options: ['attached', 'counter changed', 'reattached'],
    },
    onLegalAction: { table: { disable: true } },
  },
  render: (args) => (
    <BoardStory board={attachmentsBoard(args.stage)} onLegalAction={args.onLegalAction} />
  ),
} satisfies Meta<AttachmentsArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Attachments: Story = {
  parameters: {
    controls: { include: ['stage'] },
    docs: {
      description: {
        story:
          'Do Aura and Equipment ownership, granted keywords, counters, totals, removal, and reattachment remain legible? Move through the three accumulator-projected states.',
      },
    },
  },
}
