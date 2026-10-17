import samples from './curated-replays.json' with { type: 'json' }

export type CuratedReplay = Omit<(typeof samples)[number], 'gameType'> & {
  gameType: 'constructed' | 'commander'
}

export const CURATED_REPLAYS = samples as CuratedReplay[]

export function curatedReplay(id: string): CuratedReplay | undefined {
  return CURATED_REPLAYS.find((sample) => sample.id === id)
}

export function replaySetupPath(id: string): string {
  return `/play/game?replay=${encodeURIComponent(id)}`
}
