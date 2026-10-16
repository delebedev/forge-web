import { authenticateShell, expect, handZone, startPuzzleGame, test } from './gre-test'
import { loadAcceptanceSuite, runGreAcceptanceSteps } from './gre-acceptance'

// Count real Web Audio starts while retaining native decoding and browser autoplay policy.
test('board sounds follow real play and synchronized persistent controls', async ({
  page,
}, info) => {
  const requests: string[] = []
  const failedSounds: string[] = []
  page.on('response', (response) => {
    if (response.url().includes('/sounds/kenney/') && !response.ok()) {
      failedSounds.push(response.url())
    }
  })
  page.on('request', (request) => {
    if (request.url().includes('/sounds/kenney/')) {
      requests.push(request.url())
    }
  })
  await page.addInitScript(() => {
    if (localStorage.getItem('forge.soundMuted') == null) {
      localStorage.setItem('forge.soundMuted', '0')
    }
    if (localStorage.getItem('forge.soundVolume') == null) {
      localStorage.setItem('forge.soundVolume', '0.35')
    }
    localStorage.setItem('forge-web.board-view.hideCardArt', '1')
    const original = AudioBufferSourceNode.prototype.start
    const state = { starts: 0, decoded: 0 }
    const decode = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function (...args) {
      const result = decode.apply(this, args)
      void result.then(() => ++state.decoded).catch(() => {})
      return result
    }
    Object.assign(window, { __soundTest: state })
    AudioBufferSourceNode.prototype.start = function (...args) {
      ++state.starts
      return original.apply(this, args)
    }
  })
  await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 204 }))
  await authenticateShell(page)
  await startPuzzleGame(page, 'commander-return-self-bolt')
  await expect.poll(() => handZone(page).count()).toBeGreaterThan(0)
  const starts = () =>
    page.evaluate(
      () => (window as unknown as { __soundTest: { starts: number } }).__soundTest.starts,
    )
  await expect.poll(starts).toBe(0)
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  const sounds = page.getByRole('checkbox', { name: 'Sounds', exact: true })
  await expect(sounds).toBeChecked()
  await page.getByRole('checkbox', { name: 'Hide card art', exact: true }).check()
  await page.getByRole('button', { name: 'Test sound', exact: true }).click()
  await expect.poll(starts).toBe(1)
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __soundTest: { decoded: number } }).__soundTest.decoded,
      ),
    )
    .toBe(16)
  await sounds.uncheck()
  await expect(page.getByRole('button', { name: 'Test sound', exact: true })).toBeDisabled()
  await sounds.check()
  await expect(sounds).toBeChecked()
  const volume = page.getByRole('slider', { name: 'Sound volume', exact: true })
  await volume.fill('0.2')
  expect(await page.evaluate(() => localStorage.getItem('forge.soundVolume'))).toBe('0.2')
  await page.screenshot({ path: info.outputPath('sound-options.png') })
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  const baseline = await starts()
  const scenario = loadAcceptanceSuite('interactions-warmup').scenarios.find(
    (entry) => entry.id === 'commander-return-after-destroy',
  )!
  await runGreAcceptanceSteps(page, scenario)
  await expect.poll(starts).toBeGreaterThan(baseline)
  const withSound = await starts()
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await sounds.uncheck()
  await page.getByRole('button', { name: 'Board options', exact: true }).click()
  await page.evaluate(() => window.__greActWait('concede'))
  await expect(page.getByRole('heading', { name: 'Defeat', exact: true }).first()).toBeVisible()
  await page.waitForTimeout(350)
  expect(await starts()).toBe(withSound)
  await page.goto('/play/replay')
  await expect(page.getByRole('button', { name: 'Unmute sounds', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('forge.soundVolume'))).toBe('0.2')
  await page.getByRole('button', { name: 'Unmute sounds', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('forge.soundMuted'))).toBe('0')
  expect(failedSounds).toEqual([])
  expect(requests.length).toBeGreaterThan(0)
  await info.attach('audio-proof', {
    body: JSON.stringify({ requests, failedSounds, withSound }),
    contentType: 'application/json',
  })
})
