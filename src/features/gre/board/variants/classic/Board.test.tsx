import { READ_ONLY_INTERACTIONS } from '../../read-only-interactions'
import { attachmentsBoard } from '../../../catalogue/fixtures'
import { createFixture } from '../../../catalogue/fixture-builder'
import { counterIcon } from '@shared/cards/mana'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BoardSnapshot } from '@engine/runtime/snapshot'
import type { LegalAction } from '@engine/state/gre-state'
import { boardView } from '../../board-view'
import { Card, cardIsPlayable } from '../../Card'
import { Board, CardActionChooser } from './Board'

function action(overrides: Partial<LegalAction>): LegalAction {
  return {
    actionType: 2,
    instanceId: 101,
    grpId: 123,
    facetId: 0,
    abilityGrpId: 456,
    uniqueAbilityId: 0,
    sourceId: 0,
    alternativeGrpId: 0,
    alternativeSourceZcid: 0,
    zoneType: 2,
    hasAlternativeCost: false,
    label: 'Memory Cycle — Cycling {2}',
    cardName: 'Memory Cycle',
    shouldStop: true,
    ...overrides,
  }
}

test('multi-action chooser paints semantic labels and keeps command identity in data', () => {
  const html = renderToStaticMarkup(
    <CardActionChooser
      cardName="Memory Cycle"
      actions={[
        action({}),
        action({ actionType: 1, abilityGrpId: 0, label: 'Cast Memory Cycle' }),
        action({
          actionType: 1,
          abilityGrpId: 0,
          alternativeGrpId: 321,
          hasAlternativeCost: true,
          label: 'Cast Memory Cycle for its alternate cost',
        }),
        action({
          abilityGrpId: 789,
          uniqueAbilityId: 12,
          label: 'Memory Cycle — Discard a card: Draw a card.',
        }),
      ]}
      onAction={() => {}}
      onClose={() => {}}
    />,
  )
  const visibleText = html.replace(/ data-[\w-]+="[^"]*"/g, '')

  expect(html).toContain('data-action-key="1:101:123:0:0:0:0:0:0:2"')
  expect(html).toContain('data-action-type="1"')
  expect(html).toContain('data-alternative-cost="false"')
  expect(html).toContain('data-alternative-cost="true"')
  expect(html).toContain('data-ability-grp-id="789"')
  expect(visibleText).toContain('Cycling {2}')
  expect(visibleText).toContain('Discard a card: Draw a card.')
  expect(visibleText).not.toMatch(/\b(?:grp|iid|ability)\s*\d+/i)
})

test('action chooser shows each face cost', () => {
  const html = renderToStaticMarkup(
    <CardActionChooser
      cardName="Dead // Gone"
      actions={[
        action({ actionType: 10, label: 'Cast Dead (Left half)', manaCost: '{R}' }),
        action({ actionType: 11, label: 'Cast Gone (Right half)', manaCost: '{2}{R}' }),
      ]}
      onAction={() => {}}
      onClose={() => {}}
    />,
  )

  expect(html).toContain('Cast Dead (Left half)<span> · {R}</span>')
  expect(html).toContain('Cast Gone (Right half)<span> · {2}{R}</span>')
})

test('battlefield Room shows both current door states', () => {
  const card = {
    instanceId: 101,
    grpId: 900,
    name: 'Surgical Suite // Hospital Room',
    typeLine: 'Enchantment — Room',
    manaCost: '',
    powerToughness: '',
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    imageUrl: '',
    controllerSeatId: 1,
    roomDoors: [
      { grpId: 901, name: 'Surgical Suite', manaCost: '{1}{W}', unlocked: true },
      { grpId: 902, name: 'Hospital Room', manaCost: '{3}{W}', unlocked: false },
    ],
  }
  const html = renderToStaticMarkup(<Card card={card} variant="board" />)

  expect(html).toContain('aria-label="Surgical Suite: unlocked"')
  expect(html).toContain('aria-label="Hospital Room: locked"')
})

