import type { Meta, StoryObj } from '@storybook/react-vite'
import '../public-theme.css'
import { Button } from './Button'

function ButtonVariants() {
  return (
    <div className="public-theme" style={{ minHeight: '100vh', padding: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button>Continue</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="secondary" size="compact">
          Import
        </Button>
        <Button size="compact">Save deck</Button>
        <Button variant="danger" size="compact">
          Delete
        </Button>
        <Button size="compact" disabled>
          Save deck
        </Button>
      </div>
    </div>
  )
}

const meta = {
  title: 'Shared UI/Button',
  id: 'shared-button',
  component: ButtonVariants,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ButtonVariants>

export default meta
type Story = StoryObj<typeof meta>

export const Variants: Story = {}
