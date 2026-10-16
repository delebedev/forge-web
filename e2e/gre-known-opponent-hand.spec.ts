import { expect, authenticateShell } from './gre-test'
import { test, recordDemos, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { castSpell } from './gre-actions'
import { runGreAcceptanceSteps } from './gre-acceptance'

for (const execution of ['server', 'browser'] as const) {
  test(`known opponent hand is inspectable and withdraws with its permission (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000)
    let releaseImages!: () => void
    const imagesReady = new Promise<void>((resolve) => {
      releaseImages = resolve
    })
    let delayedImages = 0
    let completedImages = 0
    await page.route('https://cards.scryfall.io/**', async (route) => {
      delayedImages++
      await imagesReady
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=',
          'base64',
        ),
      })
      completedImages++
    })
    try {
      await page.addInitScript(() =>
        localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
      )
      await authenticateShell(page, 'known-hand-proof')
      await startScenario(page, 'known-opponent-hand', execution)
      await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
      const hand = page.getByRole('region', { name: 'Opponent hand: 2 cards', exact: true })
      const bears = hand.getByRole('button', {
        name: "Inspect Grizzly Bears in opponent's hand",
        exact: true,
      })
      await expect(bears).toBeVisible()
      await expect(
        hand.getByRole('button', {
          name: "Inspect Lightning Bolt in opponent's hand",
          exact: true,
        }),
      ).toBeVisible()
      await expect(hand).toHaveAttribute('data-zone-count', '2')
      await bears.hover()
      await expect(
        page.getByRole('complementary', { name: 'Grizzly Bears inspection', exact: true }),
      ).toBeVisible()
      readyForVideo.add(page)
      await page.screenshot({ path: info.outputPath('known-hand.png') })
      if (recordDemos) {
        await page.waitForTimeout(800)
      }
      await bears.click()
      const inspection = page.getByRole('dialog', { name: 'Known opponent hand — 2', exact: true })
      await expect(inspection).toBeVisible()
      await expect(inspection.locator('[data-card="Grizzly Bears"]')).toBeVisible()
      await expect(inspection.locator('[data-card="Lightning Bolt"]')).toBeVisible()
      await page.screenshot({ path: info.outputPath('known-hand-inspection.png') })
      await expect.poll(() => delayedImages).toBeGreaterThan(0)
      await castSpell(page, {
        card: 'Naturalize',
        target: { side: 'ours', zone: 'battlefield', card: 'Telepathy' },
        until: {
          zone_contains: { side: 'ours', zone: 'graveyard', card: 'Telepathy' },
          stack_empty: true,
        },
      })
      await expect(inspection).toHaveCount(0)
      await expect(hand.locator('[data-card]')).toHaveCount(0)
      await expect(hand).toHaveAttribute('data-zone-count', '2')
      await expect(
        page.getByRole('complementary', { name: 'Grizzly Bears inspection', exact: true }),
      ).toHaveCount(0)
      releaseImages()
      await expect.poll(() => completedImages).toBeGreaterThan(0)
      await expect
        .poll(() =>
          page
            .locator('[data-card] img')
            .evaluateAll((images) =>
              images.every((image) => getComputedStyle(image).visibility === 'hidden'),
            ),
        )
        .toBe(true)
      await expect(hand.locator('[data-card]')).toHaveCount(0)
      await expect(inspection).toHaveCount(0)
      await runGreAcceptanceSteps(page, {
        steps: [
          { play_land: 'Plains' },
          { expect: { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Plains' } } },
        ],
      })
      await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled()
      await page.getByRole('status', { name: 'Match status', exact: true }).hover()
      await page.screenshot({ path: info.outputPath('concealed-and-continued.png') })
      if (recordDemos) {
        await page.waitForTimeout(800)
      }
      await startScenario(page, 'modal-cancel', execution)
      await expect(page.getByRole('region', { name: /^Opponent hand:/ })).toHaveCount(0)
      await expect(
        page.getByRole('complementary', { name: 'Grizzly Bears inspection', exact: true }),
      ).toHaveCount(0)
    } finally {
      releaseImages()
    }
  })
}

test('replay known hand remains usable at eight cards and retires inspection on withdrawal and seek', async ({
  page,
}, info) => {
  const ids = Array.from({ length: 10 }, (_, index) => 100 + index)
  const known = ids.slice(0, 8).map((instanceId, index) => ({
    instanceId,
    grpId: 900 + index,
    type: 1,
    zoneId: 32,
    ownerSeatId: 2,
    controllerSeatId: 2,
    visibility: 2,
    viewers: [1, 2],
  }))
  const message = (gameStateId: number, gameObjects: unknown[]) => ({
    type: 'GREMessageType_GameStateMessage',
    systemSeatIds: [1],
    gameStateId,
    gameStateMessage: {
      type: gameStateId === 1 ? 1 : 2,
      gameStateId,
      players: [
        { systemSeatNumber: 1, lifeTotal: 20 },
        { systemSeatNumber: 2, lifeTotal: 20 },
      ],
      turnInfo: { turnNumber: 1, phase: 2, activePlayer: 1, priorityPlayer: 1 },
      zones: [
        {
          zoneId: 32,
          type: 2,
          ownerSeatId: 2,
          visibility: 2,
          viewers: [2],
          objectInstanceIds: ids,
        },
      ],
      gameObjects,
    },
  })
  const bundle = {
    version: 1,
    label: 'Known hand inspection',
    source: 'Authored scenario',
    viewerSeatId: 1,
    cards: Object.fromEntries(
      known.map((card, index) => [
        card.grpId,
        {
          name: `Known card ${index + 1}`,
          types: 'Creature',
          power: '2',
          toughness: '2',
          imageUrl: '',
        },
      ]),
    ),
    batches: [
      { messages: [message(1, [])] },
      { messages: [message(2, known)] },
      {
        messages: [
          message(
            3,
            known.map((card) => ({
              instanceId: card.instanceId,
              type: 1,
              zoneId: 32,
              ownerSeatId: 2,
              controllerSeatId: 2,
              visibility: 3,
              grpId: 0,
              viewers: [],
            })),
          ),
        ],
      },
      {
        messages: [
          {
            ...message(4, [
              ...known.slice(0, 7),
              {
                ...known[7],
                zoneId: 27,
                visibility: 1,
                power: { value: 4 },
                toughness: { value: 5 },
              },
            ]),
            gameStateMessage: {
              ...message(4, []).gameStateMessage,
              zones: [
                {
                  zoneId: 32,
                  type: 2,
                  ownerSeatId: 2,
                  visibility: 2,
                  viewers: [2],
                  objectInstanceIds: ids.filter((id) => id !== 107),
                },
                { zoneId: 27, type: 3, ownerSeatId: 2, visibility: 1, objectInstanceIds: [107] },
              ],
              gameObjects: [
                ...known.slice(0, 7),
                {
                  ...known[7],
                  zoneId: 27,
                  visibility: 1,
                  power: { value: 4 },
                  toughness: { value: 5 },
                },
              ],
            },
          },
        ],
      },
    ],
  }
  bundle.batches.push(bundle.batches[3]!)
  await page.route(
    (url) => url.pathname === '/known-hand-proof.greplay.json',
    (route) => route.fulfill({ json: bundle }),
  )
  await page.addInitScript(() =>
    localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
  )
  await page.goto('/play/replay?src=/known-hand-proof.greplay.json')
  await page.getByRole('button', { name: 'Start replay', exact: true }).click()
  const scrub = page.getByRole('slider', { name: 'Scrub', exact: true })
  await scrub.press('Home')
  await scrub.press('ArrowRight')
  await scrub.press('ArrowRight')
  await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
  const hand = page.getByRole('region', { name: 'Opponent hand: 10 cards', exact: true })
  await expect(hand.getByRole('button')).toHaveCount(8)
  await expect(hand).toContainText('8 known · 2 concealed')
  const shelf = await hand.boundingBox()
  expect(shelf).not.toBeNull()
  expect(shelf!.x).toBeGreaterThanOrEqual(260)
  expect(shelf!.x + shelf!.width).toBeLessThanOrEqual(1020)
  const last = hand.getByRole('button', {
    name: "Inspect Known card 8 in opponent's hand",
    exact: true,
  })
  await last.scrollIntoViewIfNeeded()
  const lastBounds = await last.boundingBox()
  expect(lastBounds).not.toBeNull()
  expect(lastBounds!.x).toBeGreaterThanOrEqual(shelf!.x)
  expect(lastBounds!.x + lastBounds!.width).toBeLessThanOrEqual(shelf!.x + shelf!.width)
  const concealedSlot = hand.locator('[class*="back"]').last()
  await expect(concealedSlot).toHaveCSS('pointer-events', 'none')
  const slotBounds = await concealedSlot.boundingBox()
  expect(slotBounds).not.toBeNull()
  expect(
    await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className.includes('back'), {
      x: slotBounds!.x + slotBounds!.width / 2,
      y: slotBounds!.y + slotBounds!.height / 2,
    }),
  ).toBe(false)
  await last.hover()
  await expect(
    page.getByRole('complementary', { name: 'Known card 8 inspection', exact: true }),
  ).toBeVisible()
  readyForVideo.add(page)
  await page.screenshot({ path: info.outputPath('large-known-hand.png') })
  if (recordDemos) {
    await page.waitForTimeout(800)
  }
  await last.click()
  const dialog = page.getByRole('dialog', { name: 'Known opponent hand — 8', exact: true })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Step forward', exact: true }).press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(hand.locator('[data-card]')).toHaveCount(0)
  await expect(
    page.getByRole('complementary', { name: 'Known card 8 inspection', exact: true }),
  ).toHaveCount(0)
  await expect(hand).toHaveAttribute('data-zone-count', '10')
  await page.screenshot({ path: info.outputPath('replay-withdrawn-hand.png') })
  if (recordDemos) {
    await page.waitForTimeout(800)
  }
  await scrub.press('ArrowLeft')
  await expect(last).toBeVisible()
  await last.hover()
  await expect(
    page.getByRole('complementary', { name: 'Known card 8 inspection', exact: true }),
  ).toBeVisible()
  await expect(scrub).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(
    page.getByRole('complementary', { name: 'Known card 8 inspection', exact: true }),
  ).toHaveCount(0)
  await scrub.press('ArrowLeft')
  await last.click()
  await expect(dialog).toBeVisible()
  await scrub.press('Home')
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('complementary', { name: 'Known card 8 inspection', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByRole('region', { name: /^Opponent hand:/ })).toHaveCount(0)
  await scrub.press('ArrowRight')
  await scrub.press('ArrowRight')
  await last.hover()
  await expect(
    page.getByRole('complementary', { name: 'Known card 8 inspection', exact: true }),
  ).toBeVisible()
  await expect(scrub).toBeFocused()
  await page.keyboard.press('Home')
  await expect(
    page.getByRole('complementary', { name: 'Known card 8 inspection', exact: true }),
  ).toHaveCount(0)
  await scrub.press('ArrowRight')
  await scrub.press('ArrowRight')
  // Keep the real pointer away from the shelf so its reflow cannot introduce a new hover.
  await page.mouse.move(0, 0)
  await last.dispatchEvent('mouseover')
  const publicInspection = page.getByRole('complementary', {
    name: 'Known card 8 inspection',
    exact: true,
  })
  await expect(publicInspection).toBeVisible()
  await expect(scrub).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.locator('[data-zone="battlefield"] [data-instance-id="107"]')).toBeVisible()
  await expect(publicInspection).toContainText('4/5')
  await page.keyboard.press('ArrowLeft')
  await expect(publicInspection).toContainText('4/5')
  await page.keyboard.press('ArrowRight')
  await expect(publicInspection).toContainText('4/5')
  await page.screenshot({ path: info.outputPath('replay-public-transfer.png') })
  if (recordDemos) {
    await page.waitForTimeout(800)
  }
})
