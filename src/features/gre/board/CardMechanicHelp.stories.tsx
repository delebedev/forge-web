import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import type { CardView, MechanicHelp } from '@engine/state/gre-state'
import { Card } from './Card'
import { CardMechanicHelp } from './CardMechanicHelp'

const bitingPalmNinja: CardView = {
  instanceId: 1,
  grpId: 1,
  name: 'Biting-Palm Ninja',
  typeLine: 'Creature — Human Ninja',
  manaCost: '{2}{B}',
  powerToughness: '3/3',
  tapped: false,
  attacking: false,
  playableLand: false,
  playableSpell: false,
  playableActivation: false,
  imageUrl: '',
  controllerSeatId: 1,
  keywords: ['Menace', 'Ninjutsu'],
}

const ninjutsu: MechanicHelp = {
  keyword: 'Ninjutsu',
  title: 'Ninjutsu',
  cost: '{3}{B}',
  description:
    'Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.',
}

type Density = 'single' | 'several' | 'dense'
const itemsByDensity: Record<Density, MechanicHelp[]> = {
  single: [ninjutsu],
  several: [
    ninjutsu,
    {
      keyword: 'Menace',
      title: 'Menace',
      description: "This creature can't be blocked except by two or more creatures.",
    },
  ],
  dense: [
    ninjutsu,
    {
      keyword: 'Flying',
      title: 'Flying',
      description: 'This creature can only be blocked by creatures with flying or reach.',
    },
    {
      keyword: 'First strike',
      title: 'First strike',
      description: 'This creature deals combat damage before creatures without first strike.',
    },
    {
      keyword: 'Vigilance',
      title: 'Vigilance',
      description: "Attacking doesn't cause this creature to tap.",
    },
    {
      keyword: 'Trample',
      title: 'Trample',
      description:
        'Excess combat damage can be dealt to the player or permanent this creature is attacking.',
    },
    {
      keyword: 'Haste',
      title: 'Haste',
      description: 'This creature can attack and tap as soon as it comes under your control.',
    },
    {
      keyword: 'Menace',
      title: 'Menace',
      description: "This creature can't be blocked except by two or more creatures.",
    },
    {
      keyword: 'Deathtouch',
      title: 'Deathtouch',
      description: 'Any amount of damage this deals to a creature is enough to destroy it.',
    },
    {
      keyword: 'Lifelink',
      title: 'Lifelink',
      description: 'Damage dealt by this creature also causes you to gain that much life.',
    },
  ],
}

const meta = {
  title: 'Cards/Mechanic help',
  id: 'board-card-mechanic-help',
  parameters: { layout: 'fullscreen', controls: { include: ['density'] } },
  args: { density: 'single' },
  argTypes: {
    density: { control: 'inline-radio', options: ['single', 'several', 'dense'] },
  },
  render: ({ density }, { globals }) => (
    <div
      style={{
        display: 'grid',
        width: '100%',
        height: '100%',
        placeItems: 'center',
        padding: 32,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          ...((globals['mechanicHelpDensity'] ?? density) === 'dense'
            ? { width: 420, height: 320, containerType: 'size' }
            : {}),
        }}
      >
        <Card card={bitingPalmNinja} variant="preview" actionChrome={false} />
        <CardMechanicHelp
          items={itemsByDensity[(globals['mechanicHelpDensity'] as Density | undefined) ?? density]}
        />
      </div>
    </div>
  ),
} satisfies Meta<{ density: Density }>

export default meta
type Story = StoryObj<typeof meta>

export const Panel: Story = {
  play: async ({ canvasElement, args, globals }) => {
    if ((globals['mechanicHelpDensity'] ?? args.density) !== 'dense') {
      return
    }
    const help = within(canvasElement).getByRole('complementary', { name: 'Card mechanics' })
    await expect(help.scrollHeight).toBeGreaterThan(help.clientHeight)
    help.scrollTop = help.scrollHeight
    const last = within(help).getByRole('heading', { name: 'Lifelink' }).getBoundingClientRect()
    await expect(last.bottom).toBeLessThanOrEqual(help.getBoundingClientRect().bottom)
    help.scrollTop = 0
  },
  parameters: {
    chromatic: {
      modes: {
        desktop: { viewport: { width: 1440, height: 900 }, mechanicHelpDensity: 'single' },
        dense: { viewport: { width: 1440, height: 900 }, mechanicHelpDensity: 'dense' },
      },
    },
    docs: {
      description: {
        story:
          'Does mechanic help stay readable beside the inspected card? Density selects one mechanic, several mechanics, or a scrollable stress case.',
      },
    },
  },
}
