import { writeFileSync } from 'node:fs'
import { test, readyForVideo } from './demo-test'
import { runGreAcceptanceSteps } from './gre-acceptance'
import { readBrowserJournal } from './gre-browser-observations'
import { startScenario } from './gre-scenario'
import { authenticateShell, expect } from './gre-test'
import { asArray, isRecord } from '../src/engine/state/gre-state'
import { decodeMessage, enumValue } from '../src/engine/wire/gre-proto'

for (const choice of ['no-mana-free', 'mana-free', 'mana-paid'] as const) {
  const paidMana = choice !== 'no-mana-free'
  const choosePaid = choice === 'mana-paid'
  test(`Gavi cycling preserves the chosen activation: ${choice}`, async ({ page }, info) => {
    test.setTimeout(300_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page, 'gavi-cycling')
    const response = await page.request.get('/browser-engine/release.json')
    expect(response.ok()).toBe(true)
    const release = await response.json()
    await startScenario(page, paidMana ? 'gavi-paid-cycle' : 'gavi-first-cycle', 'browser', 42)
    readyForVideo.add(page)
    const before = await page.evaluate(() => window.__greState()!)
    const iid = before.hand.find((card) => card.name === 'Miscalculation')!.iid
    const journalBefore = await readBrowserJournal(page)
    expect(journalBefore).not.toBeNull()
    const request = journalBefore!.batches
      .flatMap((batch) => batch.messages)
      .filter(isRecord)
      .filter((message) => isRecord(message['actionsAvailableReq']))
      .at(-1)!['actionsAvailableReq']
    const offers = asArray((request as Record<string, unknown>)['actions'])
      .filter(isRecord)
      .filter((action) => action['actionType'] === 2 && action['instanceId'] === iid)
    expect(offers).toHaveLength(paidMana ? 2 : 1)
    expect(offers.filter((action) => asArray(action['manaCost']).length === 0)).toHaveLength(1)
    expect(new Set(offers.map((action) => action['uniqueAbilityId'])).size).toBe(offers.length)
    const source = journalBefore!.batches
      .flatMap((batch) => batch.messages)
      .filter(isRecord)
      .flatMap((message) =>
        isRecord(message['gameStateMessage'])
          ? asArray(message['gameStateMessage']['gameObjects'])
          : [],
      )
      .filter(isRecord)
      .find((object) => object['instanceId'] === iid)!
    for (const offer of offers) {
      expect(asArray(source['uniqueAbilities'])).toContainEqual({
        id: offer['uniqueAbilityId'],
        grpId: offer['abilityGrpId'],
      })
    }
    const chosen = offers[paidMana && !choosePaid ? 1 : 0]!
    await page.screenshot({ path: info.outputPath('first-cycle-offered.png') })
    await runGreAcceptanceSteps(page, {
      steps: [
        {
          activate: {
            card: 'Miscalculation',
            zone: 'hand',
            ability_index: paidMana && !choosePaid ? 1 : 0,
          },
        },
        { resolve_stack: {} },
        {
          expect: {
            all: [
              { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Miscalculation' } },
              { zone_contains: { side: 'ours', zone: 'hand', card: 'Forest' } },
              { stack_empty: true },
            ],
          },
        },
      ],
    })
    const afterFirst = await page.evaluate(() => window.__greState()!)
    expect(afterFirst.counts.you.library).toBe(5)
    expect(afterFirst.counts.you.graveyard).toBe(1)
    expect(
      afterFirst.board.you.filter((card) => card.name === 'Island' && card.tapped),
    ).toHaveLength(choosePaid ? 2 : 0)
    expect(afterFirst.hand.map((card) => card.name).sort()).toEqual([
      'Forest',
      'Ornithopter',
      'Remote Isle',
    ])
    await page.screenshot({ path: info.outputPath('first-cycle-discard-draw.png') })
    if (paidMana && !choosePaid) {
      await runGreAcceptanceSteps(page, {
        steps: [
          { activate: { card: 'Remote Isle', zone: 'hand' } },
          { resolve_stack: {} },
          {
            expect: {
              all: [
                { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Remote Isle' } },
                { zone_contains: { side: 'ours', zone: 'hand', card: 'Mountain' } },
                { stack_empty: true },
              ],
            },
          },
        ],
      })
      const afterSecond = await page.evaluate(() => window.__greState()!)
      expect(
        afterSecond.board.you.filter((card) => card.name === 'Island' && card.tapped),
      ).toHaveLength(2)
      expect(afterSecond.counts.you.library).toBe(4)
      expect(afterSecond.counts.you.graveyard).toBe(2)
    } else {
      const current = await readBrowserJournal(page)
      const secondIid = afterFirst.hand.find((card) => card.name === 'Remote Isle')!.iid
      const latest = current!.batches
        .flatMap((batch) => batch.messages)
        .filter(isRecord)
        .filter((message) => isRecord(message['actionsAvailableReq']))
        .at(-1)!['actionsAvailableReq'] as Record<string, unknown>
      expect(
        asArray(latest['actions'])
          .filter(isRecord)
          .filter((action) => action['actionType'] === 2 && action['instanceId'] === secondIid),
      ).toHaveLength(0)
      expect(
        asArray(latest['inactiveActions'])
          .filter(isRecord)
          .filter((action) => action['actionType'] === 2 && action['instanceId'] === secondIid),
      ).toHaveLength(1)
    }
    await runGreAcceptanceSteps(page, {
      steps: [
        { cast: 'Ornithopter' },
        { resolve_stack: {} },
        { expect: { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Ornithopter' } } },
      ],
    })
    const finalState = await page.evaluate(() => window.__greState()!)
    expect(finalState.turn).toBe(1)
    expect(finalState.diagnostics.errorCount).toBe(0)
    const journal = await readBrowserJournal(page)
    expect(journal!.context?.engineBuild).toBe(release.releaseId)
    const greType = await enumValue('ClientToMatchServiceMessageType', 'ClientToGremessage')
    const submitted: Record<string, unknown>[] = []
    for (const entry of journal!.responses ?? []) {
      if (!isRecord(entry) || typeof entry['payload'] !== 'string') {
        continue
      }
      const wrapper = await decodeMessage(
        'ClientToMatchServiceMessage',
        Buffer.from(entry['payload'], 'base64'),
      )
      if (wrapper['clientToMatchServiceMessageType'] !== greType) {
        continue
      }
      const response = await decodeMessage('ClientToGREMessage', wrapper['payload'] as Uint8Array)
      if (isRecord(response['performActionResp'])) {
        submitted.push(...asArray(response['performActionResp']['actions']).filter(isRecord))
      }
    }
    const activation = submitted.find(
      (action) => action['actionType'] === 2 && action['instanceId'] === iid,
    )!
    expect(activation).toMatchObject({
      abilityGrpId: chosen['abilityGrpId'],
      uniqueAbilityId: chosen['uniqueAbilityId'],
    })
    expect(asArray(activation['manaCost'])).toHaveLength(choosePaid ? 1 : 0)
    writeFileSync(
      info.outputPath('chosen-action.json'),
      JSON.stringify({ offers, chosen, source, submitted }),
    )
    writeFileSync(info.outputPath('served-release.json'), JSON.stringify(release))
    writeFileSync(info.outputPath('gavi-journal.json'), JSON.stringify(journal))
    writeFileSync(
      info.outputPath('gavi-outcome.json'),
      JSON.stringify({ choice, before, afterFirst, finalState }),
    )
    await page.screenshot({ path: info.outputPath('continued-play.png') })
  })
}
