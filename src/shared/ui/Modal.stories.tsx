import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor } from 'storybook/test'
import '../public-theme.css'
import { Modal } from './Modal'
import { TextField } from './Field'

function DialogPilot() {
  const [open, setOpen] = useState(false)
  return (
    <div className="public-theme" style={{ minHeight: '100vh', padding: 40 }}>
      <button className="public-primary" onClick={() => setOpen(true)}>
        Choose a deck
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Choose a deck" maxWidth="640px">
        <div style={{ padding: 24 }}>
          <p>Select a deck for this match.</p>
          <TextField aria-label="Search decks" placeholder="Search decks" autoFocus />
        </div>
      </Modal>
    </div>
  )
}

const meta = {
  title: 'Shared UI/Modal',
  id: 'shared-modal',
  component: DialogPilot,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DialogPilot>

export default meta
type Story = StoryObj<typeof meta>

export const DeckChoice: Story = {
  play: async () => {
    const trigger = screen.getByRole('button', { name: 'Choose a deck' })
    await userEvent.click(trigger)
    await expect(screen.getByRole('dialog', { name: 'Choose a deck' })).toBeVisible()
    await expect(screen.getByRole('textbox', { name: 'Search decks' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(async () => {
      await expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await expect(trigger).toHaveFocus()
    })
    await userEvent.click(trigger)
    await userEvent.click(document.elementFromPoint(24, 24)!)
    await waitFor(async () => {
      await expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await expect(trigger).toHaveFocus()
    })
    await userEvent.click(trigger)
    await expect(screen.getByRole('dialog', { name: 'Choose a deck' })).toBeVisible()
  },
}
