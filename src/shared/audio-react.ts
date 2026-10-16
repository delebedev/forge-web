import { useSyncExternalStore } from 'react'
import { boardAudio } from './audio'

export function useSoundPreferences() {
  return useSyncExternalStore(boardAudio.subscribe, boardAudio.snapshot, boardAudio.snapshot)
}
