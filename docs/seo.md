# Public HTML and indexing

`bun run build` produces route-specific HTML for the public pages (including the roadmap), login and
constructed and limited setup, plus `private.html`, `404.html`, `sitemap.xml` and
`seo-routes.conf`. `src/shared/seo.ts` owns metadata for both initial HTML and
client navigation. The introduction inside `#app` is readable without
JavaScript; React replaces it when the interactive interface mounts. The 404
document renders `NotFoundPage` itself at build time. Its scoped stylesheet
loads in the initial HTML so the public theme also works without JavaScript.

Public pages, including `/watch` and the three allowlisted `/watch/<id>` replay pages, use self-referencing canonical URLs. Unknown replay identifiers return HTTP 404. Account pages and unavailable
routes use `noindex`. Robots allows
crawling so search engines can read those directives. Authentication still
protects account data. The sitemap contains only public canonical pages;
`lastmod` is omitted until accurate content modification dates are available.

The eight singular `/challenge/<versioned-id>` links, `/challenge/random`, and
UUID `/challenge/<id>` links serve initial HTML with `noindex`. The public
Daily Puzzle navigation opens the current UTC day's bundled position; these
links stay out of the sitemap. Unknown non-UUID IDs return 404; a UUID not in
the pool shows a recovery state in the app. The older plural
`/challenges` launcher and detail URLs remain
development-only and return 404 in production.

## Serving the build

Use `deploy/nginx.conf` as the static edge's server configuration, with `dist/`
mounted at `/usr/share/nginx/html` and the product server at `backend:8080`.
The generated `seo-routes.conf` must be included inside the server block.
It serves public pages directly, preserves private SPA deep links, redirects
HTML/trailing-slash aliases, and returns HTTP 404 with `404.html` for unknown
URLs and parked routes. Do not add a blanket `/index.html` fallback.

If another host serves the static build, preserve that same routing contract.
Vite preview implements it for local checks; Vite preview is not a production
server. Existing production infrastructure must adopt these serving rules
when deploying this branch. Building HTML alone cannot fix an edge that still
rewrites every request to `/index.html`.

Verify the built HTML, HTTP routes and client metadata without starting or
restarting the game server:

```sh
bun run build
bun run seo:check
bun run preview --host 127.0.0.1 --port 4173 --strictPort
```

After deployment, check the initial HTML and HTTP status for `/`, `/about`,
one `/challenge/<versioned-id>` link, `/challenges`, `/login`, a private deep link and a missing
URL. Check `robots.txt` and `sitemap.xml`, then submit the sitemap in Search
Console. Staging hosts should require access or send a host-wide
`X-Robots-Tag: noindex`; the public sitemap and canonical URLs use
`https://forgeweb.app`.


## Social preview artwork

`public/og-image.png` was created with OpenAI image generation on October 16,
2026 for Forge Web. It uses the current charcoal and clay palette, the geometric
brand mark, and original abstract card backs. No external card artwork was used.
Its 1730 × 909 dimensions and description live in `src/shared/seo.ts`.
