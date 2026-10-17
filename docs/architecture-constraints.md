# Frontend Architecture Constraints

Store/component layering rules for the current GRE-based frontend. See
`docs/architecture.md` for the data-flow diagram and `docs/frontend-routes.md`
for the route/store map.

## Constraints

### C1. File Budget: 500 LOC
Same rule as backend. Split when approaching.

### C2. One Writer per Signal
Each store field has exactly one module that writes to it. Multiple readers OK.
If two modules need to write the same state, it belongs in the module they both depend on.

### C3. Pending → Confirm → Broadcast
Engine frames own authoritative game state. Prompt choices are local drafts
owned by their family under `runtime/prompts/`. `GreDispatch` owns identity,
correlation, source guards, waiting, rejection, retirement, and publication.
Ordinary submission retires on delivery. Cancellation and bounded continuations
wait under that same owner. [ADR-006](adr/006-family-owned-prompt-controls.md)
owns the binding and composition rules.

### C4. The Runtime Owns Transport
Components never launch games or transport frames directly. `GreFrameSource` adapters
own browser-worker and read-only replay delivery. Components submit through store methods
or interaction-bound prompt controls; encoding and delivery remain centralized.
Serializable board snapshots contain no executable controls. Controls must bind
to the displayed prompt and revalidate current interaction identity and offered
choices before acting. React submits exact `LegalAction` values rather than
reconstructing legality from card fields or identifiers. Draft/sealed use REST.

### C5. Derived State Stays Compact
A computed value needing >3 lines → extract to a named function or a
store-computed property, not an inline expression in a component body.
Components: ≤10 derived bindings (`useMemo`/plain computed reads) at the top.

### C6. Types Mirror the Wire Shape
GRE messages: `wire/gre-proto.ts` decodes/encodes against the generated protobuf
descriptor (`generated/messages.json`) — new GRE fields need the descriptor
regenerated, not hand-maintained types. REST/DTO types: `src/shared/api/types.ts`
and runtime validators in `wire-schemas.ts` are generated from registered Kotlin
HTTP contracts via `bun run api:types`; don't hand-edit them.
Run `bun run api:check` before publishing. [HTTP contract authoring](http-contract.md)
owns field presence, numbers, route coverage and intentional exclusions. Generate CSS-module declarations with `bun run css:types`; don't
hand-edit `*.module.css.d.ts` files.

### C7. No Inline Constants
Counter colors, phase names, timeouts, breakpoints → named constants.

### C8. Leaf Components: Props, Not Store Reads
Board leaves (`Card.tsx`, `StackPanel.tsx`, `ActionButton.tsx`, etc.)
receive data via props. Only containers (`GrePlay.tsx`, view-level
components) read stores through the `useSyncExternalStore` seam
(`engine/runtime/hooks.ts`, feature-local hook modules, and
`src/features/gre/priority-runtime.ts`). Keeps leaves testable without mocking
and out of the subscription graph.

### C9. Module Boundaries

Import across directories through `@app`, `@engine`, `@features`, `@shell`, and
`@shared`; use relative imports within one directory. Shared feature logic lives
in `shared/` or `engine/`.

### C10. Every Mutation Publishes

Every observable GRE mutation publishes through the external-store boundary.
Add a publication contract test when exposing a new mutation family.

### C11. Unsupported Prompts Stay Visible

New routes document their supported interaction envelope. Keep unsupported
prompt state visible until the route implements it.

## Established Patterns

- **One Store ↔ One Transport** — `greStore` owns the GRE WebSocket;
  `draftStore`/`sealedStore` are REST-only (product course routes), no transport
  to share.
- **Card ID as Identity** — selection sets are `number[]` of card/object IDs.
