import { writeFileSync } from 'node:fs'
import { test, readyForVideo, recordDemos } from './demo-test'
import { runGreAcceptanceSteps } from './gre-acceptance'
import { observeGreResponses, readBrowserJournal } from './gre-browser-observations'
import { startScenario } from './gre-scenario'
import { authenticateShell, expect } from './gre-test'
import { enumValue, type ProtoObject } from '../src/engine/wire/gre-proto'
import { asArray, asNumber, isRecord } from '../src/engine/state/gre-state'
import { resolveTo } from './gre-actions'

for (const shuffle of [false, true]) {
  test(`Ponder ${shuffle ? 'accepts' : 'declines'} shuffle after reordering and resumes play`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000)
    await page.addInitScript(() =>
      localStorage.setItem('forge:gre:priority-flag:hideCardArt', 'true'),
    )
    await authenticateShell(page, 'optional-shuffle')
    const observation = await observeGreResponses(page, 'optionalResp')
    const releaseResponse = await page.request.get('/browser-engine/release.json')
    expect(releaseResponse.ok()).toBe(true)
    const release = (await releaseResponse.json()) as { releaseId: string }
    writeFileSync(info.outputPath('served-release.json'), JSON.stringify(release))
    await startScenario(page, 'optional-shuffle', 'browser', 42)
    expect(page.workers().some((worker) => worker.url().includes('engine-worker.js'))).toBe(true)
    await expect(page.locator('[data-board]')).toHaveAttribute('data-card-art', 'off')
    readyForVideo.add(page)
    await runGreAcceptanceSteps(page, {
      steps: [{ cast: 'Ponder' }, { pass_until: { prompt: 'OrderReq' } }],
    })
    await page.screenshot({ path: info.outputPath('reorder.png') })
    await runGreAcceptanceSteps(page, {
      steps: [{ order_cards: ['Plains', 'Forest', 'Mountain'] }],
    })
    writeFileSync(
      info.outputPath('after-order.json'),
      JSON.stringify(await readBrowserJournal(page)),
    )
    const optional = page.locator('[data-prompt="optionalAction"]')
    await expect(optional).toBeVisible({ timeout: 20_000 })
    await expect(optional).toContainText('Shuffle the library?')
    await page.screenshot({ path: info.outputPath('shuffle-choice.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
    await runGreAcceptanceSteps(page, {
      steps: [
        { optional_action: { accept: shuffle } },
        { resolve_stack: {} },
        {
          expect: {
            all: [
              { stack_empty: true },
              { zone_contains: { side: 'ours', zone: 'graveyard', card: 'Ponder' } },
              { zone_count: { side: 'ours', zone: 'hand', count: 2 } },
              ...(!shuffle
                ? [{ zone_contains: { side: 'ours', zone: 'hand', card: 'Plains' } }]
                : []),
            ],
          },
        },
      ],
    })
    // Freeze Ponder's result before continued play can reach another draw step.
    const journal = await readBrowserJournal(page)
    expect(journal).not.toBeNull()
    expect(journal!.context?.engineBuild).toBe(release.releaseId)
    expect(journal!.context?.seed).toBe(42)
    writeFileSync(info.outputPath('ponder-journal.json'), JSON.stringify(journal))
    const messages = journal!.batches.flatMap((batch) => batch.messages).filter(isRecord)
    const states = messages.map((message) => message['gameStateMessage']).filter(isRecord)
    const libraries = states
      .flatMap((state) => asArray(state['zones']).filter(isRecord))
      .filter((zone) => zone['type'] === 1 && zone['ownerSeatId'] === 1)
    const ids = (value: unknown) => asArray(value).map(asNumber)
    const initial = ids(libraries[0]!['objectInstanceIds'])
    expect(initial).toHaveLength(6)
    const order = messages.find((message) => message['orderReq'])!['orderReq'] as { ids: number[] }
    expect(order.ids).toEqual(initial.slice(0, 3))
    const intended = [initial[2], initial[0], initial[1], ...initial.slice(3)]
    const annotations = states.flatMap((state) => asArray(state['annotations']).filter(isRecord))
    const detail = (annotation: ProtoObject, key: string) =>
      ids(
        asArray(annotation['details'])
          .filter(isRecord)
          .find((entry) => entry['key'] === key)?.['valueInt32'],
      )
    const drawn = annotations.find((annotation) =>
      asArray(annotation['details'])
        .filter(isRecord)
        .some(
          (entry) => entry['key'] === 'category' && asArray(entry['valueString']).includes('Draw'),
        ),
    )!
    expect(drawn).toBeDefined()
    const newId = ids(drawn['affectedIds'])[0]
    const transfer = annotations.find(
      (annotation) =>
        ids(annotation['type']).includes(13) && detail(annotation, 'new_id')[0] === newId,
    )!
    expect(transfer).toBeDefined()
    const drawnId = detail(transfer, 'orig_id')[0]
    const shuffles = annotations.filter((annotation) => ids(annotation['type']).includes(56))
    expect(shuffles).toHaveLength(shuffle ? 1 : 0)
    const finalLibrary = ids(libraries.at(-1)!['objectInstanceIds'])
    const resultingOrder = shuffle
      ? [drawnId, ...detail(shuffles[0]!, 'OldIds')]
      : [drawnId, ...finalLibrary]
    expect([...resultingOrder].sort()).toEqual([...initial].sort())
    if (shuffle) {
      expect(resultingOrder).not.toEqual(intended)
    } else {
      expect(resultingOrder).toEqual(intended)
    }
    const choice = messages.find((message) => message['optionalActionMessage'])!
    await observation.settle()
    expect(observation.responses).toHaveLength(1)
    expect(observation.responses[0]).toMatchObject({
      gameStateId: choice['gameStateId'],
      respId: choice['msgId'],
      optionalResp: {
        response: await enumValue('OptionResponse', shuffle ? 'AllowYes' : 'CancelNo'),
      },
    })
    await page.screenshot({ path: info.outputPath('drawn.png') })
    await resolveTo(
      page,
      { zone_contains: { side: 'ours', zone: 'battlefield', card: 'Swamp' } },
      () => runGreAcceptanceSteps(page, { steps: [{ play_land: 'Swamp' }] }),
    )
    await page.mouse.move(640, 300)
    writeFileSync(info.outputPath('journal.json'), JSON.stringify(await readBrowserJournal(page)))
    await page.screenshot({ path: info.outputPath('continued-play.png') })
    if (recordDemos) {
      await page.waitForTimeout(1000)
    }
  })
}
