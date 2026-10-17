# ADR-007: Own complete saved decks in the library

The deck library owns account-scoped loading, current selection, and the
committed result of saving or deleting a deck. Editors receive complete deck
values containing card identities, quantities, available metadata, and all three
sections. They keep unsaved changes locally and return a draft to the library.
This deepens the existing store rather than adding another state framework.

Previously the selected deck omitted sideboard cards, which lived in a separate
store field. Detail projection discarded available card metadata, and the editor
expanded counted rows into repeated names before reconstructing their identities
for saving. Callers then coordinated invalidation, refetching, selection clearing,
and another detail projection. Those steps exposed storage ordering and made one
player action depend on several owners.

A selected saved deck now includes main, sideboard, and command-zone values.
Repeated identities are combined within each section before editing. Wire
payloads are derived directly from their identities and quantities. Card
metadata comes from the existing bounded public lookup, with account-local
caching of complete card values. List loading deduplicates identities across
decks and loads bounded batches serially. Known imported metadata remains
available through lookup failures, and late requests preserve newer fields. The shared import dialog still owns parsing, commander selection, and
validation. Both import entry points hand its resolved values to the same
library. The editor changes the main section and sideboard while preserving
commander cards. Moving a copy retains its identity and quantity. Saving checks
combined copy limits through Forge without requiring a complete deck.
Basic-land controls reuse an existing identity or resolve a new
one explicitly; saving waits for outstanding additions.

The store observes authentication changes synchronously. Changing account or
resetting clears list, selection, filters, cached metadata, and pending flags.
Every asynchronous read or mutation is correlated with that generation. Detail
requests also carry selection order, so an older completion cannot replace a
newer choice. Drafts retain their originating account and cannot be submitted
under another account. A successful save updates list and selection together,
unless the player has since selected another deck. Deleting a deck retires both
its displayed and pending selection. Mutations serialize, and the library
reconciles an incomplete initial list itself. Failed mutations retain committed
values and expose an error. Views additionally correlate navigation with their
own lifetime, so late completion does not pull the player back to a departed
route or close a newer editor.

Presentation metadata failure after persistence does not turn a successful
create into a retryable save failure. The saved identity and sections remain
available, with unavailable statistics identified explicitly. Counts and curves
are quantity-weighted, exclude sideboard, and treat command-zone cards as part
of the deck. Colors and mana value use available cost metadata when fuller values
are absent. They are presentation projections, not rules-engine color identity
or a complete treatment of special card layouts. Known imported colors and
collector numbers survive the in-page save/reopen flow; a fresh page can only
recover fields supplied by the server.

We rejected retaining the old projections and adding caller-side request guards:
that would protect some races while leaving section loss and mutation choreography.
We also rejected a generic entity cache or edit-session framework. One library
with explicit account and selection correlation covers the current callers.
Other deck-detail consumers retain the existing presentation shape, extended with
optional sideboard and metadata availability. Limited deck building, server
contracts, gameplay, and durable selection storage remain outside this decision.
