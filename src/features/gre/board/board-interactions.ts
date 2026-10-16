/**
 * Hand-to-battlefield drag-to-play, and board click-to-select state for
 * targets/attackers/blockers. Board interaction mirrors the prompt dock:
 * clicking a board card invokes the same bound controls the dock button would,
 * so both inputs stay in sync and the dock remains available.
 *
 * Local to one `GrePlay` mount (not a shared store), so this is a plain hook
 * over `useState`/`useRef` rather than a `createExternalStore` seam.
 */

import type { PromptBinding } from '@engine/runtime/prompts/family'
import { useCallback, useRef, useState } from 'react'
import type { CardView, LegalAction, PromptView } from '@engine/state/gre-state'

export type BoardClick = {
  selectable: boolean
  selected: boolean
  disabled: boolean
  onClick?: () => void
}

export type DragState = {
  card: CardView
  action: LegalAction
  x: number
  y: number
  startX: number
  startY: number
  started: boolean
}

type PointerLike = { clientX: number; clientY: number }

export type BoardInteractions = {
  drag: DragState | null
  declaredAttackers: Set<number>
  blockAssignments: { blocker: number; attacker: number }[]
  boardCardState(card: CardView, owner: 'self' | 'opp', interactive: boolean): BoardClick
  startHandDrag(
    card: CardView,
    action: LegalAction,
    event: PointerLike,
    interactive: boolean,
  ): boolean
  moveDrag(event: PointerEvent): void
  endDrag(event: PointerEvent, dropZone: HTMLElement | null): void
}

