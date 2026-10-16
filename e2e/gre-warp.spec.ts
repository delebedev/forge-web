import { authenticateShell, expect } from './gre-test'
import { test, readyForVideo } from './demo-test'
import { startScenario } from './gre-scenario'
import { runGreAcceptanceSteps } from './gre-acceptance'

for (const execution of ['server', 'browser'] as const) {
  test(`Quantum Riddler Warp draws, returns from exile and continues (${execution})`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    await authenticateShell(page, 'warp-proof')
    await startScenario(page, 'warp-quantum-riddler', execution)
    await page.getByRole('button', { name: 'Board options', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    const hand = page.locator('[data-zone="hand"][data-owner="self"] [data-card]')
    const before = await hand.count()
    await runGreAcceptanceSteps(page, {
      steps: [
        { cast: { card: 'Quantum Riddler', alt_cost: 'warp' } },
        { resolve_stack: {} },
        {
          expect: {
            all: [
              { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Quantum Riddler' } },
              { stack_empty: true },
            ],
          },
        },
      ],
    })
    // With one card remaining, Riddler replaces its entry draw with two cards.
    await expect(hand).toHaveCount(before + 1)
    await page.screenshot({ path: info.outputPath('warped-and-drawn.png') })
    await runGreAcceptanceSteps(page, {
      steps: [
        { pass_until: { action: { type: 'cast', card: 'Quantum Riddler' }, max_passes: 20 } },
        { expect: { zone_contains: { side: 'ours', zone: 'exile', card: 'Quantum Riddler' } } },
      ],
    })
    await page.screenshot({ path: info.outputPath('exiled-and-castable.png') })
    const beforeReturn = await hand.count()
    await runGreAcceptanceSteps(page, {
      steps: [
        { cast: { card: 'Quantum Riddler', zone: 'exile' } },
        { resolve_stack: {} },
        {
          expect: {
            all: [
              { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Quantum Riddler' } },
              { stack_empty: true },
            ],
          },
        },
      ],
    })
    await expect(hand).toHaveCount(beforeReturn + 1)
    await runGreAcceptanceSteps(page, {
      steps: [
        { cast: { card: 'Ornithopter' } },
        { resolve_stack: {} },
        {
          expect: {
            all: [
              { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Ornithopter' } },
              { stack_empty: true },
            ],
          },
        },
      ],
    })
    expect((await page.evaluate(() => window.__greState()!)).diagnostics.errorCount).toBe(0)
    await page.mouse.move(20, 200)
    await page.screenshot({ path: info.outputPath('returned-drawn-and-continued.png') })
  })
}
