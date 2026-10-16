import { expect, test } from 'bun:test'
import {
  GAME_OBJECT_TYPE_ABILITY,
  GAME_OBJECT_TYPE_TRIGGER_HOLDER,
  type CardView,
} from '@engine/state/gre-state'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyGsm, EMPTY_GAME_STATE } from '@engine/state/gre-accumulator'
import { buildBoardProjection } from '@engine/state/gre-projection'
import { ZONE_STACK } from '@engine/state/gre-state'
import type { GreFrameSink, GreFrameSource } from '@engine/runtime/gre-frame-source'
import { diffGameState, fullGameState } from '@engine/runtime/gre-test-frames'
import { isRenderableStackCard, StackPanel } from './StackPanel'

/** A stack entry with no card details resolved — how every entry starts. */
function entry(over: Partial<CardView> = {}): CardView {
  return {
    instanceId: 1,
    grpId: 94894,
    name: 'grpId 94894',
    typeLine: '',
    manaCost: '',
    powerToughness: '',
    imageUrl: '',
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    controllerSeatId: 1,
    ...over,
  }
}

test('a card is drawn before its details arrive', () => {
  // The regression this replaces: excluding anything still labelled by grpId
  // also hid real spells whose lookup had not landed, so the pile read as empty
  // for the length of the fetch — and forever where no lookup was reachable.
  expect(isRenderableStackCard(entry({ objectType: 1 }))).toBe(true)
})

test('a token on the stack is drawn', () => {
  expect(isRenderableStackCard(entry({ objectType: 2 }))).toBe(true)
})

test('an ability is not drawn as a card', () => {
  // It is a real stack entry with no card of its own, and these pile up in a
  // long game watched from the outside.
  expect(isRenderableStackCard(entry({ objectType: GAME_OBJECT_TYPE_ABILITY }))).toBe(false)
  expect(isRenderableStackCard(entry({ objectType: GAME_OBJECT_TYPE_TRIGGER_HOLDER }))).toBe(false)
})

test('with no kind reported, having details is what decides', () => {
  expect(isRenderableStackCard(entry())).toBe(false)
  expect(isRenderableStackCard(entry({ typeLine: 'Creature — Goblin' }))).toBe(true)
  expect(isRenderableStackCard(entry({ name: 'Shock', manaCost: '{R}' }))).toBe(true)
})

test('the queue retains every spell and ability in resolution order', () => {
  const cards = Array.from({ length: 6 }, (_, index) =>
    entry({ instanceId: 6 - index, objectType: 1, name: `Spell ${6 - index}` }),
  )
  cards.unshift(
    entry({ instanceId: 7, objectType: GAME_OBJECT_TYPE_ABILITY, name: 'Activated ability' }),
  )
  cards.push(entry({ instanceId: 8, objectType: GAME_OBJECT_TYPE_TRIGGER_HOLDER, name: 'Holder' }))
  const html = renderToStaticMarkup(createElement(StackPanel, { cards, viewerSeatId: 1 }))
  expect(html).toContain('data-count="7"')
  expect(html).toContain('Activated ability')
  expect(html).not.toContain('Holder')
  expect(html.indexOf('Activated ability')).toBeLessThan(html.indexOf('Spell 6'))
  expect(html.indexOf('Spell 6')).toBeLessThan(html.indexOf('Spell 1'))
  expect(cards[0]?.name).toBe('Activated ability')
})

