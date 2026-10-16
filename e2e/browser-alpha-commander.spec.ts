import { castSpell, resolveTo } from './gre-actions'
import { writeFile } from 'node:fs/promises'
import { authenticateShell, expect, test } from './gre-test'
import { startScenario } from './gre-scenario'
import { runGreAcceptanceSteps } from './gre-acceptance'

test('Commander casts, returns, and recasts with tax in the actual browser runtime', async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  page.setDefaultTimeout(20_000)
  await authenticateShell(page)
  const starts: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/gre/start') {
      starts.push(request.url())
    }
  })
  await startScenario(page, 'commander-tax', 'browser')
  expect(await page.evaluate(() => window.__greState()!.matchId)).toMatch(/^browser-/)
  await runGreAcceptanceSteps(page, { steps: [] }, { fullControl: true })
  const commander = page
    .getByRole('region', { name: 'Cards outside your hand' })
    .getByRole('button', { name: /^Cast Hope of Ghirapur from command zone/ })
  await expect(commander).toHaveAttribute('aria-label', /Cost \{1\}/)
  await resolveTo(
    page,
    { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Hope of Ghirapur' } },
    () => commander.click(),
  )

  const first = await page.evaluate(() => window.__greState()!)
  const firstIdentity = first.board.you.find((card) => card.name === 'Hope of Ghirapur')!.iid
  await castSpell(page, {
    card: 'Shock',
    target: { side: 'ours', zone: 'battlefield', card: 'Hope of Ghirapur' },
    until: { prompt: 'OptionalActionMessage' },
  })
  await runGreAcceptanceSteps(page, { steps: [{ optional_action: { accept: true } }] })
  await expect(commander).toBeEnabled()
  await expect(commander).toHaveAttribute('aria-label', /Cost \{3\}/)
  const before = await page.evaluate(() => window.__greState()!)
  await resolveTo(
    page,
    { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Hope of Ghirapur' } },
    () => commander.click(),
  )

  const after = await page.evaluate(() => window.__greState()!)
  expect(after.board.you.find((card) => card.name === 'Hope of Ghirapur')!.iid).not.toBe(
    firstIdentity,
  )
  expect(
    after.board.you.filter((card) => card.tapped).length -
      before.board.you.filter((card) => card.tapped).length,
  ).toBe(3)
  expect(after.diagnostics.errorCount).toBe(0)
  expect(starts).toEqual([])
  const path = info.outputPath('commander-tax.json')
  await writeFile(path, JSON.stringify({ first, before, after }, null, 2))
  await info.attach('commander-tax', { path, contentType: 'application/json' })
  await page.getByRole('button', { name: /Leave Match/, exact: true }).click()
})
