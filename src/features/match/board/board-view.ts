/**
 * View preferences for the board — what the player wants shown, as opposed to
 * what the game says is true.
 *
 * Kept out of `BoardProps` deliberately. These are durable, viewer-local
 * settings with no session or network behind them, so the board can read them
 * directly; threading a prop per toggle would grow the board contract every
 * time an option is added.
 */

/** How much width the board is given. `full` fills whatever it is rendered into. */
export type BoardWidth = 'full' | 'laptop' | 'tablet'

export const BOARD_WIDTHS: Record<BoardWidth, { label: string; px: number | null }> = {
  full: { label: 'Full', px: null },
  laptop: { label: 'Laptop', px: 1180 },
  tablet: { label: 'Tablet', px: 900 },
}

/** Multiplier on the card size a row would otherwise choose. */
export const CARD_SCALE_MIN = 0.5
export const CARD_SCALE_MAX = 1.15
export const CARD_SCALE_STEP = 0.05

/** How much of a hand card the next one covers. */
export const HAND_OVERLAP_MIN = 0.05
export const HAND_OVERLAP_MAX = 0.6
export const HAND_OVERLAP_STEP = 0.05

export type BoardViewSnapshot = {
  width: BoardWidth
  cardScale: number
  handScale: number
  handOverlap: number
  previewScale: number
  playerPanelScale: number
  hideStack: boolean
  hideCardArt: boolean
}

export const BOARD_VIEW_DEFAULTS: BoardViewSnapshot = {
  width: 'full',
  cardScale: 0.7,
  handScale: 0.85,
  handOverlap: 0.45,
  previewScale: 0.8,
  playerPanelScale: 0.75,
  hideStack: false,
  hideCardArt: false,
}

const KEY = 'forge-web.board-view.'

function loadChoice<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY + name) : null
    if (raw && (allowed as readonly string[]).includes(raw)) {
      return raw as T
    }
  } catch {
    // ignore unavailable storage
  }
  return fallback
}

function saveChoice(name: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY + name, value)
    }
  } catch {
    // ignore quota / unavailable storage
  }
}

function loadScale(name: string, fallback: number): number {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY + name) : null
    const value = raw === null ? NaN : Number(raw)
    if (Number.isFinite(value)) {
      return Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, value))
    }
  } catch {
    // ignore unavailable storage
  }
  return fallback
}

function loadOverlap(): number {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(KEY + 'handOverlap') : null
    const value = raw === null ? NaN : Number(raw)
    if (Number.isFinite(value)) {
      return Math.min(HAND_OVERLAP_MAX, Math.max(HAND_OVERLAP_MIN, value))
    }
  } catch {
    // ignore unavailable storage
  }
  return BOARD_VIEW_DEFAULTS.handOverlap
}

const WIDTHS: readonly BoardWidth[] = ['full', 'laptop', 'tablet']

class BoardViewStore {
  private state: BoardViewSnapshot = {
    width: loadChoice('width', WIDTHS, BOARD_VIEW_DEFAULTS.width),
    cardScale: loadScale('cardScale', BOARD_VIEW_DEFAULTS.cardScale),
    handScale: loadScale('handScale', BOARD_VIEW_DEFAULTS.handScale),
    handOverlap: loadOverlap(),
    previewScale: loadScale('previewScale', BOARD_VIEW_DEFAULTS.previewScale),
    playerPanelScale: loadScale('playerPanelScale', BOARD_VIEW_DEFAULTS.playerPanelScale),
    hideStack: loadFlag('hideStack', BOARD_VIEW_DEFAULTS.hideStack),
    hideCardArt: loadFlag('hideCardArt', BOARD_VIEW_DEFAULTS.hideCardArt),
  }

  private listeners = new Set<() => void>()

  snapshot = (): BoardViewSnapshot => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setWidth = (value: BoardWidth): void => {
    this.set({ width: value })
    saveChoice('width', value)
  }

  setCardScale = (value: number): void => {
    const clamped = Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, value))
    this.set({ cardScale: clamped })
    saveChoice('cardScale', String(clamped))
  }

  setHandScale = (value: number): void => {
    const clamped = Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, value))
    this.set({ handScale: clamped })
    saveChoice('handScale', String(clamped))
  }

  setHandOverlap = (value: number): void => {
    const clamped = Math.min(HAND_OVERLAP_MAX, Math.max(HAND_OVERLAP_MIN, value))
    this.set({ handOverlap: clamped })
    saveChoice('handOverlap', String(clamped))
  }

  setPreviewScale = (value: number): void => {
    const clamped = Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, value))
    this.set({ previewScale: clamped })
    saveChoice('previewScale', String(clamped))
  }

  setPlayerPanelScale = (value: number): void => {
    const clamped = Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, value))
    this.set({ playerPanelScale: clamped })
    saveChoice('playerPanelScale', String(clamped))
  }

  setHideStack = (value: boolean): void => {
    this.set({ hideStack: value })
    saveFlag('hideStack', value)
  }

  setHideCardArt = (value: boolean): void => {
    this.set({ hideCardArt: value })
    saveFlag('hideCardArt', value)
  }

  private set(patch: Partial<BoardViewSnapshot>): void {
    const next = { ...this.state, ...patch }
    const same =
      next.width === this.state.width &&
      next.cardScale === this.state.cardScale &&
      next.handScale === this.state.handScale &&
      next.handOverlap === this.state.handOverlap &&
      next.previewScale === this.state.previewScale &&
      next.playerPanelScale === this.state.playerPanelScale &&
      next.hideStack === this.state.hideStack &&
      next.hideCardArt === this.state.hideCardArt
    if (same) {
      return
    }
    this.state = next
    for (const listener of this.listeners) {
      listener()
    }
  }
}

const FLAG_PREFIX = 'forge:gre:priority-flag:'

export const boardView = new BoardViewStore()

function loadFlag(name: string, fallback: boolean): boolean {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(FLAG_PREFIX + name) : null
    if (raw === 'true') {
      return true
    }
    if (raw === 'false') {
      return false
    }
  } catch {
    // ignore unavailable storage
  }
  return fallback
}

function saveFlag(name: string, value: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FLAG_PREFIX + name, value ? 'true' : 'false')
    }
  } catch {
    // ignore quota / unavailable storage
  }
}
