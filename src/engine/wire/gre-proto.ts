import protobuf from 'protobufjs'
import messagesDescriptor from '../generated/messages.json' with { type: 'json' }

const PACKAGE = 'wotc.mtgo.gre.external.messaging'

let root: protobuf.Root | null = null

export type ProtoObject = Record<string, unknown>

export async function greRoot(): Promise<protobuf.Root> {
  root ??= protobuf.Root.fromJSON(messagesDescriptor as protobuf.INamespace)
  return root
}

export function enumName(enumName: string, value: number): string | null {
  root ??= protobuf.Root.fromJSON(messagesDescriptor as protobuf.INamespace)
  return root.lookupEnum(`${PACKAGE}.${enumName}`).valuesById[value] ?? null
}

export async function decodeMessage(typeName: string, bytes: Uint8Array): Promise<ProtoObject> {
  const type = (await greRoot()).lookupType(`${PACKAGE}.${typeName}`)
  return type.toObject(type.decode(bytes), {
    defaults: false,
    enums: Number,
    longs: Number,
    bytes: Uint8Array,
  }) as ProtoObject
}

export async function encodeMessage(typeName: string, value: ProtoObject): Promise<Uint8Array> {
  const type = (await greRoot()).lookupType(`${PACKAGE}.${typeName}`)
  const err = type.verify(value)
  if (err) {
    throw new Error(`${typeName}: ${err}`)
  }
  return type.encode(type.create(value)).finish()
}

export async function enumValue(enumName: string, valueName: string): Promise<number> {
  return enumValueSync(enumName, valueName)
}

/** Descriptor-backed lookup for pure response construction; encoding remains asynchronous. */
export function enumValueSync(enumName: string, valueName: string): number {
  root ??= protobuf.Root.fromJSON(messagesDescriptor as protobuf.INamespace)
  const en = root.lookupEnum(`${PACKAGE}.${enumName}`)
  const value = en.values[valueName]
  if (value == null) {
    throw new Error(`Missing enum ${enumName}.${valueName}`)
  }
  return value
}

export async function buildMatchWrapper(
  typeName: string,
  payload: Uint8Array,
): Promise<Uint8Array> {
  const messageType = await enumValue('ClientToMatchServiceMessageType', typeName)
  return encodeMessage('ClientToMatchServiceMessage', {
    requestId: Date.now() % 1_000_000,
    timestamp: Date.now(),
    clientToMatchServiceMessageType: messageType,
    payload,
  })
}

export async function buildGreWrapper(value: ProtoObject): Promise<Uint8Array> {
  const payload = await encodeMessage('ClientToGREMessage', value)
  return buildMatchWrapper('ClientToGremessage', payload)
}
