import { useEffect } from 'react'
import { greStore } from '@engine/runtime/gre-store'
import { boardAudio } from '@shared/audio'
import { BoardSounds } from './board-sounds'

export function useBoardSounds(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const sounds = new BoardSounds()
    const observe = () => {
      const board = greStore.snapshot()
      if (document.visibilityState === 'hidden' || !board.connected) {
        boardAudio.stop()
        sounds.reset()
        return
      }
      const batch = sounds.observe(board)
      if (batch.reset) {
        boardAudio.stop()
      }
      boardAudio.play(batch.cues)
    }
    observe()
    const unsubscribe = greStore.subscribe(observe)
    window.addEventListener('pointerdown', boardAudio.unlock, { capture: true })
    window.addEventListener('keydown', boardAudio.unlock, { capture: true })
    document.addEventListener('visibilitychange', observe)
    return () => {
      unsubscribe()
      window.removeEventListener('pointerdown', boardAudio.unlock, { capture: true })
      window.removeEventListener('keydown', boardAudio.unlock, { capture: true })
      document.removeEventListener('visibilitychange', observe)
      boardAudio.stop()
    }
  }, [enabled])
}
