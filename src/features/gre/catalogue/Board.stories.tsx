import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import type { BoardSnapshot } from '@engine/runtime/snapshot'
import { BoardStory } from './BoardStory'
import { crowdedBoard, midgameBoard, type CrowdedVariant } from './fixtures'
import { denseCreaturesBoard } from './dense-creatures-fixture'

type BoardStoryArgs = {
  board: BoardSnapshot
  crowdedVariant: CrowdedVariant
  onLegalAction: ReturnType<typeof fn>
}

const meta = {
  title: 'Gameplay/Board',
  id: 'board',
  parameters: { layout: 'fullscreen' },
  args: { board: midgameBoard(), crowdedVariant: 'hand and stack', onLegalAction: fn() },
  argTypes: {
    board: { control: false, table: { disable: true } },
    crowdedVariant: {
      control: { type: 'inline-radio' },
      options: ['hand and stack', 'dense support'],
    },
    onLegalAction: { table: { disable: true } },
  },
  render: (args) => <BoardStory board={args.board} onLegalAction={args.onLegalAction} />,
} satisfies Meta<BoardStoryArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Midgame: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('group', { name: 'Your counters' })).toHaveTextContent('Energy 3')
    await expect(canvas.getByRole('group', { name: "Opponent's counters" })).toHaveTextContent(
      'Poison 2',
    )
    const trigger = canvasElement.querySelector<HTMLButtonElement>(
      'button[data-zone="graveyard"][data-owner="self"]',
    )!
    await userEvent.click(trigger)
    await expect(screen.getByRole('button', { name: 'Close Your Graveyard' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(async () => {
      await expect(screen.queryByRole('dialog', { name: /Your Graveyard/ })).not.toBeInTheDocument()
      await expect(trigger).toHaveFocus()
    })
    const connection = canvas.getByRole('button', { name: 'Connection details' })
    await userEvent.click(connection)
    const dialog = within(screen.getByRole('dialog', { name: 'Connection details' }))
    const close = dialog.getByRole('button', { name: 'Close' })
    await waitFor(() => expect(close).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await waitFor(async () => {
      await expect(
        screen.queryByRole('dialog', { name: 'Connection details' }),
      ).not.toBeInTheDocument()
      await expect(connection).toHaveFocus()
    })
    const card = canvasElement.querySelector<HTMLElement>('[data-card="Questing Beast"]')!
    await userEvent.hover(card)
    const inspection = within(
      await screen.findByRole('complementary', { name: 'Questing Beast inspection' }),
    )
    await expect(inspection.getByRole('complementary', { name: 'Card mechanics' })).toBeVisible()
    await userEvent.unhover(card)
    await userEvent.hover(canvasElement.querySelector<HTMLElement>('[data-card="Lightning Bolt"]')!)
    await expect(
      screen.queryByRole('complementary', { name: 'Card mechanics' }),
    ).not.toBeInTheDocument()
    await userEvent.unhover(
      canvasElement.querySelector<HTMLElement>('[data-card="Lightning Bolt"]')!,
    )
  },
  args: { board: midgameBoard() },
  parameters: {
    chromatic: {
      modes: {
        desktop: { viewport: { width: 1440, height: 900 } },
        phonePortrait: { viewport: { width: 390, height: 844 } },
        phoneLandscape: { viewport: { width: 844, height: 390 } },
      },
    },
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Can seats, hand, priority, stack, and an ordinary battlefield be read at a glance? Open a public zone and confirm that closing it returns focus.',
      },
    },
  },
}

