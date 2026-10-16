import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ACTION_CAST_ADVENTURE,
  ACTION_CAST,
  ZONE_COMMAND,
  ZONE_EXILE,
  ZONE_GRAVEYARD,
  ZONE_LIBRARY,
  ZONE_SIDEBOARD,
  type CardView,
  type LegalAction,
} from '@engine/state/gre-state'
import { NonHandActionRail, nonHandActionEntries } from './NonHandActionRail'

function card(instanceId: number, name: string): CardView {
  return {
    instanceId,
    grpId: instanceId,
    name,
    typeLine: 'Instant',
    manaCost: '',
    powerToughness: '',
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    imageUrl: '',
    controllerSeatId: 1,
  }
}

function action(
  instanceId: number,
  zoneType: number,
  actionType = ACTION_CAST,
  alternativeGrpId = 0,
): LegalAction {
  return {
    actionType,
    instanceId,
    grpId: instanceId,
    facetId: 0,
    abilityGrpId: 0,
    uniqueAbilityId: 0,
    sourceId: 0,
    alternativeGrpId,
    alternativeSourceZcid: 0,
    zoneType,
    hasAlternativeCost: alternativeGrpId > 0,
    label: `${actionType}:${instanceId}:${alternativeGrpId}`,
    cardName: String(instanceId),
    shouldStop: false,
  }
}

test('non-hand rail keeps only exact legal graveyard, exile, and command actions', () => {
  const flashback = card(1, 'Flashback spell')
  const inert = card(2, 'Inert graveyard card')
  const exiled = card(3, 'Exiled card')
  const exiledBack = { ...exiled, grpId: 30, name: 'Exiled back face' }
  const unknown = card(4, 'Unknown-action card')
  const commander = card(5, 'Commander')
  const normal = action(1, ZONE_GRAVEYARD)
  const alternate = action(1, ZONE_GRAVEYARD, ACTION_CAST, 88)
  const adventure = action(3, ZONE_EXILE, ACTION_CAST_ADVENTURE)
  const backAdventure = { ...action(3, ZONE_EXILE, ACTION_CAST_ADVENTURE), grpId: 30, facetId: 2 }
  const unknownAction = action(4, ZONE_GRAVEYARD, 99)
  const commanderAction = { ...action(5, ZONE_COMMAND), label: 'Cast Commander from command zone' }

  const entries = nonHandActionEntries({
    nonHandActionCards: [
      { card: flashback, action: normal },
      { card: flashback, action: alternate },
      { card: exiled, action: adventure },
      { card: exiledBack, action: backAdventure },
      { card: unknown, action: unknownAction },
      { card: commander, action: commanderAction },
      { card: inert, action: action(2, ZONE_SIDEBOARD) },
    ],
  })

  expect(entries.map((entry) => [entry.card.name, entry.zone])).toEqual([
    ['Flashback spell', 'Graveyard'],
    ['Exiled card', 'Exile'],
    ['Exiled back face', 'Exile'],
    ['Unknown-action card', 'Graveyard'],
    ['Commander', 'Command zone'],
  ])
  expect(entries[0]?.actions).toEqual([normal, alternate])
  expect(entries[1]?.actions).toEqual([adventure])
  expect(entries[2]?.actions).toEqual([backAdventure])
  expect(entries[3]?.actions).toEqual([unknownAction])
  expect(entries[4]?.actions).toEqual([commanderAction])
})

test('non-hand cards expose their exact legal ability identity', () => {
  const champion = {
    ...card(1, 'Champion of Dusan'),
    imageUrl: 'https://cards.scryfall.io/normal/front/champion.jpg',
  }
  const renew = { ...action(1, ZONE_GRAVEYARD, 2, 44), abilityGrpId: 188841 }
  const html = renderToStaticMarkup(
    createElement(NonHandActionRail, {
      entries: [{ card: champion, zone: 'Graveyard', zoneType: ZONE_GRAVEYARD, actions: [renew] }],
      disabled: false,
      onAction: () => {},
      onHover: () => {},
    }),
  )

  expect(html).toContain('data-action-types="2"')
  expect(html).toContain('2:ability:188841')
  expect(html).toContain('2:1:188841')
  expect(html).toContain('src="https://cards.scryfall.io/art_crop/front/champion.jpg"')
  expect(html).not.toContain('src="https://cards.scryfall.io/normal/front/champion.jpg"')
})

test('command-zone rail renders its source label and current taxed cost', () => {
  const commander = card(5, 'Commander')
  const cast = {
    ...action(5, ZONE_COMMAND),
    label: 'Cast Commander from command zone',
    manaCost: '{2}{W}',
  }
  const html = renderToStaticMarkup(
    createElement(NonHandActionRail, {
      entries: [{ card: commander, zone: 'Command zone', zoneType: ZONE_COMMAND, actions: [cast] }],
      disabled: false,
      onAction: () => {},
      onHover: () => {},
    }),
  )

  expect(html).toContain('CMD')
  expect(html).toContain('data-source-zone="7"')
  expect(html).toContain('Cast Commander from command zone · Cost {2}{W}')
})

test('persistent command cards merge exact actions by instance id and stay disabled without one', () => {
  const commander = card(5, 'Commander')
  const unavailable = card(6, 'Unavailable commander')
  const cast = { ...action(5, ZONE_COMMAND), label: 'Cast Commander from command zone' }
  const entries = nonHandActionEntries({
    commandZone: [commander, unavailable],
    nonHandActionCards: [{ card: { ...commander, name: 'Action copy' }, action: cast }],
  })

  expect(
    entries.map((entry) => [
      entry.card.name,
      entry.actions.map((candidate) => candidate.instanceId),
    ]),
  ).toEqual([
    ['Commander', [5]],
    ['Unavailable commander', []],
  ])

  const html = renderToStaticMarkup(
    createElement(NonHandActionRail, {
      entries,
      disabled: false,
      onAction: () => {},
      onHover: () => {},
    }),
  )
  expect(html).toContain('data-card="Unavailable commander"')
  expect(html).toContain('aria-disabled="true"')
  expect(html).toContain('Unavailable commander unavailable')
  expect(html).toContain('Cast Commander from command zone')
})

test('library actions use the existing rail with exact source and casting identity', () => {
  const top = card(7, 'Grizzly Bears')
  const cast = { ...action(7, ZONE_LIBRARY), label: 'Cast Grizzly Bears from library' }
  const entries = nonHandActionEntries({ nonHandActionCards: [{ card: top, action: cast }] })
  expect(entries).toEqual([
    { card: top, zone: 'Library top', zoneType: ZONE_LIBRARY, actions: [cast] },
  ])
  const html = renderToStaticMarkup(
    createElement(NonHandActionRail, {
      entries,
      disabled: false,
      onAction: () => {},
      onHover: () => {},
    }),
  )
  expect(html).toContain('TOP')
  expect(html).toContain('data-source-zone="1"')
  expect(html).toContain('Cast Grizzly Bears from library')
})
