# ADR-004: Adopt React for a Web-First Tabletop

## Status

Accepted

## Context

The client is becoming a rich tabletop application rather than a conventional
set of forms around a game view. It must work well in mobile browsers and on
desktop while supporting direct manipulation, responsive layouts, expressive
motion, and increasingly sophisticated game-state presentation.

The product is web-first. Browser standards, URLs, and normal static-web
deployment remain primary. A native container may become useful later, but it
must not become a second product architecture.

The tabletop has constraints that are easy to weaken accidentally:

- Interactive objects must remain available to assistive technology.
- Every essential action must work with pointer, touch, and keyboard input.
- Browser automation must interact through stable, user-meaningful controls.
- The server remains authoritative for game state and legal actions.
- Motion and effects must not become another source of game truth.
- The interface needs an original visual identity rather than borrowing the
  composition or presentation language of an existing commercial client.

ADR-003 correctly established semantic DOM rendering as the default and
rejected a canvas-first board. That conclusion still fits. The framework
choice is being revisited because interaction depth, accessibility, animation,
and expected product lifetime now put more weight on ecosystem breadth.

## Decision

Adopt **React with TypeScript** as the long-term application framework.

Continue to build the primary tabletop with semantic HTML and CSS. Use SVG for
vector presentation that benefits from DOM integration, such as relationships
between objects. Canvas or GPU-backed rendering may be added as a progressive
visual-effects layer, but it must not own essential interaction, accessibility,
or canonical state.

Use **Vite** for the client-rendered static application. Server rendering is
not an architectural requirement.

React will replace Svelte through coherent, independently working product
slices. Temporary coexistence is acceptable at route boundaries. Cross-
framework component trees and permanent dual-framework ownership are not.

## Recommended Supporting Stack

These are the defaults for the intended product, not immovable constraints.
Substitutions do not require a new ADR when they preserve the decision and
constraints.

- **React Aria Components** for accessible, unstyled interaction primitives.
- **Motion** for gesture feedback, layout transitions, card movement, and
  coordinated animation.
- **dnd-kit** for pointer, touch, and keyboard drag-and-drop semantics.
- **CSS Modules and custom properties** for product-owned styling and design
  tokens; **SVG** for targeting and relationship overlays.
- **TanStack Router and TanStack Query** for typed navigation and HTTP
  server-state coordination.
- A focused external client store, currently **Zustand** unless the working
  slice proves another model clearer, over pure game-state projections.
- **Vitest**, **Storybook**, and **Playwright** for logic, component states,
  responsive presentation, and semantic end-to-end interaction.
- **Capacitor** as the preferred native-container option if distribution or
  platform capabilities justify packaging the web client.

Canvas, WebGL, or WebGPU may support particles, shaders, and ambient effects
behind the semantic tabletop. They are not the primary interaction renderer.

## Decision Drivers

- **Accessible interaction.** Semantic controls, focus, keyboard operation,
  text scaling, reduced motion, and assistive technology remain first-class.
- **Rich direct manipulation.** The stack supports tactile movement, layered
  layouts, targeting relationships, coordinated transitions, and true drag
  and drop without adopting a full game engine.
- **Stable automation.** Cards, zones, prompts, targets, and actions expose
  stable identity independently of visual layout.
- **Long-lived product UI.** The client also needs navigation, content,
  dialogs, deck workflows, settings, and responsive application chrome.
- **Separated truth.** React, animation, and drag state are presentation;
  canonical state and legality remain authoritative elsewhere.

## Constraints

The implementation must preserve these constraints:

1. **Web first.** Desktop and mobile browsers are primary deployment targets.
2. **Semantic by default.** Essential interactive objects are represented by
   meaningful DOM controls.
3. **Input parity.** Pointer, touch, and keyboard users can complete every
   essential flow.
4. **Automation contract.** Browser tests use roles, names, and stable domain
   identity rather than styling or screen coordinates for core acceptance.
5. **Server authority.** Canonical state changes only in response to the
   authoritative game stream.
6. **Responsive composition.** Layout responds to available space, safe areas,
   text scaling, and orientation rather than assuming a fixed game viewport.
7. **Progressive effects.** Motion enhances comprehension and feel, respects
   reduced-motion preferences, and can be removed without changing gameplay.
8. **Original presentation.** Visual design is derived from this product's own
   goals and design system.
9. **Portable boundary.** Native packaging may add platform capabilities, but
   the application remains runnable as a normal website.
10. **Single destination.** Svelte is transitional once React owns a product
    area; the target is one application framework.

## Deliberately Undecided

This ADR does not freeze package versions, component hierarchy, filenames,
repository layout, migration order beyond coherent slice ownership, native
packaging timing, an effects renderer, or detailed animation design. Those
choices should follow working slices and measured constraints.

## Alternatives Considered

### Continue with Svelte

Svelte remains capable of producing the desired experience and has already
validated the DOM-first direction. Continuing would minimize transition cost.
It was not selected because the longer-term client gives greater weight to
accessible primitives, gesture and animation integrations, specialist
renderer interoperability, and broad maintenance tooling.

### Use a canvas-first or full game-engine client

This would provide a scene graph, frame loop, effects pipeline, and
coordinate-based interaction. Most of those responsibilities are not the
client's bottleneck. Canvas-first interaction would make responsive document
layout, accessibility, and semantic automation more expensive. A rendering
layer remains available for optional effects.

### Keep Svelte and React permanently

Permanent coexistence would duplicate application conventions and create
unclear ownership for state, navigation, styling, accessibility, and testing.
Coexistence is accepted only as a migration condition with route-level
boundaries.

### Build native clients first

Native-first development would weaken the browser as the canonical product and
multiply presentation work. A web container remains available later.

## Consequences

### Positive

- The primary interaction surface remains accessible and browser-testable.
- Rich motion and direct manipulation can evolve without a full game engine.
- The application retains ordinary web deployment and a credible native-
  container path.
- React's ecosystem covers conventional UI and specialist visual presentation.
- Route-level replacement keeps working behavior available during migration.

### Negative

- Existing Svelte presentation work must eventually be replaced.
- Two framework runtimes and conventions will coexist during migration.
- React does not provide game feel automatically.
- DOM rendering requires performance discipline around state subscriptions,
  layout, and animation.
- Accessibility still requires explicit semantics, focus, and testing.

### Risks and Responses

- **Migration stalls in permanent coexistence.** Give each migrated product
  area one framework owner and remove the prior implementation after parity.
- **Visual state diverges from authoritative state.** Keep animation and input
  state transient; reconcile canonical state only from the server stream.
- **High-frequency updates cause rendering churn.** Subscribe views to bounded
  projections and keep continuous animation outside canonical state updates.
- **Effects obscure semantic controls.** Treat effects as non-essential
  presentation and preserve the DOM interaction surface.
- **Framework choice drives generic design.** Maintain a product-owned design
  system and evaluate work against the original-presentation constraint.

## Relationship to Prior Decisions

This ADR supersedes ADR-003's selection of Svelte as the long-term component
framework. It retains ADR-003's DOM-first rendering decision and its reasoning
around responsive layout, accessibility, and avoiding unnecessary canvas
ownership.
