import type { MouseEventHandler, ReactNode } from 'react'

/** Shared geometry also renders without the router in the static 404 document. */
export function SiteHeader({
  children,
  onNavigate,
}: {
  children: ReactNode
  onNavigate?: MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <header className="site-header">
      <a className="site-brand" href="/" onClick={onNavigate} aria-label="Forge Web home">
        <svg viewBox="0 0 32 36" aria-hidden="true">
          <path d="M16 1 30 9v18l-14 8L2 27V9Zm0 7-8 5v10l8 5 8-5V13Z" fill="currentColor" />
          <path d="m12 13 9 0-5 7h5L11 29l4-11h-3Z" fill="currentColor" />
        </svg>
        <span>
          Forge <span className="site-brand-web">Web</span>
        </span>
      </a>
      {children}
    </header>
  )
}