test('visible gameplay card images load eagerly', () => {
  const { card } = createFixture()
  const visible = card('Llanowar Elves', { art: 'https://cards.example/normal/llanowar.jpg' })
  const html = [
    renderToStaticMarkup(<Card card={visible} variant="board" />),
    renderToStaticMarkup(<Card card={visible} variant="hand" />),
  ].join('')

  expect(html).toContain('src="https://cards.example/art_crop/llanowar.jpg"')
  expect(html).not.toContain('src="https://cards.example/normal/llanowar.jpg"')
  expect(html).not.toContain('loading="lazy"')
})

test('card action tuples keep normal and distinct alternate casts correlated', () => {
  const card = {
    instanceId: 101,
    grpId: 123,
    name: 'Branching Card',
    typeLine: 'Creature',
    manaCost: '',
    powerToughness: '2/2',
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    imageUrl: '',
    controllerSeatId: 1,
  }

  expect(cardIsPlayable(card, [16])).toBe(true)
  expect(cardIsPlayable(card, [])).toBe(false)
  expect(cardIsPlayable({ ...card, playableSpell: true })).toBe(true)

  const html = renderToStaticMarkup(
    <Card
      card={card}
      actions={[
        action({ actionType: 1, abilityGrpId: 0 }),
        action({
          actionType: 1,
          abilityGrpId: 179264,
          alternativeGrpId: 170,
          hasAlternativeCost: true,
        }),
        action({
          actionType: 1,
          abilityGrpId: 179265,
          alternativeGrpId: 199,
          hasAlternativeCost: true,
        }),
        action({ actionType: 2, abilityGrpId: 789 }),
      ]}
    />,
  )
  expect(html).toContain('data-action-types="1 1 1 2"')
  expect(html).toContain('1:0')
  expect(html).toContain('1:1:179264')
  expect(html).toContain('1:1:179265')
  expect(html).toContain('1:ability:179264')
  expect(html).not.toContain('1:0:179264')
  expect(html).not.toContain('2:1:789')
})

function supportBoard(count: number): BoardSnapshot {
  const { board, card, land } = createFixture(9000)
  const landNames = ['Forest', 'Island', 'Plains', 'Mountain']
  const support = (owner?: 'opponent') => [
    ...landNames.slice(0, count).map((name) => land(name, { owner })),
    ...Array.from({ length: count }, (_, index) =>
      card('Treasure', { type: 'Artifact — Treasure', tapped: index % 3 === 2, owner }),
    ),
  ]
  return board({
    battlefield: support(),
    opponentBattlefield: support('opponent'),
  })
}

function renderBoard(board: BoardSnapshot = attachmentsBoard('attached')) {
  return renderToStaticMarkup(
    <Board
      board={board}
      interactive
      embedded={false}
      interactions={READ_ONLY_INTERACTIONS}
      stops={new Set()}
      canRespond={false}
      passing={false}
      onToggleStop={() => {}}
      onPassPriority={() => {}}
      onResolveAll={() => {}}
      onEndTurn={() => {}}
      onLegalAction={() => {}}
      hoveredCard={null}
      onHover={() => {}}
      zoneViewer={null}
      onOpenZone={() => {}}
      onCloseZone={() => {}}
      dropZoneRef={() => {}}
    />,
  )
}

function render(stage: string | null) {
  return renderBoard(
    attachmentsBoard(
      stage === 'grown' ? 'counter changed' : stage === 'removed' ? 'reattached' : 'attached',
    ),
  )
}

