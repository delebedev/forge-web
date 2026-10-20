import { Fragment, useEffect, useRef, useState } from 'react'
import styles from './ArrowLayer.module.css'

// Each arrow connects two board elements located by data attribute:
//   from/to = a card instanceId, or the literal 'opponent' / 'self' life disc.
export type Arrow = {
  id: string
  kind: 'combat' | 'targetSpec'
  from: string
  to: string
}

type Segment = Arrow & { d: string; x: number; y: number }

export function ArrowLayer({ arrows = [] }: { arrows?: Arrow[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])

  function locate(root: Element, key: string): Element | null {
    if (key === 'opponent' || key === 'self') {
      return root.querySelector(`[data-target="${key}"] [data-life]`)
    }
    return (
      root.querySelector(`[data-card][data-instance-id="${key}"]`) ??
      root.querySelector(`[data-instance-id="${key}"]`)
    )
  }

  function recompute() {
    const svg = svgRef.current
    const board = svg?.parentElement
    if (!svg || !board) {
      return
    }
    const root = svg.getBoundingClientRect()
    const next: Segment[] = []
    for (const a of arrows) {
      const fromEl = locate(board, a.from)
      const toEl = locate(board, a.to)
      if (!fromEl || !toEl) {
        continue
      }
      const f = fromEl.getBoundingClientRect()
      const t = toEl.getBoundingClientRect()
      const stack = fromEl.closest('[data-zone="stack"]')?.getBoundingClientRect()
      const x1 = (stack ? stack.left - 12 : f.left + f.width / 2) - root.left
      const y1 = f.top + f.height / 2 - root.top
      const targetX = t.left + t.width / 2 - root.left
      const targetY = t.top + t.height / 2 - root.top
      const edge = Math.min(
        1,
        1 /
          Math.max(
            Math.abs(targetX - x1) / (t.width / 2 + 6),
            Math.abs(targetY - y1) / (t.height / 2 + 6),
          ),
      )
      const x2 = targetX - (targetX - x1) * edge
      const y2 = targetY - (targetY - y1) * edge
      // Bow the curve sideways so multiple arrows fan out a little.
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12
      const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.08
      next.push({ ...a, d: `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`, x: x2, y: y2 })
    }
    setSegments(next)
  }

  // The observer below outlives every render but must measure against the
  // current arrows. Without this indirection it keeps calling the closure from
  // mount, which still sees the arrow list as it was then — so a resize during
  // combat recomputes against an empty list and erases the arrows on screen.
  const recomputeRef = useRef(recompute)
  useEffect(() => {
    recomputeRef.current = recompute
  })

  useEffect(() => {
    const raf = requestAnimationFrame(() => recomputeRef.current())
    return () => cancelAnimationFrame(raf)
  }, [arrows])

  useEffect(() => {
    const run = (): void => recomputeRef.current()
    const board = svgRef.current?.parentElement
    const ro = new ResizeObserver(run)
    if (board) {
      ro.observe(board)
      board.addEventListener('scroll', run, true)
    }
    window.addEventListener('resize', run)
    const raf = requestAnimationFrame(run)
    return () => {
      ro.disconnect()
      board?.removeEventListener('scroll', run, true)
      window.removeEventListener('resize', run)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <svg ref={svgRef} className={styles.arrowLayer} aria-hidden="true">
      <defs>
        <marker
          id="gre-arrowhead"
          viewBox="0 0 10 10"
          refX={8}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
        </marker>
        <marker
          id="gre-target-spec-arrowhead"
          viewBox="0 0 10 10"
          refX={8}
          refY={5}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--target-spec-arrow)" />
        </marker>
      </defs>
      {segments.map((seg) => (
        <Fragment key={seg.id}>
          <path
            className={styles[seg.kind]}
            data-arrow-kind={seg.kind}
            d={seg.d}
            markerEnd={`url(#${seg.kind === 'targetSpec' ? 'gre-target-spec-arrowhead' : 'gre-arrowhead'})`}
          />
          <circle className={styles[`${seg.kind}Dot`]} cx={seg.x} cy={seg.y} r={3} />
        </Fragment>
      ))}
    </svg>
  )
}
