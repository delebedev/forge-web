import { GreDispatch, type GreDispatchHost } from '../gre-dispatch'
import type { CardMeta, GreTables, PromptView, ProtoObject } from '@engine/state/gre-state'
import type { PromptBinding } from './family'
import { buildGreWrapper, decodeMessage, enumValue } from '@engine/wire/gre-proto'

export function dispatchHost(overrides: Partial<GreDispatchHost> = {}): GreDispatchHost {
  return {
    sessionGeneration: () => 1,
    gameStateId: () => 1,
    cardMeta: () => new Map(),
    tables: () => ({ objects: new Map(), zones: new Map(), players: new Map() }),
    viewerSeatId: () => 1,
    isSpectatorMode: () => false,
    canRespond: () => true,
    sendGreResponse: async () => true,
    publish: () => {},
    log: () => {},
    ...overrides,
  }
}

/** Mechanical host observations; family fixtures and commands stay in each test. */
export function promptHarness(overrides: Partial<GreDispatchHost> = {}) {
  const sent: { type: string; payload: ProtoObject }[] = []
  const published: (PromptView | null)[] = []
  const tables: GreTables = {
    objects: new Map([
      [101, { instanceId: 101, grpId: 201 }],
      [102, { instanceId: 102, grpId: 202 }],
    ]),
    zones: new Map(),
    players: new Map(),
  }
  const cardMeta = new Map<number, CardMeta>()
  let source = 1
  let viewer = 1
  let writable = true
  const owner = new GreDispatch(
    dispatchHost({
      tables: () => tables,
      cardMeta: () => cardMeta,
      sessionGeneration: () => source,
      viewerSeatId: () => viewer,
      canRespond: () => writable,
      sendGreResponse: async (type, payload) => {
        sent.push({ type, payload })
        return true
      },
      publish: () => published.push(owner.prompt),
      ...overrides,
    }),
  )
  return {
    owner,
    sent,
    published,
    observed: published,
    tables,
    cardMeta,
    nextSource: () => source++,
    readOnly: () => {
      writable = false
    },
    setViewer: (id: number) => {
      viewer = id
    },
  }
}

/** Real descriptor lookup and codec, with the production delivery freshness guard. */
export function encodedPromptHarness(
  overrides: Partial<GreDispatchHost> = {},
  options: { deferDelivery?: true | string } = {},
) {
  type Delivery = { release: (accepted?: boolean) => void; result: Promise<boolean> }
  const deliveries: Delivery[] = []
  let notifyDelivery: ((delivery: Delivery) => void) | undefined
  const sent: Uint8Array[] = []
  const host = promptHarness({
    gameStateId: () => 99,
    sendGreResponse: async (name, payload, generation, current) => {
      let complete: ((result: boolean) => void) | undefined
      let accepted = true
      if (options.deferDelivery === true || options.deferDelivery === name) {
        let release!: (accepted?: boolean) => void
        const hold = new Promise<boolean>((resolve) => {
          release = (value = true) => resolve(value)
        })
        const result = new Promise<boolean>((resolve) => {
          complete = resolve
        })
        const delivery = { release, result }
        if (notifyDelivery) {
          notifyDelivery(delivery)
          notifyDelivery = undefined
        } else {
          deliveries.push(delivery)
        }
        accepted = await hold
      }
      try {
        const type = await enumValue('ClientMessageType', name)
        const bytes = await buildGreWrapper({ type, systemSeatId: 1, ...payload })
        const delivered = accepted && generation === hostGeneration && Boolean(current?.())
        if (delivered) {
          sent.push(bytes)
        }
        complete?.(delivered)
        return delivered
      } catch (error) {
        complete?.(false)
        throw error
      }
    },
    ...overrides,
  })
  let hostGeneration = 1
  const advance = host.nextSource
  host.cardMeta.set(201, { grpId: 201, name: 'Coral Merfolk' })
  host.cardMeta.set(202, { grpId: 202, name: 'Savannah Lions' })
  return {
    ...host,
    sent,
    waitForDelivery: () => {
      const delivery = deliveries.shift()
      return delivery
        ? Promise.resolve(delivery)
        : new Promise<Delivery>((resolve) => {
            notifyDelivery = resolve
          })
    },
    nextSource: () => {
      advance()
      hostGeneration++
    },
  }
}
export function bindingFor<K extends PromptBinding['kind']>(owner: GreDispatch, kind: K) {
  const bound = owner.bindPrompt(owner.prompt)
  if (bound?.kind !== kind || !bound.controls) {
    throw new Error(`Expected ${kind} controls`)
  }
  return bound as Extract<PromptBinding, { kind: K }> & {
    controls: NonNullable<Extract<PromptBinding, { kind: K }>['controls']>
  }
}
export async function decodeGre(bytes: unknown) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Expected encoded GRE bytes')
  }
  const wrapper = await decodeMessage('ClientToMatchServiceMessage', bytes)
  return decodeMessage('ClientToGREMessage', wrapper['payload'] as Uint8Array)
}

/** Assert the family before reading its serializable fields. */
export function viewFor<K extends PromptView['kind']>(
  owner: { prompt: PromptView | null },
  kind: K,
): Extract<PromptView, { kind: K }> {
  const view = owner.prompt
  if (view?.kind !== kind) {
    throw new Error(`Expected ${kind} view`)
  }
  return view as Extract<PromptView, { kind: K }>
}
