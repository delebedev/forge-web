# Browser scenario boundary

Add a Playwright case when the browser must prove the claim: a player uses a control or route, and the product reaches a visible or persisted result. Name the specific browser regression the case would catch that existing cases would miss.

For gameplay action completion, read the module headers in [gre-actions.ts](gre-actions.ts), [gre-action-completion.ts](gre-action-completion.ts) and [action-completion.ts](action-completion.ts) before authoring or changing resolution waits.

## In scope

- Player journeys crossing UI, product API, or GRE boundaries: import and save, sign-in and navigation, gameplay action and board update, reconnect and recovery.
- Browser-owned behavior: pointer input, focus, accessibility, responsive layout, client storage, and error placement.
- Distinct branches of a journey with different player actions or outcomes. Assert the action and result; for rejection, assert that the flow does not advance.

## Outside the suite

- More card names, validation messages, or API failures that take an already-covered browser path to the same visible result. Keep one representative browser case for that path.
- The same action and assertion repeated in a feature spec and `product-smoke.spec.ts`. Check suite membership in `playwright.config.ts`; those specs may run together.
- A full match when the claim ends at import, save, or setup. A single browser probe or screenshot used to inspect a change does not itself require a permanent spec.

Put a single-feature journey in its feature spec, a cross-feature journey in `product-smoke.spec.ts`, and game behavior in the matching GRE or Browser Local suite. Follow [browser selector guidance](../docs/e2e-selectors.md). A new case is complete when it fails for the named browser regression and passes through the player-facing path it claims to protect.
