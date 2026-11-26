import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { BoardAudio } from './audio'

const waitForBatch = () => new Promise((resolve) => setTimeout(resolve, 45))
const originalStorage = globalThis.localStorage
let fetchSpy: ReturnType<typeof spyOn>
let storage: Map<string, string>
let players: BoardAudio[]

beforeEach(() => {
  players = []
  storage = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    (async () => new Response(new Uint8Array([0]))) as unknown as typeof fetch,
  )
})
afterEach(() => {
  for (const player of players) {
    player.stop()
  }
  fetchSpy.mockRestore()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage })
})

function audio(decode = async () => ({}) as AudioBuffer) {
  const voices: Array<{ started: boolean; stopped: boolean }> = []
  const gains: Array<{ gain: { value: number } }> = []
  const context = {
    state: 'suspended',
    destination: {},
    resume() {
      this.state = 'running'
      return Promise.resolve()
    },
    decodeAudioData: decode,
    createGain() {
      const gain = {
        gain: { value: 0 },
        connect() {
          return this
        },
        disconnect() {},
      }
      gains.push(gain)
      return gain
    },
    createBufferSource() {
      const voice = {
        started: false,
        stopped: false,
        buffer: null,
        onended: null as (() => void) | null,
        connect(gain: unknown) {
          return gain
        },
        disconnect() {},
        start() {
          this.started = true
        },
        stop() {
          this.stopped = true
          this.onended?.()
        },
      }
      voices.push(voice)
      return voice
    },
  }
  const player = new BoardAudio(() => context as unknown as AudioContext)
  players.push(player)
  return { player, context, voices, gains }
}

test('events before gesture unlock are dropped, subsequent cues merge and repeats are limited', async () => {
  const { player, voices } = audio()
  player.play(['draw'])
  await waitForBatch()
  expect(voices).toHaveLength(0)
  player.unlock()
  player.play(['draw', 'draw'])
  player.play(['draw', 'place'])
  await waitForBatch()
  expect(voices.filter((voice) => voice.started)).toHaveLength(2)
  player.play(['draw'])
  await waitForBatch()
  expect(voices).toHaveLength(2)
})

test('mute and volume publish synchronized preferences, persist and silence active voices', async () => {
  const { player, voices, gains } = audio()
  let publications = 0
  const unsubscribe = player.subscribe(() => ++publications)
  player.unlock()
  player.play(['place'])
  await waitForBatch()
  expect(voices[0]!.started).toBe(true)
  player.setVolume(0.2)
  expect(gains[0]!.gain.value).toBe(0.2)
  player.toggleMute()
  expect(voices[0]!.stopped).toBe(true)
  expect(gains[0]!.gain.value).toBe(0)
  expect(player.snapshot()).toEqual({ muted: true, volume: 0.2 })
  expect(storage.get('forge.soundMuted')).toBe('1')
  expect(new BoardAudio().snapshot()).toEqual({ muted: true, volume: 0.2 })
  player.play(['damage'])
  await waitForBatch()
  expect(voices).toHaveLength(1)
  expect(publications).toBe(2)
  unsubscribe()
})

test('board retirement and mute cancel queued and in-flight clip loads', async () => {
  let finish: ((buffer: AudioBuffer) => void) | undefined
  const loaded = new Promise<AudioBuffer>((resolve) => {
    finish = resolve
  })
  const { player, voices } = audio(() => loaded)
  player.unlock()
  player.play(['draw'])
  await waitForBatch()
  player.stop()
  finish!({} as AudioBuffer)
  await waitForBatch()
  expect(voices).toHaveLength(0)
  player.play(['place'])
  player.setMuted(true)
  await waitForBatch()
  expect(voices).toHaveLength(0)
})

test('outcomes replace burst cues and the mixer caps simultaneous voices', async () => {
  const { player, voices } = audio()
  player.unlock()
  player.play(['draw', 'tap', 'place', 'damage', 'gain', 'ability'])
  await waitForBatch()
  expect(voices.filter((voice) => voice.started && !voice.stopped)).toHaveLength(4)
  player.play(['draw', 'win'])
  await waitForBatch()
  expect(voices.filter((voice) => voice.started && !voice.stopped)).toHaveLength(1)
})

test('missing clips and unavailable browser audio do not interrupt game code', async () => {
  fetchSpy.mockRejectedValue(new Error('offline'))
  const { player, voices } = audio()
  expect(() => player.unlock()).not.toThrow()
  player.play(['draw'])
  await waitForBatch()
  expect(voices).toHaveLength(0)
  const unavailable = new BoardAudio(() => {
    throw new Error('unsupported')
  })
  expect(() => unavailable.unlock()).not.toThrow()
  expect(() => unavailable.play(['tap'])).not.toThrow()
})

test.each(['fetch', 'decode'])(
  'playback retries after a transient %s preload failure',
  async (failure) => {
    let recovered = false
    fetchSpy.mockImplementation((async () => {
      if (failure === 'fetch' && !recovered) {
        throw new Error('offline')
      }
      return new Response(new Uint8Array([0]))
    }) as unknown as typeof fetch)
    const { player, voices } = audio(async () => {
      if (failure === 'decode' && !recovered) {
        throw new Error('decode failed')
      }
      return {} as AudioBuffer
    })
    player.unlock()
    await waitForBatch()
    recovered = true
    player.play(['draw'])
    await waitForBatch()
    expect(voices.filter((voice) => voice.started)).toHaveLength(1)
  },
)

test('a slow asset cannot play a stale event even while the board remains active', async () => {
  let finish: ((buffer: AudioBuffer) => void) | undefined
  const loaded = new Promise<AudioBuffer>((resolve) => {
    finish = resolve
  })
  let clock = 1000
  let cueRequested!: () => void
  const requested = new Promise<void>((resolve) => {
    cueRequested = resolve
  })
  const now = spyOn(Date, 'now').mockImplementation(() => {
    cueRequested()
    return clock
  })
  try {
    const { player, voices } = audio(() => loaded)
    player.unlock()
    player.play(['draw'])
    await requested
    clock += 300
    finish!({} as AudioBuffer)
    await waitForBatch()
    expect(voices).toHaveLength(0)
  } finally {
    now.mockRestore()
  }
})
