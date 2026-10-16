import { SiteHeader } from '../../shared/SiteHeader'

/** Shared by the React route and the build's HTTP 404 document. */
export function NotFoundPage() {
  return (
    <div className="public-theme public-not-found">
      <SiteHeader>
        <nav className="site-header-links" aria-label="Main navigation">
          <a href="/about">About Forge Web</a>
        </nav>
      </SiteHeader>
      <main className="public-not-found-content">
        <h1>This page doesn’t exist.</h1>
        <p>The link may be out of date. Return to the live table to watch a game or take a seat.</p>
        <a className="public-primary" href="/">
          Back to table
        </a>
        <p className="public-not-found-code">Error 404</p>
      </main>
    </div>
  )
}