/** Prompt controls and the caller's ordinary action retain runtime delivery ownership. */
export function useBoardInteractions(
  prompt: PromptView | null | undefined,
  gameOver: boolean,
  binding: PromptBinding | null = null,
  onLegalAction: ((action: LegalAction) => void) | null = null,
): BoardInteractions {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [pendingBlocker, setPendingBlocker] = useState<{ key: number; id: number } | null>(null)
  const declaredAttackers = new Set(
    prompt?.kind === 'attackers'
      ? (prompt.attackers ?? [])
          .filter((attacker) => attacker.selected)
          .map((attacker) => attacker.attackerInstanceId)
      : [],
  )
  const blockAssignments =
    prompt?.kind === 'blockers'
      ? (prompt.blockers ?? []).flatMap((blocker) =>
          blocker.attackers
            .filter((attacker) => attacker.selected)
            .map((attacker) => ({
              blocker: blocker.blockerInstanceId,
              attacker: attacker.attackerInstanceId,
            })),
        )
      : []

  const current = useRef({ prompt, binding, gameOver })
  current.current = { prompt, binding, gameOver }
  const active = () =>
    current.current.prompt?.kind === 'blockers' &&
    current.current.prompt.interactionKey === prompt?.interactionKey &&
    current.current.binding?.kind === 'blockers' &&
    current.current.binding.view === current.current.prompt &&
    !!current.current.binding.controls &&
    !current.current.gameOver &&
    !current.current.prompt?.waiting
  const pendingId = pendingBlocker?.key === prompt?.interactionKey ? pendingBlocker?.id : null

  const boardCardState = (
    card: CardView,
    owner: 'self' | 'opp',
    interactive: boolean,
  ): BoardClick => {
    if (card.phasedOut || !interactive || gameOver) {
      return { selectable: false, selected: false, disabled: true, onClick: undefined }
    }
    const p = prompt
    const iid = card.instanceId
    if (p?.kind === 'targets') {
      const candidates = (p.candidates ?? []).filter(
        (candidate) => candidate.targetInstanceId === iid,
      )
      const cand = candidates.length === 1 ? candidates[0] : null
      if (cand) {
        return {
          selectable: true,
          selected: cand.selected,
          disabled:
            p.waiting === true ||
            binding?.kind !== 'targets' ||
            binding.view !== p ||
            !binding.controls,
          onClick:
            binding?.kind === 'targets' && binding.view === p && binding.controls
              ? () => void binding.controls!.choose(cand)
              : undefined,
        }
      }
    }
    if (p?.kind === 'attackers' && owner === 'self') {
      const attackers = (p.attackers ?? []).filter(
        (attacker) => attacker.attackerInstanceId === iid,
      )
      const attacker = attackers.length === 1 ? attackers[0] : null
      if (attacker) {
        return {
          selectable: true,
          selected: attacker.selected,
          disabled:
            p.waiting === true ||
            binding?.kind !== 'attackers' ||
            binding.view !== p ||
            !binding.controls,
          onClick:
            binding?.kind === 'attackers' && binding.view === p && binding.controls
              ? () => void binding.controls!.choose(attacker)
              : undefined,
        }
      }
      if (attackers.length > 1) {
        return {
          selectable: false,
          selected: attackers.some((candidate) => candidate.selected),
          disabled: p.waiting === true,
        }
      }
    }
    if (p?.kind === 'blockers') {
      if (owner === 'self') {
        const bl = (p.blockers ?? []).find((b) => b.blockerInstanceId === iid)
        if (bl) {
          return {
            selectable: true,
            selected: pendingId === iid || blockAssignments.some((x) => x.blocker === iid),
            disabled:
              p.waiting === true ||
              binding?.kind !== 'blockers' ||
              binding.view !== p ||
              !binding.controls,
            onClick:
              binding?.kind === 'blockers' && binding.view === p && binding.controls
                ? () => {
                    if (active()) {
                      setPendingBlocker((value) =>
                        value?.key === p.interactionKey && value.id === iid
                          ? null
                          : { key: p.interactionKey, id: iid },
                      )
                    }
                  }
                : undefined,
          }
        }
      } else if (owner === 'opp' && pendingId != null) {
        const bl = (p.blockers ?? []).find((b) => b.blockerInstanceId === pendingId)
        const atk = bl?.attackers.find((a) => a.attackerInstanceId === iid)
        if (bl && atk) {
          return {
            selectable: true,
            selected: false,
            disabled:
              p.waiting === true ||
              binding?.kind !== 'blockers' ||
              binding.view !== p ||
              !binding.controls,
            onClick:
              binding?.kind === 'blockers' && binding.view === p && binding.controls
                ? () => {
                    if (active()) {
                      setPendingBlocker(null)
                      void binding.controls!.choose(bl, iid)
                    }
                  }
                : undefined,
          }
        }
      }
    }
    if (owner === 'self') {
      return { selectable: false, selected: false, disabled: false }
    }
    return { selectable: false, selected: false, disabled: false, onClick: undefined }
  }

  const startHandDrag = useCallback(
    (card: CardView, action: LegalAction, event: PointerLike, interactive: boolean): boolean => {
      if (card.phasedOut || !interactive || gameOver || !onLegalAction) {
        return false
      }
      setDrag({
        card,
        action,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
      })
      return true
    },
    [gameOver, onLegalAction],
  )

  const moveDrag = useCallback((event: PointerEvent) => {
    setDrag((current) => {
      if (!current) {
        return current
      }
      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
      if (!current.started && distance < 8) {
        return current
      }
      event.preventDefault()
      return { ...current, x: event.clientX, y: event.clientY, started: true }
    })
  }, [])

  const endDrag = useCallback(
    (event: PointerEvent, dropZone: HTMLElement | null) => {
      if (!drag) {
        return
      }
      const action = droppedLegalAction(drag, event, dropZone?.getBoundingClientRect())
      setDrag(null)
      if (action) {
        onLegalAction?.(action)
      }
    },
    [drag, onLegalAction],
  )

  return {
    drag,
    declaredAttackers,
    blockAssignments,
    boardCardState,
    startHandDrag,
    moveDrag,
    endDrag,
  }
}

export function droppedLegalAction(
  drag: Pick<DragState, 'action' | 'started'>,
  pointer: PointerLike,
  rect?: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
): LegalAction | null {
  if (!drag.started || !rect) {
    return null
  }
  const overDrop =
    pointer.clientX >= rect.left &&
    pointer.clientX <= rect.right &&
    pointer.clientY >= rect.top - 40 &&
    pointer.clientY <= rect.bottom + 40
  return overDrop ? drag.action : null
}
