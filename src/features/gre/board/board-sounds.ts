import type { BoardSnapshot } from '@engine/runtime/snapshot'
import type { PromptView } from '@engine/state/gre-state'
import type { SoundCue } from '@shared/sound-cues'

const ZONE_CUES: Record<string, SoundCue | undefined> = {
  Draw: 'draw',
  PlayLand: 'place',
  CastSpell: 'cast',
  Discard: 'remove',
  Destroy: 'remove',
  Sacrifice: 'remove',
  Exile: 'remove',
  Bounce: 'remove',
  Mill: 'remove',
}

function selection(prompt: PromptView | null): string {
  switch (prompt?.kind) {
    case 'targets':
      return (prompt.candidates ?? [])
        .filter((c) => c.selected)
        .map((c) => `${c.targetIdx}:${c.targetInstanceId}:${c.legalAction}`)
        .sort()
        .join(',')
    case 'attackers':
      return (prompt.attackers ?? [])
        .filter((c) => c.selected)
        .map((c) => `${c.attackerInstanceId}:${c.damageRecipientKey}`)
        .sort()
        .join(',')
    case 'blockers':
      return (prompt.blockers ?? [])
        .flatMap((b) =>
          b.attackers
            .filter((a) => a.selected)
            .map((a) => `${b.blockerInstanceId}:${a.attackerInstanceId}`),
        )
        .sort()
        .join(',')
    default:
      return ''
  }
}

function samePrompt(a: PromptView | null, b: PromptView | null): boolean {
  return a?.kind === b?.kind && a?.interactionKey === b?.interactionKey
}

export type BoardSoundBatch = { cues: SoundCue[]; reset: boolean }

/** Observe presentation snapshots, not raw arrivals or DOM animation completion. */
export class BoardSounds {
  private previous: BoardSnapshot | null = null

  reset(): void {
    this.previous = null
  }

  observe(board: BoardSnapshot): BoardSoundBatch {
    const previous = this.previous
    this.previous = board
    if (
      !previous ||
      !board.connected ||
      !previous.connected ||
      board.gameStateId === 0 ||
      board.currentMatchId !== previous.currentMatchId ||
      (board.gameStateId !== previous.gameStateId && !board.presentation) ||
      (board.presentation &&
        previous.presentation &&
        board.presentation.seq < previous.presentation.seq)
    ) {
      return { cues: [], reset: true }
    }
    if (board.gameOver) {
      const result = board.outcome?.viewerResult
      const cues: SoundCue[] =
        previous.outcome?.viewerResult === result
          ? []
          : result === 'win'
            ? ['win']
            : result === 'loss'
              ? ['lose']
              : []
      return { cues, reset: false }
    }
    const cues = new Set<SoundCue>()
    const frame = board.presentation
    if (frame && frame.seq !== previous.presentation?.seq) {
      for (const hint of frame.hints) {
        const cue = ZONE_CUES[hint.category ?? '']
        if (cue) {
          cues.add(cue)
        }
        if (hint.kind === 'damage') {
          cues.add('damage')
        }
        if (hint.kind === 'tap') {
          const ids = new Set(hint.affectedIds)
          const cards = [...board.battlefield, ...board.opponentBattlefield]
          const prior = [...previous.battlefield, ...previous.opponentBattlefield]
          if (
            cards.some(
              (card) =>
                ids.has(card.instanceId) &&
                card.tapped &&
                prior.some((old) => old.instanceId === card.instanceId && !old.tapped),
            )
          ) {
            cues.add('tap')
          }
        }
      }
      const previousBattlefield = new Set(
        [...previous.battlefield, ...previous.opponentBattlefield].map((card) => card.instanceId),
      )
      if (
        frame.moves.some((move) => move.to === 'battlefield') ||
        [...board.battlefield, ...board.opponentBattlefield].some(
          (card) => !previousBattlefield.has(card.instanceId),
        )
      ) {
        cues.add('place')
      }
      if (frame.newStackAbility) {
        cues.add('ability')
      }
      for (const [current, prior] of [
        [board.viewer, previous.viewer],
        [board.opponent, previous.opponent],
      ]) {
        if (current && prior && current.seatId === prior.seatId) {
          if (current.lifeTotal < prior.lifeTotal) {
            cues.add('damage')
          } else if (current.lifeTotal > prior.lifeTotal) {
            cues.add('gain')
          }
        }
      }
    }
    const prompt = board.prompt
    const oldPrompt = previous.prompt
    if (
      prompt &&
      oldPrompt &&
      samePrompt(prompt, oldPrompt) &&
      selection(prompt) !== selection(oldPrompt)
    ) {
      cues.add('select')
    }
    if (
      oldPrompt &&
      (oldPrompt.kind === 'attackers' || oldPrompt.kind === 'blockers') &&
      prompt?.kind !== oldPrompt.kind &&
      selection(oldPrompt)
    ) {
      cues.add('combat')
    }
    return { cues: [...cues], reset: false }
  }
}
