/** Clip selection and relative loudness. Replace assets here without changing game routing. */
export const SOUND_CUES = {
  draw: { files: ['card-slide-3'], gain: 0.7, cooldown: 160 },
  place: { files: ['card-place-1', 'card-place-2', 'card-place-3'], gain: 0.8, cooldown: 120 },
  cast: { files: ['card-shove-1', 'card-shove-2'], gain: 0.65, cooldown: 160 },
  ability: { files: ['select_007'], gain: 0.35, cooldown: 180 },
  select: { files: ['tick_001'], gain: 0.3, cooldown: 80 },
  combat: { files: ['card-shove-3'], gain: 0.7, cooldown: 250 },
  tap: { files: ['click_002'], gain: 0.25, cooldown: 120 },
  damage: { files: ['drop_004'], gain: 0.55, cooldown: 180 },
  gain: { files: ['pluck_001'], gain: 0.4, cooldown: 180 },
  remove: { files: ['card-slide-4', 'card-slide-5'], gain: 0.6, cooldown: 180 },
  win: { files: ['confirmation_001'], gain: 0.55, cooldown: 1000 },
  lose: { files: ['close_001'], gain: 0.45, cooldown: 1000 },
} as const

export type SoundCue = keyof typeof SOUND_CUES
export const SOUND_DEFAULT_VOLUME = 0.35
export const SOUND_VOLUME_STEP = 0.05