export const Crowded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const counters = canvas.getByRole('group', { name: 'Your counters' })
    await expect(counters).toHaveTextContent('Poison 8Energy 1200Experience 2400')
    const note = canvas.getByText('2 tapped lands', { exact: true })
    const life = canvasElement.querySelector('[data-player="self"] [data-life]')!
    await expect(note.getBoundingClientRect().bottom).toBeLessThan(life.getBoundingClientRect().top)
    const totals = counters.querySelectorAll('span')
    await expect(totals[totals.length - 1]!.getBoundingClientRect().top).toBeGreaterThan(
      totals[0]!.getBoundingClientRect().top,
    )
    const stack = canvas.getByRole('complementary', { name: 'Stack' })
    const entries = stack.querySelectorAll<HTMLElement>('[tabindex="0"]')
    await expect(entries.length).toBeGreaterThan(0)
    entries[entries.length - 1]!.focus()
    await expect(entries[entries.length - 1]).toHaveFocus()
    const stackBounds = entries[entries.length - 1]!.getBoundingClientRect()
    await expect(stackBounds.top).toBeLessThan(window.innerHeight)
    await expect(stackBounds.bottom).toBeGreaterThan(0)
    const hand = canvasElement.querySelectorAll<HTMLElement>(
      '[data-zone="hand"][data-owner="self"] [data-card]',
    )
    await expect(hand.length).toBeGreaterThan(0)
    hand[hand.length - 1]!.focus()
    await expect(hand[hand.length - 1]).toHaveFocus()
    const handBounds = hand[hand.length - 1]!.getBoundingClientRect()
    await expect(handBounds.left).toBeLessThan(window.innerWidth)
    await expect(handBounds.right).toBeGreaterThan(0)
    canvas.getByRole('button', { name: 'Board options' }).focus()
  },
  render: (args) => (
    <BoardStory board={crowdedBoard(args.crowdedVariant)} onLegalAction={args.onLegalAction} />
  ),
  parameters: {
    controls: { include: ['crowdedVariant'] },
    docs: {
      description: {
        story:
          'Can every hand card and stack entry remain reachable, and do dense support lanes compact into two rows? Switch between the two bounded stress cases.',
      },
    },
  },
}

export const DenseCreatures: Story = {
  args: { board: denseCreaturesBoard() },
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Can each of 64 creatures remain readable and individually inspectable, with keyboard access to both ends of each scrolling row?',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const name of ['Your creatures', 'Opponent creatures']) {
      const lane = canvas.getByRole('region', { name })
      const cards = [...lane.querySelectorAll<HTMLElement>('[data-instance-id]')]
      await expect(cards).toHaveLength(64)
      await expect(new Set(cards.map((card) => card.dataset['instanceId'])).size).toBe(64)
      await expect(lane.scrollWidth).toBeGreaterThan(lane.clientWidth)
      lane.focus()
      await expect(lane).toHaveFocus()
      for (const card of [cards[0]!, cards[cards.length - 1]!]) {
        card.focus()
        await waitFor(async () => {
          const bounds = card.getBoundingClientRect()
          const viewport = lane.getBoundingClientRect()
          await expect(bounds.width).toBeGreaterThanOrEqual(84)
          await expect(bounds.height).toBeGreaterThanOrEqual(44)
          await expect(bounds.left).toBeGreaterThanOrEqual(viewport.left)
          await expect(bounds.right).toBeLessThanOrEqual(viewport.right)
          await expect(bounds.top).toBeGreaterThanOrEqual(viewport.top + 6)
          await expect(bounds.bottom).toBeLessThanOrEqual(viewport.bottom - 6)
        })
        await expect(card).toHaveFocus()
        await expect(
          screen.getByRole('complementary', { name: 'Scute Swarm inspection' }),
        ).toBeVisible()
      }
      lane.focus()
      for (const card of cards) {
        await userEvent.tab()
        await expect(card).toHaveFocus()
        await waitFor(async () => {
          const bounds = card.getBoundingClientRect()
          const viewport = lane.getBoundingClientRect()
          await expect(bounds.left).toBeGreaterThanOrEqual(viewport.left)
          await expect(bounds.right).toBeLessThanOrEqual(viewport.right)
        })
      }
      cards[0]!.focus()
    }
    const lane = canvas.getByRole('region', { name: 'Your creatures' })
    lane.focus()
    const target = lane.querySelector<HTMLElement>('[data-instance-id]')!
    await waitFor(async () => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(target).transform)
      await expect(Math.hypot(matrix.a, matrix.b)).toBeCloseTo(1, 3)
    })
    const arrow = canvasElement.querySelector<SVGPathElement>('[data-arrow-kind="targetSpec"]')!
    const previous = arrow.getAttribute('d')
    lane.scrollLeft += 200
    await waitFor(async () => {
      await expect(arrow.getAttribute('d')).not.toBe(previous)
      const point = arrow
        .getPointAtLength(arrow.getTotalLength())
        .matrixTransform(arrow.getScreenCTM()!)
      const bounds = target.getBoundingClientRect()
      await expect(point.x).toBeGreaterThanOrEqual(bounds.left - 8)
      await expect(point.x).toBeLessThanOrEqual(bounds.right + 8)
      await expect(point.y).toBeGreaterThanOrEqual(bounds.top - 8)
      await expect(point.y).toBeLessThanOrEqual(bounds.bottom + 8)
    })
    lane.scrollLeft = 0
    canvas.getByRole('button', { name: 'Board options' }).focus()
  },
}
