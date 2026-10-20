import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { useState } from 'react'
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

const equipCommander: MechanicHelp = {
  keyword: 'Equip',
  title: 'Equip',
  cost: '{3}',
  description: 'Attach to target commander you control. Activate only as a sorcery.',
}
const equipCreature: MechanicHelp = {
  keyword: 'Equip',
  title: 'Equip',
  cost: '{5}',
  description: 'Attach to target creature you control. Activate only as a sorcery.',
}
const vigilance: MechanicHelp = {
  keyword: 'Vigilance',
  title: 'Vigilance',
  description: "Attacking doesn't cause this creature to tap.",
}
const repeatedStages = [
  [equipCommander, equipCreature],
  [equipCreature, equipCommander],
  [vigilance, equipCommander, equipCreature],
  [equipCreature],
  [equipCommander, equipCreature],
]

function RepeatedHelp() {
  const [stage, setStage] = useState(0)
  return (
    <div>
      <CardMechanicHelp items={repeatedStages[stage]!} />
      <button onClick={() => setStage((stage + 1) % repeatedStages.length)}>
        Change help entries
      </button>
    </div>
  )
}

type Density = 'single' | 'several' | 'dense' | 'repeated'
const itemsByDensity: Record<Density, MechanicHelp[]> = {
  repeated: [equipCommander, equipCreature],
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
    density: { control: 'inline-radio', options: ['single', 'several', 'dense', 'repeated'] },
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
        <Card
          card={
            (globals['mechanicHelpDensity'] ?? density) === 'repeated'
              ? {
                  ...bitingPalmNinja,
                  name: "Commander's Plate",
                  typeLine: 'Legendary Artifact — Equipment',
                  manaCost: '{1}',
                  powerToughness: '',
                  keywords: ['Equip'],
                }
              : bitingPalmNinja
          }
          variant="preview"
          actionChrome={false}
        />
        {(globals['mechanicHelpDensity'] ?? density) === 'repeated' ? (
          <RepeatedHelp />
        ) : (
          <CardMechanicHelp
            items={
              itemsByDensity[(globals['mechanicHelpDensity'] as Density | undefined) ?? density]
            }
          />
        )}
      </div>
    </div>
  ),
} satisfies Meta<{ density: Density }>

export default meta
type Story = StoryObj<typeof meta>

export const Panel: Story = {
  play: async ({ canvasElement, args, globals }) => {
    if ((globals['mechanicHelpDensity'] ?? args.density) === 'repeated') {
      const canvas = within(canvasElement)
      const help = canvas.getByRole('complementary', { name: 'Card mechanics' })
      const original = within(help).getAllByRole('heading')
      for (const [stage, expected] of repeatedStages.entries()) {
        if (stage > 0) {
          await userEvent.click(canvas.getByRole('button', { name: 'Change help entries' }))
        }
        const headings = within(help).getAllByRole('heading')
        await expect(headings).toHaveLength(expected.length)
        for (const [index, item] of expected.entries()) {
          await expect(help).toHaveTextContent(item.description)
          if (item === equipCreature) {
            await expect(headings[index]).toBe(original[1])
          }
          if (item === equipCommander && stage < 3) {
            await expect(headings[index]).toBe(original[0])
          }
        }
      }
      await expect(within(help).getByLabelText('Cost 3')).toBeVisible()
      await expect(within(help).getByLabelText('Cost 5')).toBeVisible()
      return
    }
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
        repeated: { viewport: { width: 1440, height: 900 }, mechanicHelpDensity: 'repeated' },
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
