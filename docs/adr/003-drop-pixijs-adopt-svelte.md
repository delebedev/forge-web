# ADR-003: Drop PixiJS, Adopt Svelte for DOM Rendering

## Status
Accepted

## Context

ADR-001 chose PixiJS for "game board rendering (sprites, layers, hit testing)." After building the initial board renderer (`renderer.ts`, ~200 LOC), the actual PixiJS usage is:

- `Graphics.roundRect()` — CSS `border-radius`
- `Sprite` from Scryfall URL — `<img src="...">`
- `Text` — `<span>`
- `container.on('pointertap')` — DOM `click`
- Manual layout math — CSS Grid/Flexbox

Zero PixiJS-specific features used. No sprite batching, no shaders, no particle effects, no physics.

Meanwhile, the decision to follow Forge Swing's panel layout (ADR discussion, 2026-02-05) means the UI is:
- Card zones (hand, battlefield) — repeated card elements
- Side panels (stack, combat log, card inspector) — tabbed DOM panels
- Phase/priority bar — status indicators
- Action prompts — contextual buttons/menus

This is standard reactive DOM work, not canvas rendering.

### Problems with Current PixiJS Approach

1. **Dual rendering** — DOM for chrome (header, panels), Canvas for board. Two systems to maintain.
2. **Custom texture pipeline** — `scryfall.ts` (65 LOC) wraps `new Image()` → `Texture.from()`. An `<img>` tag does this natively.
3. **Manual layout** — Centering, spacing, zone positioning all computed in JS. CSS does this declaratively.
4. **No accessibility** — Canvas content invisible to screen readers.
5. **No CSS transitions** — Hover, tap, selection states require imperative PixiJS code instead of CSS classes.
6. **Bundle weight** — pixi.js adds ~300KB to the bundle for features we don't use.

### Why a Component Framework

Vanilla TS works for the current 5-file prototype. But the Forge Swing layout requires:
- Repeated card components with multiple states (tapped, selected, targeted, highlighted)
- Tabbed panels with dynamic content (stack items, log entries)
- Reactive updates from WebSocket state pushes
- Conditional rendering (prompt types, combat vs non-combat)

Without reactivity, we'd reinvent state→DOM synchronization within weeks.

## Decision

**Drop PixiJS. Adopt Svelte 5 with Vite.**

### Why Svelte

| Criteria | Svelte | Preact | Lit |
|----------|--------|--------|-----|
| Runtime size | ~0KB (compiles away) | ~3KB | ~5KB |
| Reactivity | Built-in (`$state`, `$derived`) | `useState` hooks | `@property` decorators |
| Transitions | Built-in (`transition:fade`) | Need library | Need library |
| CSS scoping | Built-in (`<style>`) | CSS modules / external | Shadow DOM |
| Learning curve | Low | Medium (React patterns) | Medium (web components) |
| Vite support | `@sveltejs/vite-plugin-svelte` | Built-in | Built-in |

Svelte's advantages for a card game UI:
- **`{#each cards as card}`** — declarative card zone rendering
- **`class:tapped`** — conditional CSS classes without string manipulation
- **`transition:fly`** — card movement animations with zero library code
- **`$state`** rune — WebSocket state updates trigger surgical DOM patches
- **Scoped `<style>`** — component styles don't leak, design system via CSS custom properties

### What We Keep

- **Space Grotesk** font, dark theme, glass panels, amber/green accents — CSS custom properties carry over unchanged
- **`socket.ts`** — WebSocket logic is framework-agnostic, minor adaptation to Svelte stores
- **`types.ts`** — Zod schemas unchanged
- **Vite** — same bundler, add Svelte plugin
- **Design language** — `style.css` variables become global CSS, component styles use them

### What We Delete

- `pixi.js` dependency
- `renderer.ts` (PixiJS board renderer)
- `scryfall.ts` (PixiJS texture pipeline)
- Canvas element from layout

## Consequences

### Positive
- One rendering approach (DOM everywhere)
- Card images are `<img>` tags — browser handles loading, caching, lazy loading
- CSS Grid for board layout — responsive, declarative, debuggable
- CSS transitions for all interactions — hover, tap, select, animate
- Accessible by default
- Smaller bundle (remove ~300KB pixi.js, add ~0KB Svelte runtime)
- Faster development — Svelte components map 1:1 to Forge UI panels

### Negative
- Rewrite of renderer (small — current is ~200 LOC)
- Team needs Svelte knowledge (low bar — simpler than React)
- If we ever want heavy canvas effects (particle FX, 3D), would need to add a canvas layer back

### Risks
- Performance with many cards: DOM should handle 50-100 cards fine. MTG rarely exceeds this. If it does, virtualization or canvas overlay for battlefield only.

## References

- ADR-001 noted: "Can swap PixiJS for something else (it's just rendering)"
- Forge Swing layout: `docs/web-port/research/ui-overview.md`
- Former renderer: `src/renderer.ts` (~200 LOC before Svelte replacement)
