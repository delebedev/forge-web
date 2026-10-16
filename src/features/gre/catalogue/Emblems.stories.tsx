import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, within } from 'storybook/test'
import { applyGsm, EMPTY_GAME_STATE } from '@engine/state/gre-accumulator'
import { buildBoardProjection } from '@engine/state/gre-projection'
import type { CardMeta } from '@engine/state/gre-state'
import { createFixture } from './fixture-builder'
import { BoardStory } from './BoardStory'

type EmblemsArgs = { stage: 'persistent' | 'trigger'; onLegalAction: ReturnType<typeof fn> }

function emblemBoard(stage: EmblemsArgs['stage']) {
  const sourceId = 1000
  const abilityId = 9000
  const metadata = new Map<number, CardMeta>([
    [
      sourceId,
      {
        grpId: sourceId,
        name: 'Sephiroth, One-Winged Angel',
        imageUrl:
          'https://api.scryfall.com/cards/named?exact=Sephiroth%2C+Fabled+SOLDIER&format=image&version=normal&face=back',
        types: 'Creature',
        power: '5',
        toughness: '5',
        manaCost: '{3}{B}',
        abilities: {
          [abilityId]: {
            text: 'Whenever a creature dies, target opponent loses 1 life and you gain 1 life.',
          },
        },
      },
    ],
  ])
  const emblems = [
    {
      instanceId: 131,
      type: 4,
      grpId: 2,
      objectSourceGrpId: sourceId,
      parentId: 103,
      ownerSeatId: 1,
      controllerSeatId: 1,
      visibility: 1,
      zoneId: 26,
      uniqueAbilities: [{ id: 50, grpId: abilityId }],
    },
    {
      instanceId: 132,
      type: 4,
      grpId: 2,
      objectSourceGrpId: sourceId,
      parentId: 104,
      ownerSeatId: 1,
      controllerSeatId: 1,
      visibility: 1,
      zoneId: 26,
      uniqueAbilities: [{ id: 50, grpId: abilityId }],
    },
    {
      instanceId: 133,
      type: 4,
      grpId: 2,
      objectSourceGrpId: sourceId,
      parentId: 105,
      ownerSeatId: 2,
      controllerSeatId: 2,
      visibility: 1,
      zoneId: 26,
      uniqueAbilities: [{ id: 50, grpId: abilityId }],
    },
  ]
  const state = applyGsm(EMPTY_GAME_STATE, {
    type: 1,
    gameStateId: 12,
    players: [
      { systemSeatNumber: 1, lifeTotal: 25 },
      { systemSeatNumber: 2, lifeTotal: 1 },
    ],
    turnInfo: { turnNumber: 1, phase: 5, activePlayer: 1, priorityPlayer: 1 },
    zones: [
      {
        zoneId: 26,
        type: 7,
        ownerSeatId: 0,
        objectInstanceIds: emblems.map((object) => object.instanceId),
      },
      { zoneId: 27, type: 4, objectInstanceIds: stage === 'trigger' ? [144] : [] },
    ],
    gameObjects: [
      ...emblems,
      ...(stage === 'trigger'
        ? [
            {
              instanceId: 144,
              type: 3,
              grpId: abilityId,
              objectSourceGrpId: 2,
              parentId: 131,
              zoneId: 27,
              ownerSeatId: 1,
              controllerSeatId: 1,
            },
          ]
        : []),
    ],
  })
  return { ...createFixture().board(), ...buildBoardProjection(state, metadata, false) }
}

const meta = {
  title: 'Gameplay/Objects/Emblems',
  id: 'objects-emblems',
  parameters: { layout: 'fullscreen' },
  args: { stage: 'persistent', onLegalAction: fn() },
  argTypes: {
    stage: { control: { type: 'inline-radio' }, options: ['persistent', 'trigger'] },
    onLegalAction: { table: { disable: true } },
  },
  render: (args) => (
    <BoardStory board={emblemBoard(args.stage)} onLegalAction={args.onLegalAction} />
  ),
} satisfies Meta<EmblemsArgs>

export default meta
type Story = StoryObj<typeof meta>
export const Persistent: Story = {}
export const Trigger: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tiles = within(canvas.getByRole('group', { name: 'Your emblem tiles' }))
    const buttons = tiles.getAllByRole('button')
    buttons[0]!.focus()
    const inspection = await screen.findByRole('complementary', {
      name: 'Sephiroth, One-Winged Angel inspection',
    })
    await expect(inspection).toHaveTextContent('Whenever a creature dies')
    await expect(inspection.querySelector('[data-pt]')).not.toBeInTheDocument()
    await userEvent.click(buttons[0]!)
    await expect(screen.queryByRole('dialog', { name: /Emblems/ })).not.toBeInTheDocument()
    await userEvent.click(
      within(canvas.getByRole('group', { name: "Opponent's emblem tiles" })).getByRole('button'),
    )
    await expect(inspection).toHaveTextContent('Whenever a creature dies')
    canvas.getByRole('button', { name: 'Board options' }).focus()
  },
  args: { stage: 'trigger' },
}
