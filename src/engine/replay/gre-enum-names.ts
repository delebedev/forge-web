/**
 * Turns a JSON-shaped GRE message into the shape the store folds.
 *
 * The store reads enums as numbers — `gre-proto.ts` decodes with
 * `enums: Number` — but a JSON transcript spells them as names, and the two
 * spellings disagree in three ways:
 *
 * - the transcript prefixes a value with its enum's type name
 *   (`AnnotationType_PhaseOrStepModified` for `PhaseOrStepModified`);
 * - the descriptor suffixes some values with a four-hex disambiguator the
 *   transcript omits (`LossOfGame_af5a`, `DeclareBlockersReq_695e`);
 * - a few values differ only in case (`SelectNreq` for `SelectNReq`).
 *
 * So matching goes through an index of canonical spellings per enum. Where two
 * distinct values would claim the same canonical key, the key is dropped as
 * ambiguous — reporting a miss beats picking one of them.
 *
 * Misses are collected, never defaulted. protobufjs's own `fromObject` silently
 * yields 0 for an unknown enum name, and 0 is a legal value
 * (`AnnotationType.None_af5a`) — so a whole transcript can normalize
 * "successfully" with every annotation type reading as None, and nothing
 * downstream can tell.
 *
 * Fields absent from the descriptor pass through untouched instead of being
 * dropped: they are inert to the fold, and dropping them would quietly discard
 * information a reader might want later.
 */
import type protobuf from 'protobufjs'
import { greRoot, type ProtoObject } from '@engine/wire/gre-proto'

const PACKAGE = 'wotc.mtgo.gre.external.messaging'

/** An enum name that matched neither spelling. Never guess a number for it. */
export type EnumMiss = { path: string; enumName: string; value: string }

export type NormalizeResult = { message: ProtoObject; misses: EnumMiss[] }

export type GreNormalizer = {
  /** Normalize one `GREToClientMessage`-shaped value. */
  normalize(json: unknown): NormalizeResult
  /** Normalize as some other message type; used by tests and tooling. */
  normalizeAs(typeName: string, json: unknown): NormalizeResult
}

export async function greNormalizer(): Promise<GreNormalizer> {
  const root = await greRoot()
  root.resolveAll()
  const indexes = new Map<protobuf.Enum, Map<string, number>>()
  const normalizeAs = (typeName: string, json: unknown): NormalizeResult => {
    const misses: EnumMiss[] = []
    const type = root.lookupType(`${PACKAGE}.${typeName}`)
    const message = walkMessage(type, json, typeName, { misses, indexes })
    return { message: isRecordValue(message) ? message : {}, misses }
  }
  return {
    normalize: (json) => normalizeAs('GREToClientMessage', json),
    normalizeAs,
  }
}

type WalkContext = { misses: EnumMiss[]; indexes: Map<protobuf.Enum, Map<string, number>> }

/** Arena's collision suffix on duplicated value names, e.g. `LossOfGame_af5a`. */
const DISAMBIGUATOR = /_[0-9a-f]{4}$/

function withCaseFolded(forms: string[]): string[] {
  const unique = [...new Set(forms)]
  return [...unique, ...unique.map((form) => form.toLowerCase())]
}

/** Keys a descriptor value is registered under, most specific first. */
function indexKeys(name: string, enumName: string): string[] {
  const withoutPrefix = name.startsWith(`${enumName}_`) ? name.slice(enumName.length + 1) : name
  return withCaseFolded([
    name,
    withoutPrefix,
    name.replace(DISAMBIGUATOR, ''),
    withoutPrefix.replace(DISAMBIGUATOR, ''),
  ])
}

/**
 * Spellings to try for an incoming value, most specific first.
 *
 * The last resort drops any single leading `Word_` segment, because the prefix
 * a transcript uses is not always the full type name — `ConnectionStatus`
 * arrives as `Status_Success`. Scoped to the field's own enum and tried only
 * after every exact form has failed, so it disambiguates rather than guesses.
 */
function lookupKeys(value: string, enumName: string): string[] {
  const base = indexKeys(value, enumName)
  const firstSegment = value.indexOf('_')
  if (firstSegment <= 0) {
    return base
  }
  const tail = value.slice(firstSegment + 1)
  return [...base, ...withCaseFolded([tail, tail.replace(DISAMBIGUATOR, '')])]
}

function enumIndex(
  en: protobuf.Enum,
  indexes: Map<protobuf.Enum, Map<string, number>>,
): Map<string, number> {
  const cached = indexes.get(en)
  if (cached) {
    return cached
  }

  const index = new Map<string, number>()
  const ambiguous = new Set<string>()
  // Exact names first so a loose form can never displace one.
  for (const [name, value] of Object.entries(en.values)) {
    index.set(name, value)
  }
  for (const [name, value] of Object.entries(en.values)) {
    for (const key of indexKeys(name, en.name)) {
      if (index.has(key)) {
        if (index.get(key) !== value) {
          ambiguous.add(key)
        }
        continue
      }
      index.set(key, value)
    }
  }
  for (const key of ambiguous) {
    if (!(key in en.values)) {
      index.delete(key)
    }
  }

  indexes.set(en, index)
  return index
}

function walkMessage(
  type: protobuf.Type,
  json: unknown,
  path: string,
  context: WalkContext,
): unknown {
  if (!isRecordValue(json)) {
    return json
  }
  const out: ProtoObject = {}
  for (const [key, value] of Object.entries(json)) {
    const field = type.fields[key]
    if (!field) {
      out[key] = value
      continue
    }
    out[key] = walkField(field, value, `${path}.${key}`, context)
  }
  return out
}

function walkField(
  field: protobuf.Field,
  value: unknown,
  path: string,
  context: WalkContext,
): unknown {
  const resolved = field.resolvedType
  if (field.repeated && Array.isArray(value)) {
    return value.map((entry, index) => walkValue(resolved, entry, `${path}[${index}]`, context))
  }
  if (field.map && isRecordValue(value)) {
    const out: ProtoObject = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = walkValue(resolved, entry, `${path}.${key}`, context)
    }
    return out
  }
  return walkValue(resolved, value, path, context)
}

function walkValue(
  resolved: protobuf.Type | protobuf.Enum | null,
  value: unknown,
  path: string,
  context: WalkContext,
): unknown {
  if (resolved && isEnum(resolved)) {
    return enumNumber(resolved, value, path, context)
  }
  if (resolved && isMessageType(resolved)) {
    return walkMessage(resolved, value, path, context)
  }
  return value
}

function enumNumber(
  en: protobuf.Enum,
  value: unknown,
  path: string,
  context: WalkContext,
): unknown {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value !== 'string') {
    return value
  }
  const index = enumIndex(en, context.indexes)
  for (const key of lookupKeys(value, en.name)) {
    const found = index.get(key)
    if (found !== undefined) {
      return found
    }
  }
  context.misses.push({ path, enumName: en.name, value })
  return value
}

function isEnum(resolved: protobuf.Type | protobuf.Enum): resolved is protobuf.Enum {
  return 'values' in resolved && !('fields' in resolved)
}

function isMessageType(resolved: protobuf.Type | protobuf.Enum): resolved is protobuf.Type {
  return 'fields' in resolved
}

function isRecordValue(value: unknown): value is ProtoObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