for (const order of [
  [10, 20],
  [20, 10],
]) {
  test(`store projection and panel preserve Stack order ${order.join(',')}`, async () => {
    const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
    try {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: new URL('http://localhost'),
      })
      const { GreStore } = await import('@engine/runtime/gre-store')
      const store = new GreStore()
      let sink: GreFrameSink | undefined
      const source: GreFrameSource = {
        canSend: false,
        isOpen: true,
        start(value) {
          sink = value
        },
        stop() {},
        send() {},
      }
      store.attachSource(source)
      store.seedCardMeta(
        new Map([
          [9001, { grpId: 9001, name: 'Stack spell' }],
          [9002, { grpId: 9002, name: 'Stack ability' }],
        ]),
      )
      const stackZone = { zoneId: 27, type: ZONE_STACK, ownerSeatId: 0 }
      sink!.onBatch({
        byteLength: 0,
        messages: [
          fullGameState(1, {
            zones: [{ ...stackZone, objectInstanceIds: order }],
            gameObjects: [
              {
                instanceId: 20,
                grpId: 9001,
                type: 1,
                zoneId: 27,
                ownerSeatId: 1,
                controllerSeatId: 1,
              },
              {
                instanceId: 10,
                grpId: 9002,
                type: GAME_OBJECT_TYPE_ABILITY,
                zoneId: 27,
                parentId: 20,
                ownerSeatId: 1,
                controllerSeatId: 1,
              },
            ],
          }),
        ],
      })
      const html = renderToStaticMarkup(
        createElement(StackPanel, { cards: store.stack, viewerSeatId: 1 }),
      )
      expect(store.stack.map((card) => card.instanceId)).toEqual(order)
      expect(html.match(/data-instance-id="(\d+)"/)?.[1]).toBe(String(order[0]))
      expect(html).toContain('Resolves next')
      sink!.onBatch({
        byteLength: 0,
        messages: [
          diffGameState(2, {
            zones: [{ ...stackZone, objectInstanceIds: [order[1]!] }],
            diffDeletedInstanceIds: [order[0]!],
          }),
        ],
      })
      const after = renderToStaticMarkup(
        createElement(StackPanel, { cards: store.stack, viewerSeatId: 1 }),
      )
      expect(store.stack.map((card) => card.instanceId)).toEqual([order[1]])
      expect(after.match(/data-instance-id="(\d+)"/)?.[1]).toBe(String(order[1]))
      store.disconnect()
    } finally {
      if (previousLocation) {
        Object.defineProperty(globalThis, 'location', previousLocation)
      } else {
        Reflect.deleteProperty(globalThis, 'location')
      }
    }
  })
}

test('an unlisted activated ability resolves before a listed spell in the panel', () => {
  const initial = applyGsm(EMPTY_GAME_STATE, {
    gameStateId: 1,
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [301] }],
    gameObjects: [
      { instanceId: 301, grpId: 900002, type: 1, zoneId: 40, ownerSeatId: 1, controllerSeatId: 1 },
    ],
  })
  const activated = applyGsm(initial, {
    gameStateId: 2,
    gameObjects: [
      {
        instanceId: 100,
        grpId: 200005472,
        type: 1,
        ownerSeatId: 1,
        controllerSeatId: 1,
        isTapped: true,
      },
      {
        instanceId: 302,
        grpId: 900001,
        type: GAME_OBJECT_TYPE_ABILITY,
        zoneId: 40,
        parentId: 100,
        ownerSeatId: 1,
        controllerSeatId: 1,
      },
    ],
  })
  const cards = buildBoardProjection(
    activated,
    new Map([
      [
        200005472,
        {
          grpId: 200005472,
          name: 'Concealing Curtains',
          imageUrl: 'https://cards.scryfall.io/normal/front/curtains.jpg',
        },
      ],
    ]),
    false,
  ).stack
  const html = renderToStaticMarkup(createElement(StackPanel, { cards, viewerSeatId: 1 }))
  expect(cards.map((card) => card.instanceId)).toEqual([302, 301])
  expect(html.match(/data-instance-id="(\d+)"/)?.[1]).toBe('302')
  expect(html).toContain('data-zone="stack"')
  expect(html).toContain('data-instance-id="302"')
  expect(html).toContain('data-instance-id="100"')
  expect(html).toContain('src="https://cards.scryfall.io/art_crop/front/curtains.jpg"')
  expect(html).not.toContain('src="https://cards.scryfall.io/normal/front/curtains.jpg"')
  expect(html).toContain('Concealing Curtains')
  expect(html).toContain('Ability')
  const resynced = applyGsm(activated, {
    type: 1,
    gameStateId: 3,
    zones: [{ zoneId: 40, type: ZONE_STACK, ownerSeatId: 0, objectInstanceIds: [301] }],
    gameObjects: [
      { instanceId: 301, grpId: 900002, type: 1, zoneId: 40, ownerSeatId: 1, controllerSeatId: 1 },
      {
        instanceId: 302,
        grpId: 900001,
        type: GAME_OBJECT_TYPE_ABILITY,
        zoneId: 40,
        parentId: 100,
        ownerSeatId: 1,
        controllerSeatId: 1,
      },
    ],
  })
  expect(resynced.tables.objects.has(302)).toBe(true)
  expect(
    buildBoardProjection(resynced, new Map(), false).stack.map((card) => card.instanceId),
  ).toEqual([301])
  expect(resynced.tables.stackAbilityOrder).toEqual([])
})
