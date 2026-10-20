import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { useState } from 'react'
import { BoardStory } from './BoardStory'
import { outsideHandBoard } from './fixtures'
import styles from './BoardStory.module.css'

const meta = {
  title: 'Gameplay/Actions',
  id: 'actions',
  component: BoardStory,
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  args: { onLegalAction: fn() },
} satisfies Meta<typeof BoardStory>

export default meta
type Story = StoryObj<typeof meta>

export const OutsideTheHand: Story = {
  name: 'Outside the hand',
  args: { board: outsideHandBoard() },
  parameters: {
    docs: {
      description: {
        story:
          'Does a long legal-only rail remain reachable without covering the hand or pass action? Open both faces of the same Adventure card and inspect the exact callback payloads in Storybook.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Choose action for Bramble Familiar from exile' }),
    )
    await userEvent.click(
      canvas.getByRole('button', { name: 'Cast Bramble Familiar (Adventure) from exile' }),
    )
    await expect(args.onLegalAction).toHaveBeenCalledWith(
      args.board.legalActions.find(
        (action) => action.label === 'Cast Bramble Familiar (Adventure) from exile',
      ),
    )
    await userEvent.click(
      canvas.getByRole('button', { name: 'Choose action for Bramble Familiar from exile' }),
    )
    await userEvent.click(
      canvas.getByRole('button', {
        name: 'Cast Bramble Familiar (Adventure alternate) from exile',
      }),
    )
    await expect(args.onLegalAction).toHaveBeenLastCalledWith(
      args.board.legalActions.find(
        (action) => action.label === 'Cast Bramble Familiar (Adventure alternate) from exile',
      ),
    )
  },
}

function ChangingAvailability({
  onLegalAction,
}: {
  onLegalAction: typeof meta.args.onLegalAction
}) {
  const [available, setAvailable] = useState(true)
  const [board] = useState(outsideHandBoard)
  const displayed = available
    ? board
    : {
        ...board,
        canPass: false,
        prioritySeatId: board.opponentSeatId,
        legalActions: [],
        nonHandActionCards: [],
      }
  return (
    <>
      <BoardStory board={displayed} onLegalAction={onLegalAction} />
      <div className={styles.fixtureControls}>
        <button onClick={() => setAvailable(!available)}>
          {available ? 'Opponent priority' : 'Your priority'}
        </button>
      </div>
    </>
  )
}

export const ChangingPriority: Story = {
  args: { board: outsideHandBoard() },
  render: ({ onLegalAction }) => <ChangingAvailability onLegalAction={onLegalAction} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const hand = canvas.getByRole('region', { name: 'Your hand: 2 cards' })
    const cards = [...hand.querySelectorAll<HTMLElement>('[data-instance-id]')]
    const before = cards.map((card) => card.getBoundingClientRect())
    await userEvent.click(canvas.getByRole('button', { name: /^Opponent priority$/ }))
    await expect(canvas.queryByRole('region', { name: 'Cards outside your hand' })).toBeNull()
    for (const [index, card] of cards.entries()) {
      await expect(card.isConnected).toBe(true)
      await expect(card.getBoundingClientRect().x).toBeCloseTo(before[index]!.x, 1)
      await expect(card.getBoundingClientRect().width).toBeCloseTo(before[index]!.width, 1)
    }
    await userEvent.click(canvas.getByRole('button', { name: /^Your priority$/ }))
    await expect(canvas.getByRole('region', { name: 'Cards outside your hand' })).toBeVisible()
    for (const [index, card] of cards.entries()) {
      await expect(card.getBoundingClientRect().x).toBeCloseTo(before[index]!.x, 1)
      await expect(card.getBoundingClientRect().width).toBeCloseTo(before[index]!.width, 1)
    }
  },
  parameters: {
    docs: {
      description: {
        story:
          'Do hand cards keep their positions when outside-hand offers retire and return with priority?',
      },
    },
  },
}
