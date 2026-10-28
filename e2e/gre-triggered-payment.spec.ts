import { writeFileSync } from 'node:fs'
import { test, recordDemos, readyForVideo } from './demo-test'
import { authenticateShell, expect } from './gre-test'
import { startScenario } from './gre-scenario'
import { runGreAcceptanceSteps } from './gre-acceptance'
import { readBrowserJournal } from './gre-browser-observations'
import { asArray, isRecord } from '../src/engine/state/gre-state'
import { decodeMessage, enumValue } from '../src/engine/wire/gre-proto'

for (const accept of [true, false]) {
  test(`Kitt triggered tap payment preserves its source: ${accept ? 'accept' : 'decline'}`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page, 'triggered-payment')
    const release = await (await page.request.get('/browser-engine/release.json')).json()
    await startScenario(page, 'kitt-tap-payment', 'browser', 42)
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    await runGreAcceptanceSteps(page, {
      steps: [{ pass_until: { prompt: 'OptionalActionMessage', max_passes: 8 } }],
    })
    const kitt = page.locator(
      '[data-zone="battlefield"][data-owner="self"] [data-card="Kitt Kanto, Mayhem Diva"]',
    )
    const kittId = Number(await kitt.getAttribute('data-instance-id'))
    const initial = await readBrowserJournal(page)
    const abilityType = await enumValue('GameObjectType', 'Ability')
    const initialObjects = initial!.batches
      .flatMap((batch) => batch.messages)
      .filter(isRecord)
      .flatMap((message) =>
        isRecord(message['gameStateMessage'])
          ? asArray(message['gameStateMessage']['gameObjects'])
          : [],
      )
      .filter(isRecord)
    const trigger = initialObjects
      .filter((object) => object['type'] === abilityType && object['parentId'] === kittId)
      .at(-1)!
    expect(trigger).toBeDefined()
    readyForVideo.add(page)
    await page.screenshot({ path: info.outputPath('optional-trigger.png') })
    writeFileSync(info.outputPath('served-release.json'), JSON.stringify(release))
    try {
      if (recordDemos) {
        await page.waitForTimeout(1200)
      }
      await runGreAcceptanceSteps(page, { steps: [{ optional_action: { accept } }] })
      if (accept) {
        await expect(
          page.locator('[data-prompt]').getByRole('heading', { name: 'Pay costs', exact: true }),
        ).toBeVisible({ timeout: 10_000 })
        const offered = await readBrowserJournal(page)
        const messages = offered!.batches.flatMap((batch) => batch.messages).filter(isRecord)
        const payment = messages.filter((message) => isRecord(message['payCostsReq'])).at(-1)!
        const sourceId = asArray((payment['prompt'] as Record<string, unknown>)['parameters'])
          .filter(isRecord)
          .find((parameter) => parameter['parameterName'] === 'CardId')!['numberValue']
        expect(sourceId).toBe(trigger['instanceId'])
        expect(sourceId).not.toBe(kittId)
        const cost = (payment['payCostsReq'] as Record<string, unknown>)['effectCostReq'] as Record<
          string,
          unknown
        >
        const selection = cost['costSelection'] as Record<string, unknown>
        expect(selection['minSel']).toBe(2)
        expect(selection['maxSel']).toBe(2)
        expect(asArray(selection['ids'])).toHaveLength(4)
        writeFileSync(
          info.outputPath('source-bound-payment.json'),
          JSON.stringify({ trigger, payment }),
        )
        await page.screenshot({ path: info.outputPath('exact-two-payment.png') })
        if (recordDemos) {
          await page.waitForTimeout(1200)
        }
        await runGreAcceptanceSteps(page, {
          steps: [
            { select_cost: { zone: 'battlefield', cards: ['Walking Corpse', 'Coral Merfolk'] } },
          ],
        })
        await expect(
          page.getByRole('region', {
            name: 'Choose a target for Kitt Kanto, Mayhem Diva',
            exact: true,
          }),
        ).toBeVisible()
        const afterPayment = await page.evaluate(() => window.__greState()!)
        expect(afterPayment.activeSeat).toBe(afterPayment.viewerSeat)
        for (const name of ['Walking Corpse', 'Coral Merfolk']) {
          await expect(
            page.locator(`[data-zone="battlefield"][data-owner="self"] [data-card="${name}"]`),
          ).toHaveAttribute('data-tapped', 'true')
        }
        await expect(kitt).not.toHaveAttribute('data-tapped', 'true')
        await expect(
          page.locator('[data-zone="battlefield"][data-owner="self"] [data-card="Grizzly Bears"]'),
        ).not.toHaveAttribute('data-tapped', 'true')
        await page.screenshot({ path: info.outputPath('paid-before-target.png') })
        await runGreAcceptanceSteps(page, {
          steps: [
            { target: { side: 'ours', zone: 'battlefield', card: 'Grizzly Bears' } },
            { resolve_stack: {} },
            {
              expect: {
                battlefield_stats: { side: 'ours', card: 'Grizzly Bears', power: 4, toughness: 4 },
              },
            },
          ],
        })
        await page.screenshot({ path: info.outputPath('boost-resolved.png') })
        const settled = await page.evaluate(() => window.__greState()!)
        expect(settled.diagnostics.errorCount).toBe(0)
        const journal = await readBrowserJournal(page)
        expect(journal!.context?.engineBuild).toBe(release.releaseId)
        const decoded: Record<string, unknown>[] = []
        const greType = await enumValue('ClientToMatchServiceMessageType', 'ClientToGremessage')
        for (const response of journal!.responses ?? []) {
          if (!isRecord(response) || typeof response['payload'] !== 'string') {
            continue
          }
          const wrapper = await decodeMessage(
            'ClientToMatchServiceMessage',
            Buffer.from(response['payload'], 'base64'),
          )
          if (wrapper['clientToMatchServiceMessageType'] === greType) {
            decoded.push(
              await decodeMessage('ClientToGREMessage', wrapper['payload'] as Uint8Array),
            )
          }
        }
        const paid = decoded.find((response) => isRecord(response['effectCostResp']))!
        expect(paid).toMatchObject({
          gameStateId: payment['gameStateId'],
          respId: payment['msgId'],
        })
        const paidSelection = (paid['effectCostResp'] as Record<string, unknown>)[
          'costSelection'
        ] as Record<string, unknown>
        expect(asArray(paidSelection['ids'])).toEqual(
          afterPayment.board.you
            .filter((card) => ['Walking Corpse', 'Coral Merfolk'].includes(card.name))
            .map((card) => card.iid),
        )
        writeFileSync(info.outputPath('decoded-responses.json'), JSON.stringify(decoded))
      } else {
        await runGreAcceptanceSteps(page, {
          steps: [{ pass_until: { prompt: 'DeclareAttackersReq', max_passes: 8 } }],
        })
        const state = await page.evaluate(() => window.__greState()!)
        expect(state.board.you.every((card) => !card.tapped)).toBe(true)
        expect(state.board.you.find((card) => card.name === 'Grizzly Bears')!.pt).toBe('2/2')
        expect(state.diagnostics.errorCount).toBe(0)
        const journal = await readBrowserJournal(page)
        expect(
          journal!.batches
            .flatMap((batch) => batch.messages)
            .filter(isRecord)
            .some((message) => isRecord(message['payCostsReq'])),
        ).toBe(false)
      }
    } finally {
      writeFileSync(
        info.outputPath('kitt-journal.json'),
        JSON.stringify(await readBrowserJournal(page)),
      )
      writeFileSync(
        info.outputPath('kitt-state.json'),
        JSON.stringify(await page.evaluate(() => window.__greState())),
      )
      await page.screenshot({ path: info.outputPath('continued-play.png') })
      if (recordDemos) {
        await page.waitForTimeout(1200)
      }
    }
  })
}
