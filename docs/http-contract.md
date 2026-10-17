# Product HTTP contracts

Serializable Kotlin DTOs own JSON fields, names and types. Feature-local
`Route.contract` declarations own request types, query parameters and status/body
combinations. Ktor owns method/path discovery, path parameters, component
references and OpenAPI assembly. Change those declarations, then run:

```bash
bun run api:types
bun run api:check
```

`api:types` starts the actual registered routes in the Ktor test host with
optional product features enabled. It writes OpenAPI under `server/build`,
then derives `src/shared/api/types.ts` and `wire-schemas.ts`. Neither frontend
artifact is hand-edited. `api:check` regenerates without writing tracked files,
rejects stale artifacts, compiles the JSON schemas with Ajv, and validates actual
HTTP responses against OpenAPI and the generated Zod decoders. CI runs it in the
server lane after installing frontend dependencies.

## Authoring

Attach metadata to the registered route in its feature file:

```kotlin
post("/generate") {
    call.respond(HttpStatusCode.Accepted, pipeline.start(playerId))
}.contract {
    response<PuzzleRun>(202)
    text(409)
    empty(401, 403)
}
```

Use `request<T>()`, `response<T>(status)`, `query<T>(name, required)` and
`empty(statuses)` for existing JSON and empty outcomes. Use `text(status)` for
plain text. Path parameters are inferred by Ktor. Error handling supplies text
400/500 outcomes; route-local metadata adds typed errors such as capacity 503
or decklist 400. Multiple content types for one status are retained.
`HttpContractCheck` checks received request types, emitted statuses and Kotlin
body types before serialization. All registered HTTP methods must declare a contract or an
explicit `excludeContract(reason)`; document generation fails otherwise.

Frontend consumers use generated schemas before applying view transformations.
`readJson(response, schema)` reads an unknown body and rejects incompatible
fields. Existing authentication, credentials, status checks and feature error
messages stay with their owners. Generated `responseSchemas` associates JSON
bodies with each method/path/status; DTO schemas can also be reused directly.

## Presence and numbers

The HTTP JSON codec emits defaults and explicit nulls. Output schemas therefore
require every emitted field, including nullable fields. Input schemas require
fields without Kotlin defaults, even when nullable; defaulted input fields may
be absent. Input component names have an `Input` suffix so input optionality
cannot weaken output validation. `@SerialName` and enum names come from the
serializer descriptor. Collections and maps derive their element/value types.

Long fields retain their established JSON number representation and OpenAPI
`integer/int64`. Kotlin clients can use the full Long range. JavaScript clients
must use safe integers: generated validators reject values outside
±9,007,199,254,740,991 rather than treating rounded values as exact. Match-start
requests are validated before JSON encoding. Elapsed durations and seeds within
this range remain numbers. Double fields use OpenAPI `number` and numeric Zod
validation.

Unsupported descriptor kinds, unresolved schemas, recursive DTOs and unsupported
schema constraints fail explicitly. Custom serializers must describe their
actual wire shape and have serializer/route proof; add a tested explicit
mapping for an unsupported shape rather than a fallback to string. Defaults
and null emission are shared with the HTTP codec, so changes to that codec
require revisiting field-presence proof.

## Coverage and exclusions

Auth, client configuration, cards, decks, collection, courses, draft, sealed,
course play receipts/results, roadmap, saved puzzles and development
challenge text reads are covered. Optional features are
registered in the export fixture without enabling them in production.

Operator identity and replay diagnostics are explicitly hidden. Health,
the OpenAPI document itself and binary GRE replay uploads are
also excluded. Card-image redirects are covered as empty HTTP outcomes.
Generated frontend validation covers JSON bodies; empty/text responses remain
status/content-type declarations in OpenAPI.

Static browser-engine assets, downloaded replay bundles and bundled puzzle text
have separate owners. The unregistered legacy draft-advice request retains its
existing optional frontend model and fallback; it is not a product server wire
contract. Deck browser views and placeholder cards also remain frontend
presentation values, with their existing normalization/defaulting.

## Tooling choice

The native Ktor runtime route API works with the pinned Ktor 3.5.1 and Kotlin
2.4.0 versions. The compiler extension is not required. Its documented Kotlin
version constraint would add a compiler upgrade/downgrade dependency to this
migration. Native default schema inference also makes nullable fields optional,
which differs from this codec's required output fields. A small descriptor
adapter handles that distinction and unsupported kinds; route discovery and
OpenAPI assembly use Ktor. No independent endpoint inventory is retained.
