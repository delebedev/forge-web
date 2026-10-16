# ADR-006: Family-owned prompt controls

Every supported interactive prompt has one family under `src/engine/runtime/prompts/`.
The family owns request interpretation, offered identities, local drafts,
constraints, serializable projection, instruction text, and response details.
`GreDispatch` owns the active interaction, request envelope, source generation,
waiting, rejection, retirement, and publication. All responses use the existing
GRE codec and frame source.

## Bindings and delivery

A binding belongs to the exact published view. Its typed controls stay outside
board snapshots. Controls revalidate the family, source, request revision, and
interaction key before changing a draft or submitting. Families recheck offered
identities, availability, and current constraints before delivery after encoding.
Replacement by the same kind invalidates retained controls even when object ids
repeat. Reset and source replacement invalidate pending encoding. A replacement
frame source may bind fresh controls to the retained draft and envelope.

Ordinary submission publishes waiting, then retires on successful delivery.
Failed delivery or rejection during encoding restores readiness for that same
interaction. Late work cannot unlock, publish over, or retire a successor.
An ordinary response already delivered has retired its prompt; a later rejection
cannot recreate its draft.

Cancellation waits for authoritative state. Bounded continuations wait for a
fresh request, confirmation, or state. Only a delivered response can retire on
its corresponding event. An echoed request preserves interaction identity only
when a delivered request wait has the same family continuation key and source.
It replaces the family and response envelope, invalidating old controls.
Families provide continuation keys and automatic response details; the shared
owner retains all waiting and transport authority.

Spectators and read-only sources receive views with null controls. Spectator
opening hands use an explicit automatic-keep policy in `GreDispatch`, through
the same request and delivery guards. Replay and static inspection receive no
executable controls. Card-backed decision rows retain keyboard focus for inspection
with no gameplay handler. Instrumented story bindings invoke fixture callbacks and
keep authored state unchanged; they do not import the live store.

## Composition and change scope

Wire request types have fixed composition in `GreDispatch`. `PromptDock` owns
heading focus, inspection forwarding, shared labels, and fixed family renderer
composition. Each renderer owns its body and footer and accepts its exact typed
view and controls. Rule instructions are projected by the family. Debug commands
resolve current candidates and use the same binding as board and dock input.
Passive `gameOver` and `unsupported` views are explicit variants and have no
family controls.

Adding a family changes its model and renderer, explicit view and control types,
fixed wire and renderer composition, and behavioral proof. Draft fields remain
inside the family. Shared lifetime changes require central expiry, rejection,
source, and publication proof. Family tests stay beside the model or renderer.
Neither reset, refresh, nor horizon needs a new per-family branch. Store and board
containers pass the binding directly.

We chose concrete typed bindings so operations and constraints remain visible
at the family seam. An opaque token registry would introduce a second command
vocabulary. Keeping a callback catalogue would spread every family operation
across the store, board, read-only adapter, and debug surface. Families sharing
one guarded lifetime avoid both forms of change amplification.

Ordinary priority, exact legal actions, drag geometry, authoritative game state,
and frame-source transports retain their separate owners. This preserves
[ADR-004's authority and presentation boundary](004-adopt-react-for-web-first-tabletop.md).
