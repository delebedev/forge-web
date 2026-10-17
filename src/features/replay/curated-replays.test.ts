import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { CURATED_REPLAYS, curatedReplay, replaySetupPath } from './curated-replays'
import {
  parseTranscriptBundle,
  transcriptCardMeta,
  TranscriptFrameSource,
} from '@engine/replay/gre-transcript'
import { GreStore } from '@engine/runtime/gre-store'

test('every curated replay folds through the real store to a complete outcome with local card metadata', async () => {
  for (const sample of CURATED_REPLAYS) {
    const bundle = parseTranscriptBundle(JSON.parse(readFileSync(`public${sample.url}`, 'utf8')))
    expect(bundle.status).toMatchObject({ complete: true, truncated: false })
    expect(bundle.source).toBe('Authored Forge game')
    const states = bundle.batches
      .flatMap((batch) => batch.messages)
      .flatMap((raw) => {
        const message = raw as {
          gameStateMessage?: {
            gameStateId?: number
            gameInfo?: { stage?: string }
            players?: { lifeTotal?: number }[]
            zones?: { type?: string; ownerSeatId?: number; objectInstanceIds?: number[] }[]
          }
        }
        return message.gameStateMessage ? [message.gameStateMessage] : []
      })
    expect(states[0]?.gameStateId).toBe(1)
    expect(states[0]?.gameInfo?.stage).toBe('Start_a920')
    expect(states[0]?.players?.map((player) => player.lifeTotal)).toEqual(
      sample.gameType === 'commander' ? [40, 40] : [20, 20],
    )
    const openingHands = states[1]?.zones?.filter((zone) => zone.type === 'Hand')
    expect(openingHands?.map((zone) => zone.objectInstanceIds?.length)).toEqual([7, 7])
    expect(bundle.context).toBeUndefined()
    expect(bundle.events).toEqual([])
    const objects = bundle.batches
      .flatMap((batch) => batch.messages)
      .flatMap((raw) => {
        const message = raw as { gameStateMessage?: { gameObjects?: { grpId?: number }[] } }
        return message.gameStateMessage?.gameObjects ?? []
      })
    for (const object of objects) {
      if (object.grpId && object.grpId > 0) {
        expect(bundle.cards[String(object.grpId)]).toBeDefined()
      }
    }
    const store = new GreStore()
    store.seedCardMeta(transcriptCardMeta(bundle))
    const source = new TranscriptFrameSource(bundle)
    await source.ready()
    store.setViewerSeat(bundle.viewerSeatId)
    store.attachSource(source)
    source.seek(source.frames.length)
    expect(source.misses).toEqual([])
    expect(store.snapshot().gameOver).toBe(true)
    expect(['win', 'loss', 'draw']).toContain(store.snapshot().outcome?.viewerResult ?? 'unknown')
    source.stop()
    for (const deck of [sample.seat1Deck, sample.seat2Deck]) {
      const count = [...deck.matchAll(/^(\d+) /gm)].reduce(
        (sum, match) => sum + Number(match[1]),
        0,
      )
      expect(count).toBe(sample.gameType === 'commander' ? 100 : 60)
    }
  }
})

test('only curated identifiers select a public replay and its fresh-game handoff', () => {
  expect(curatedReplay('https://example.com/private.json')).toBeUndefined()
  expect(curatedReplay('../operator-replay')).toBeUndefined()
  expect(curatedReplay('toString')).toBeUndefined()
  for (const sample of CURATED_REPLAYS) {
    expect(curatedReplay(sample.id)).toBe(sample)
    expect(replaySetupPath(sample.id)).toBe(`/play/game?replay=${sample.id}`)
  }
})