test('standard board shows puzzle context and launcher controls', () => {
  const board = attachmentsBoard('attached')
  const html = renderToStaticMarkup(
    <Board
      board={board}
      interactive
      embedded={false}
      interactions={READ_ONLY_INTERACTIONS}
      stops={new Set()}
      canRespond={false}
      passing={false}
      onToggleStop={() => {}}
      onPassPriority={() => {}}
      onResolveAll={() => {}}
      onEndTurn={() => {}}
      onLegalAction={() => {}}
      hoveredCard={null}
      onHover={() => {}}
      zoneViewer={null}
      onOpenZone={() => {}}
      onCloseZone={() => {}}
      dropZoneRef={() => {}}
      onBackToPlay={() => {}}
      onPlayAgain={() => {}}
      context={{ label: 'Scry Wall of Runes', objective: 'Put the revealed card on the bottom.' }}
      backLabel="Return to Challenges"
      playAgainLabel="Restart"
    />,
  )

  expect(html).toContain('aria-label="Puzzle objective"')
  expect(html).toContain('Scry Wall of Runes')
  expect(html).toContain('Put the revealed card on the bottom.')
  expect(html).toContain('Return to Challenges')
  expect(html).toContain('Restart')
})

test('zero life remains visible on the player plate', () => {
  const board = attachmentsBoard('attached')
  expect(renderBoard({ ...board, viewer: { ...board.viewer, lifeTotal: 0 } })).toContain(
    'data-life="0">0</strong>',
  )
})

test('authorized library top makes only the viewer library inspectable', () => {
  const { board, card } = createFixture(9100)
  const html = renderBoard(board({ libraryTop: card('Command Tower') }))

  expect(html).toContain('<button data-zone="library" data-owner="self"')
  expect(html).toContain('title="Inspect the top of your library"')
  expect(html).toContain('<span data-zone="library" data-owner="opponent"')
})

test('support lanes compact into two rows after three piles', () => {
  expect(renderBoard(supportBoard(3))).not.toContain('--support-card-max')
  const compact = renderBoard(supportBoard(4))
  expect(compact).toContain('data-piles="4"')
  expect(compact.match(/--support-card-max:/g)).toHaveLength(4)
})

test('same board renders cross-controller attachments once and keeps equipment action identity', () => {
  const html = render(null)
  expect(html).toContain('data-attachment-host="101"')
  expect(html.match(/data-card="Pacifism"/g)).toHaveLength(1)
  expect(html).toMatch(/data-card="Pacifism" data-attached-to="101" data-controller-seat="2"/)
  expect(html).toContain('aria-label="Activate Swiftfoot Boots"')
  expect(html).toContain('class="ms ms-counter-plus"')
  expect(html).toContain('aria-label="3 +1/+1 counters"')
  expect(html).toContain('class="ms ms-counter-stun"')
  expect(html).toContain('data-pt="7/5"')
})

test('disconnected board keeps session chrome and hides stale game input', () => {
  const board = {
    ...attachmentsBoard('attached'),
    currentMatchId: 'disconnected-match',
    connected: false,
    connectionClose: { category: 'transient' as const, code: 1006 },
    prompt: {
      interactionKey: 12,
      kind: 'mulligan' as const,
      result: 'Keep or mulligan',
      message: 'MulliganReq',
    },
    canPass: true,
  }
  const html = renderToStaticMarkup(
    <Board
      board={board}
      interactive
      inputEnabled={false}
      embedded={false}
      interactions={READ_ONLY_INTERACTIONS}
      stops={new Set()}
      canRespond
      passing={false}
      onToggleStop={() => {}}
      onPassPriority={() => {}}
      onResolveAll={() => {}}
      onEndTurn={() => {}}
      onLegalAction={() => {}}
      hoveredCard={null}
      onHover={() => {}}
      zoneViewer={null}
      onOpenZone={() => {}}
      onCloseZone={() => {}}
      dropZoneRef={() => {}}
      onBackToPlay={() => {}}
      bugReport={{ url: 'https://example.test/report', onOpen: () => {} }}
    />,
  )

  expect(html).toContain('Report a bug')
  expect(html).toContain('End Match')
  expect(html).not.toContain('Keep hand')
  expect(html).not.toContain('aria-label="Pass"')
})

