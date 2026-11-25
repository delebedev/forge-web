# Product HTTP contracts

`src/shared/api/wire-schemas.ts` is the single product HTTP contract. It holds
hand-authored Zod schemas for request and response bodies and exports their
TypeScript types with `z.infer`. Change a schema and the server route that
emits it in the same change; the parity suite rejects a server that disagrees.

`responseSchemas` maps each `METHOD /path` and status to its JSON body schema.
Empty and text responses have no entry. DTO schemas can also be used directly.

Frontend consumers decode with these schemas before applying view
transformations. `readJson(response, schema)` reads an unknown body and rejects
incompatible fields. Existing authentication, credentials, status checks and
feature error messages stay with their owners.

## Presence and numbers

The server emits defaults and explicit nulls. Response schemas therefore
require every emitted field, including nullable fields. Request schemas have an
`Input` suffix and mark fields the server defaults as optional, so input
optionality cannot weaken response validation.

Integer fields use the 32-bit range. JavaScript clients must use safe integers;
a value outside ±9,007,199,254,740,991 is rejected rather than rounded.

## Parity suite

`bun run server:parity` starts a product server by shell command and checks every
live route over HTTP only: status codes, headers, the session cookie, text and
JSON error bodies, and JSON bodies decoded through `responseSchemas`. Each test
file starts its own server on a fresh temporary state directory.

The default target is the server source, `bun server/main.ts`.
`FORGE_WEB_SERVER_DIST` runs a tested distribution through
`scripts/run-ci-server.sh`, as the CI server job does.
`FORGE_WEB_PARITY_SERVER_CMD` selects any other command. `startServer` in
`e2e/server-parity/server.ts` can stop and restart a server on the same state
directory.

The suite leaves out the whole-artifact replay upload and
`/api/puzzles/runs/{runId}`, which have no browser caller.

Static browser-engine assets, downloaded replay bundles and bundled puzzle text
have separate owners. Deck browser views and placeholder cards remain frontend
presentation values with their existing normalization and defaults.
