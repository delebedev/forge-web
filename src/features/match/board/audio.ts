import { SOUND_CUES, SOUND_DEFAULT_VOLUME, type SoundCue } from './sound-cues'

const VOLUME_KEY = 'forge.soundVolume'
const MUTED_KEY = 'forge.soundMuted'
const MAX_VOICES = 4
const MAX_CUE_AGE_MS = 250
const BATCH_WINDOW_MS = 35

export type SoundPreferences = { muted: boolean; volume: number }

function loadPreferences(): SoundPreferences {
  try {
    const stored = localStorage.getItem(VOLUME_KEY)
    const volume = stored == null ? SOUND_DEFAULT_VOLUME : Number(stored)
    return {
      muted: localStorage.getItem(MUTED_KEY) === '1',
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : SOUND_DEFAULT_VOLUME,
    }
  } catch {
    return { muted: false, volume: SOUND_DEFAULT_VOLUME }
  }
}

/** One browser audio context. Late loads and queued cues cannot outlive their board. */
export class BoardAudio {
  private preferences = loadPreferences()
  private listeners = new Set<() => void>()
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private buffers = new Map<string, Promise<AudioBuffer>>()
  private voices = new Set<AudioBufferSourceNode>()
  private lastPlayed = new Map<SoundCue, number>()
  private variants = new Map<SoundCue, number>()
  private pending = new Set<SoundCue>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0

  private createContext: () => AudioContext

  constructor(createContext = () => new AudioContext()) {
    this.createContext = createContext
  }

  snapshot = (): SoundPreferences => this.preferences

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setMuted(muted: boolean): void {
    this.updatePreferences({ ...this.preferences, muted })
  }

  toggleMute = (): void => this.setMuted(!this.preferences.muted)

  setVolume = (volume: number): void => {
    if (Number.isFinite(volume)) {
      this.updatePreferences({ ...this.preferences, volume: Math.max(0, Math.min(1, volume)) })
    }
  }

  private updatePreferences(preferences: SoundPreferences): void {
    this.preferences = preferences
    if (this.master) {
      this.master.gain.value = preferences.muted ? 0 : preferences.volume
    }
    if (preferences.muted || preferences.volume === 0) {
      this.stop()
    }
    try {
      localStorage.setItem(MUTED_KEY, preferences.muted ? '1' : '0')
      localStorage.setItem(VOLUME_KEY, String(preferences.volume))
    } catch {
      // The preference remains usable when browser storage is unavailable.
    }
    for (const listener of this.listeners) {
      listener()
    }
  }

  /** Call directly from a pointer or keyboard gesture; never queue earlier game events. */
  unlock = (): void => {
    try {
      if (!this.context) {
        this.context = this.createContext()
        this.master = this.context.createGain()
        this.master.gain.value = this.preferences.muted ? 0 : this.preferences.volume
        this.master.connect(this.context.destination)
        for (const cue of Object.values(SOUND_CUES)) {
          for (const file of cue.files) {
            void this.load(file).catch(() => {})
          }
        }
      }
      void this.context.resume().catch(() => {})
    } catch {
      // Audio is optional; unsupported browsers must still be able to play.
    }
  }

  play(cues: readonly SoundCue[]): void {
    if (
      this.preferences.muted ||
      this.preferences.volume === 0 ||
      this.context?.state !== 'running'
    ) {
      return
    }
    for (const cue of cues) {
      this.pending.add(cue)
    }
    if (this.pending.size > 0 && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        const pending = [...this.pending]
        this.pending.clear()
        const outcome = pending.find((cue) => cue === 'win' || cue === 'lose')
        if (outcome) {
          this.stop()
        }
        for (const cue of outcome ? [outcome] : pending.slice(0, MAX_VOICES)) {
          void this.playClip(cue)
        }
      }, BATCH_WINDOW_MS)
    }
  }

  stop = (): void => {
    ++this.generation
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = null
    this.pending.clear()
    this.lastPlayed.clear()
    for (const voice of this.voices) {
      voice.stop()
    }
    this.voices.clear()
  }

  private load(file: string): Promise<AudioBuffer> {
    let buffer = this.buffers.get(file)
    if (!buffer) {
      const context = this.context!
      buffer = fetch(`/sounds/kenney/${file}.mp3`)
        .then((response) => {
          if (!response.ok) {
            throw new Error('Sound unavailable')
          }
          return response.arrayBuffer()
        })
        .then((bytes) => context.decodeAudioData(bytes))
        .catch((error) => {
          this.buffers.delete(file)
          throw error
        })
      this.buffers.set(file, buffer)
    }
    return buffer
  }

  private async playClip(cue: SoundCue): Promise<void> {
    const clip = SOUND_CUES[cue]
    const requestedAt = Date.now()
    if (requestedAt - (this.lastPlayed.get(cue) ?? -Infinity) < clip.cooldown) {
      return
    }
    this.lastPlayed.set(cue, requestedAt)
    const variant = this.variants.get(cue) ?? 0
    this.variants.set(cue, variant + 1)
    const generation = this.generation
    try {
      const buffer = await this.load(clip.files[variant % clip.files.length]!)
      const context = this.context
      if (
        generation !== this.generation ||
        !context ||
        !this.master ||
        context.state !== 'running' ||
        this.preferences.muted ||
        this.preferences.volume === 0 ||
        Date.now() - requestedAt > MAX_CUE_AGE_MS
      ) {
        return
      }
      if (this.voices.size >= MAX_VOICES) {
        const oldest = this.voices.values().next().value!
        oldest.stop()
        this.voices.delete(oldest)
      }
      const voice = context.createBufferSource()
      const gain = context.createGain()
      voice.buffer = buffer
      gain.gain.value = clip.gain
      voice.connect(gain).connect(this.master)
      this.voices.add(voice)
      voice.onended = () => {
        this.voices.delete(voice)
        voice.disconnect()
        gain.disconnect()
      }
      voice.start()
    } catch {
      // A missing clip must not interrupt a game or become an unhandled rejection.
    }
  }
}

export const boardAudio = new BoardAudio()