test('replay board keeps the saved prompt visible with inert handlers', () => {
  const board = {
    ...attachmentsBoard('attached'),
    prompt: {
      interactionKey: 12,
      kind: 'mulligan' as const,
      result: 'Keep or mulligan',
      message: 'MulliganReq',
    },
  }
  const html = renderToStaticMarkup(
    <Board
      board={board}
      interactive={false}
      inputEnabled={false}
      replay
      embedded={false}
      interactions={READ_ONLY_INTERACTIONS}
      stops={new Set()}
      canRespond={false}
      passing={false}
      onToggleStop={() => {}}
      onPassPriority={() => {}}
      onResolveAll={() => {}}
      onEndTurn={() => {}}
      onLegalAction={() => {}}
      hoveredCard={null}
      onHover={() => {}}
      zoneViewer={null}
      onOpenZone={() => {}}
      onCloseZone={() => {}}
      dropZoneRef={() => {}}
    />,
  )

  expect(html).toContain('data-decision="mulligan"')
  expect(html).toContain('Keep hand')
  expect(html).toContain('Mulligan')
  expect(html).not.toContain('aria-label="Pass"')
})

test('growth and retirement repaint counters and attachment host', () => {
  const grown = render('grown')
  expect(grown).toContain('aria-label="4 +1/+1 counters"')
  expect(grown).toContain('data-pt="8/6"')
  const removed = render('removed')
  expect(removed).not.toContain('data-counter-type')
  expect(removed).not.toContain('data-attachment-host="101"')
  expect(removed).toContain('data-attachment-host="104"')
})

test('counter icon mapping only uses installed Mana glyphs', async () => {
  const css = await Bun.file('node_modules/mana-font/css/mana.css').text()
  for (const name of [
    '+1/+1',
    '-1/-1',
    'Stun',
    'Shield',
    'Charge',
    'Loyalty',
    'Lore',
    'Time',
    'Finality',
  ]) {
    const classes = counterIcon(name)
    expect(classes).not.toBeNull()
    expect(css).toContain(`.${classes!.split(' ')[1]}::before`)
  }
  expect(counterIcon('Counter 9999')).toBeNull()
})

test('card art preference publishes once and remains independent of game state', () => {
  const initial = boardView.snapshot().hideCardArt
  let publishes = 0
  const unsubscribe = boardView.subscribe(() => {
    publishes += 1
  })
  boardView.setHideCardArt(!initial)
  expect(boardView.snapshot().hideCardArt).toBe(!initial)
  expect(publishes).toBe(1)
  boardView.setHideCardArt(!initial)
  expect(publishes).toBe(1)
  unsubscribe()
  boardView.setHideCardArt(initial)
})

test('phased-out cards retain inspection and counters without stale action or selection affordances', () => {
  const { card } = createFixture()
  const visible = card('Kaito Shizuki')
  const ghost = {
    ...visible,
    phasedOut: true,
    playableActivation: true,
    counters: [{ type: 1, name: 'Loyalty', count: 3 }],
  }
  const html = renderToStaticMarkup(
    <Card
      card={ghost}
      actions={[action({})]}
      selectable
      selected
      onClick={() => {}}
      onPointerDown={() => {}}
      onHover={() => {}}
    />,
  )
  expect(html).toStartWith('<article')
  expect(html).toContain('data-phased-out="true"')
  expect(html).toContain(`data-instance-id="${visible.instanceId}"`)
  expect(html).toContain('aria-label="Kaito Shizuki, Phased out"')
  expect(html).toContain('tabindex="0"')
  expect(html).toContain('aria-label="3 Loyalty counters"')
  expect(html).toContain('Phased out</span>')
  expect(html).not.toContain('data-action-types')
  expect(html).not.toContain('data-action-tuples')
  expect(html).not.toContain('aria-pressed')
  expect(html).not.toContain('Activate')
  expect(cardIsPlayable(ghost, [2])).toBe(false)

  const returned = renderToStaticMarkup(
    <Card card={{ ...ghost, phasedOut: false }} actions={[action({})]} onClick={() => {}} />,
  )
  expect(returned).toStartWith('<button')
  expect(returned).not.toContain('data-phased-out')
  expect(returned).toContain('data-action-types="2"')
  expect(returned).toContain('aria-label="3 Loyalty counters"')
  expect(returned).toContain(`data-instance-id="${visible.instanceId}"`)
})
