import type { Meta, StoryObj } from '@storybook/react-vite'
import '../public-theme.css'
import { SelectField, TextArea, TextField } from './Field'

function Fields() {
  return (
    <div className="public-theme" style={{ minHeight: '100vh', padding: 40 }}>
      <div style={{ display: 'grid', gap: 20, maxWidth: 400 }}>
        <label style={{ display: 'grid', gap: 8 }}>
          Email
          <TextField type="email" placeholder="you@example.com" />
        </label>
        <label style={{ display: 'grid', gap: 8 }}>
          Deck list
          <TextArea rows={5} placeholder="4 Llanowar Elves" />
        </label>
        <label style={{ display: 'grid', gap: 8 }}>
          Commander
          <SelectField defaultValue="">
            <option value="">Choose a commander</option>
            <option value="atraxa">Atraxa, Praetors' Voice</option>
          </SelectField>
        </label>
        <TextField aria-label="Unavailable field" placeholder="Unavailable" disabled />
      </div>
    </div>
  )
}

const meta = {
  title: 'Shared UI/Field',
  id: 'shared-field',
  component: Fields,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Fields>

export default meta
type Story = StoryObj<typeof meta>

export const Controls: Story = {}
