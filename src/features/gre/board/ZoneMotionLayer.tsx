import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { presentationZoneDuration, type PresentationMove } from '@engine/state/presentation-policy'
import { Card } from './Card'
import styles from './variants/classic/Board.module.css'

/**
 * Visual-only bridge for spatial presentation moves.
 *
 * GreStore keeps server state and prompts authoritative. This layer only turns
 * the presentation cursor's source and destination into a measured card tween.
 * Keep gameplay inference in presentation-policy.ts, never in DOM comparison.
 */
type MotionPath = PresentationMove & {
  left: number
  top: number
  width: number
  height: number
  dx: number
  dy: number
}

export function ZoneMotionLayer({
  rootRef,
  moves,
  viewerSeatId,
}: {
  rootRef: RefObject<HTMLElement | null>
  moves: PresentationMove[]
  viewerSeatId: number
}) {
  const moveKey = moves
    .map(
      (move) =>
        `${move.key}:${move.card?.grpId ?? 0}:${move.card?.name ?? ''}:${move.hidden}:${move.fromOwnerSeatId}:${move.toOwnerSeatId}`,
    )
    .join('|')
  const movesRef = useRef(moves)
  movesRef.current = moves
  const previousGeometry = useRef(new Map<string, DOMRect>())
  const restingGeometry = useRef(new WeakMap<HTMLElement, DOMRect>())
  const [paths, setPaths] = useState<MotionPath[]>([])

  useLayoutEffect(() => {
    const root = rootRef.current
    const currentMoves = movesRef.current
    if (!root) {
      setPaths([])
      return
    }

    const originGeometry = previousGeometry.current
    const animated = new Set<string>()
    const measure = () => {
      const boardRect = root.getBoundingClientRect()
      const next = currentMoves.flatMap((move) => {
        const source = zoneAnchor(
          root,
          move.from,
          ownerKey(move.from, move.fromOwnerSeatId, viewerSeatId),
        )
        const targetCard = visibleCard(root, move.instanceId)
        const target =
          targetCard ??
          zoneAnchor(root, move.to, ownerKey(move.to, move.toOwnerSeatId, viewerSeatId))
        const sourceRect =
          originGeometry.get(`card:${move.instanceId}`) ??
          source?.getBoundingClientRect() ??
          originGeometry.get(
            `zone:${move.from}:${ownerKey(move.from, move.fromOwnerSeatId, viewerSeatId)}`,
          )
        const targetRect = target?.getBoundingClientRect()
        if (!sourceRect || !targetRect) {
          return []
        }
        if (move.from === 'battlefield' && move.to === 'battlefield' && targetCard) {
          if (!animated.has(move.key) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            restingGeometry.current.set(targetCard, targetRect)
            const animation = targetCard.animate(
              [
                {
                  translate: `${sourceRect.left - targetRect.left}px ${sourceRect.top - targetRect.top}px`,
                },
                { translate: '0px 0px' },
              ],
              {
                duration: presentationZoneDuration(move.category),
                easing: 'cubic-bezier(.16,1,.3,1)',
              },
            )
            const forgetRestingGeometry = () => {
              if (restingGeometry.current.get(targetCard) === targetRect) {
                restingGeometry.current.delete(targetCard)
              }
            }
            void animation.finished.then(forgetRestingGeometry, forgetRestingGeometry)
          }
          animated.add(move.key)
          return []
        }
        const width = clamp(targetCard?.getBoundingClientRect().width ?? 82, 54, 148)
        const height = (width * 88) / 63
        const startX = sourceRect.left + sourceRect.width / 2 - boardRect.left - width / 2
        const startY = sourceRect.top + sourceRect.height / 2 - boardRect.top - height / 2
        const targetX = targetRect.left + targetRect.width / 2 - boardRect.left - width / 2
        const targetY = targetRect.top + targetRect.height / 2 - boardRect.top - height / 2
        return [
          {
            ...move,
            left: startX,
            top: startY,
            width,
            height,
            dx: targetX - startX,
            dy: targetY - startY,
          },
        ]
      })
      setPaths(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [moveKey, rootRef, viewerSeatId])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }
    const geometry = new Map<string, DOMRect>()
    for (const element of root.querySelectorAll<HTMLElement>(
      '[data-zone], [data-card][data-instance-id]',
    )) {
      if (element.closest('[aria-hidden="true"]') || !element.getClientRects().length) {
        continue
      }
      if (element.dataset['zone']) {
        geometry.set(
          `zone:${element.dataset['zone']}:${element.dataset['owner']}`,
          element.getBoundingClientRect(),
        )
      } else if (
        element.dataset['instanceId'] &&
        !geometry.has(`card:${element.dataset['instanceId']}`)
      ) {
        geometry.set(
          `card:${element.dataset['instanceId']}`,
          restingGeometry.current.get(element) ?? element.getBoundingClientRect(),
        )
      }
    }
    previousGeometry.current = geometry
  })

  if (paths.length === 0) {
    return null
  }
  return (
    <div className={styles.motionLayer} aria-hidden="true">
      {paths.map((path) => {
        const style = {
          '--motion-left': `${path.left}px`,
          '--motion-top': `${path.top}px`,
          '--motion-width': `${path.width}px`,
          '--motion-height': `${path.height}px`,
          '--motion-dx': `${path.dx}px`,
          '--motion-dy': `${path.dy}px`,
          '--motion-duration': `${presentationZoneDuration(path.category)}ms`,
        } as CSSProperties
        return (
          <div
            key={path.key}
            className={styles.motionSprite}
            style={style}
            data-motion-from={path.from}
            data-motion-to={path.to}
          >
            {path.hidden || !path.card ? (
              <div className={styles.motionBack} />
            ) : (
              <Card card={path.card} variant="hand" index={0} count={1} actionChrome={false} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function ownerKey(
  zone: PresentationMove['from'],
  ownerSeatId: number,
  viewerSeatId: number,
): 'self' | 'opponent' | 'shared' {
  if (zone === 'stack') {
    return 'shared'
  }
  return ownerSeatId === viewerSeatId ? 'self' : 'opponent'
}

function zoneAnchor(
  root: HTMLElement,
  zone: PresentationMove['from'],
  owner: 'self' | 'opponent' | 'shared',
): HTMLElement | null {
  const exact = visibleZoneAnchors(root, `[data-zone="${zone}"][data-owner="${owner}"]`)[0]
  if (exact) {
    return exact
  }
  return visibleZoneAnchors(root, `[data-zone="${zone}"]`)[0] ?? null
}

function visibleZoneAnchors(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector)).filter(
    (element) => !element.closest('[aria-hidden="true"]'),
  ) as HTMLElement[]
}

function visibleCard(root: HTMLElement, instanceId: number): HTMLElement | null {
  return (
    (Array.from(root.querySelectorAll(`[data-card][data-instance-id="${instanceId}"]`)).find(
      (element) => !element.closest('[aria-hidden="true"]') && element.getClientRects().length > 0,
    ) as HTMLElement | undefined) ?? null
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
