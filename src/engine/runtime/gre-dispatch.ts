import { mulliganPrompt, mulliganResponse } from './prompts/mulligan'
import { damagePrompt } from './prompts/damage'
import { attackersPrompt } from './prompts/attackers'
import { blockersPrompt } from './prompts/blockers'
import { paymentPrompt } from './prompts/payment'
import { targetingPrompt } from './prompts/targeting'
import { selectionPrompt } from './prompts/selection'
import { castingPrompt } from './prompts/casting'
import { replacementPrompt } from './prompts/replacement'
import { optionalActionPrompt } from './prompts/optional-action'
import { numericPrompt } from './prompts/numeric'
import { searchPrompt } from './prompts/search'
import { groupPrompt } from './prompts/group'
import { orderPrompt } from './prompts/order'
import { distributionPrompt } from './prompts/distribution'
import type {
  PromptFamily,
  FamilyRequest,
  PromptBinding,
  PromptContext,
  FamilyScope,
  PromptResponse,
} from './prompts/family'
import {
  asNumber,
  isRecord,
  type CardMeta,
  type PromptView,
  type GreTables,
  type ProtoObject,
} from '@engine/state/gre-state'
export interface GreDispatchHost {
  sessionGeneration(): number
  gameStateId(): number
  cardMeta(): Map<number, CardMeta>
  tables(): GreTables
  viewerSeatId(): number
  isSpectatorMode(): boolean
  canRespond(): boolean
  sendGreResponse(
    typeName: string,
    payload: ProtoObject,
    generation: number,
    isCurrent?: () => boolean,
  ): Promise<boolean>
  publish(): void
  log(message: string): void
}

export type GreDecisionHorizon = {
  kind: string
  promptKey: string
  gameStateId: number
  respId: number
}

/** Owns active GRE prompt lifetime, response correlation, waiting, and publication.
 * Families own request-specific behavior. */
export class GreDispatch {
  private currentPrompt: PromptView | null = null
  private family: {
    model: PromptFamily
    source: number
    cancelling: boolean
    continuing: 'request' | 'confirmation' | 'state' | null
    interactionKey: number
    msgId: number
    gameStateId: number
  } | null = null

  get prompt(): PromptView | null {
    return this.currentPrompt
  }
  set prompt(value: PromptView | null) {
    if (
      this.family &&
      (!value ||
        value.kind !== this.family.model.kind ||
        value.interactionKey !== this.family.interactionKey)
    ) {
      this.family = null
    }
    this.currentPrompt = value
  }

  private requestGeneration = 0
  private interactionGeneration = 0
  private respondingInteraction: { interactionKey: number; delivered: boolean } | null = null

  private host: GreDispatchHost

  constructor(host: GreDispatchHost) {
    this.host = host
  }

  /** Fixed wire composition; each family owns its request-specific interpretation. */
  applyFamilyRequest(message: ProtoObject): void {
    const type = asNumber(message['type'])
    let model: FamilyRequest
    switch (type) {
      case 15:
        model = mulliganPrompt(message)
        break
      case 30:
        model = damagePrompt(message)
        break
      case 26:
        model = attackersPrompt(message)
        break
      case 28:
        model = blockersPrompt(message)
        break
      case 34:
        model = targetingPrompt(message)
        break
      case 22:
        model = selectionPrompt(message)
        break
      case 36:
        model = selectionPrompt(message) ?? paymentPrompt(message)
        break
      case 46:
        model = castingPrompt(message)
        break
      case 43:
        model = numericPrompt(message)
        break
      case 11:
        model = groupPrompt(message)
        break
      case 17:
        model = orderPrompt(message)
        break
      case 42:
        model = distributionPrompt(message)
        break
      case 39:
        model = replacementPrompt(message)
        break
      case 45:
        model = optionalActionPrompt(message)
        break
      case 44:
      case 49:
        model = searchPrompt(message)
        break
      default:
        this.host.log(`Unsupported family request type=${type}`)
        return
    }
    if (!model) {
      if (type === 43 && isRecord(message['numericInputReq'])) {
        this.host.log(
          `NumericInputReq unsupported type=${asNumber(message['numericInputReq']['numericInputType'])}`,
        )
      }
      return
    }
    const previous = this.family
    const echoed =
      previous?.continuing === 'request' &&
      this.respondingInteraction?.delivered === true &&
      previous.source === this.host.sessionGeneration() &&
      previous.model.kind === model.kind &&
      previous.model.continuation?.key === model.continuation?.key
    this.requestGeneration += 1
    this.respondingInteraction = null
    const interactionKey = this.beginPromptInteraction(echoed)
    if (model.kind === 'unsupported') {
      this.prompt = {
        interactionKey,
        kind: 'unsupported',
        message: model.message,
      }
      this.host.log(model.diagnostic)
      return
    }
    const msgId = asNumber(message['msgId'])
    this.family = {
      model,
      source: this.host.sessionGeneration(),
      cancelling: false,
      continuing: null,
      interactionKey,
      msgId,
      gameStateId: asNumber(message['gameStateId']) || this.host.gameStateId(),
    }
    this.refreshFamily()
    const next = this.family
    // Spectator matches keep opening hands automatically through the same lifetime guard.
    if (model.kind === 'mulligan' && this.host.isSpectatorMode()) {
      void this.submitFamily(next, () => mulliganResponse('AcceptHand'), true).catch(
        (error: unknown) => this.host.log(`Automatic keep failed: ${String(error)}`),
      )
    }
    if (echoed && next.model.continuation?.automaticResponse(this.familyContext())) {
      void this.continueFamily(
        next,
        () => next.model.continuation!.automaticResponse(this.familyContext()),
        'confirmation',
      ).catch((error: unknown) => this.host.log(`Prompt continuation failed: ${String(error)}`))
    }
  }

  private familyContext(): PromptContext {
    return {
      waiting:
        this.respondingInteraction?.interactionKey === this.family?.interactionKey &&
        this.family != null,
      waitingFor: this.family?.cancelling ? 'cancellation' : (this.family?.continuing ?? null),
      tables: this.host.tables(),
      cardMeta: this.host.cardMeta(),
      viewerSeatId: this.host.viewerSeatId(),
    }
  }

  private refreshFamily(): void {
    const family = this.family
    if (!family) {
      return
    }
    const view = family.model.project(this.familyContext(), family.interactionKey)
    this.prompt =
      this.respondingInteraction?.interactionKey === family.interactionKey
        ? {
            ...view,
            waiting: true,
            canSubmit: false,
          }
        : { ...view, waiting: false }
  }

  /** Bind the exact published value; a hidden or superseded view gets no controls. */
  bindPrompt(view: PromptView | null): PromptBinding | null {
    const family = this.family
    if (!family || !view || view !== this.prompt) {
      return null
    }
    const source = this.host.sessionGeneration()
    const request = this.requestGeneration
    const current = () =>
      this.family === family &&
      family.source === source &&
      this.host.sessionGeneration() === source &&
      this.isCurrentPrompt(family.model.kind, request, family.interactionKey)
    const editable = () =>
      current() && this.host.canRespond() && !this.host.isSpectatorMode() && !this.prompt?.waiting
    const scope: FamilyScope = {
      continue: (response, until) =>
        editable() ? this.continueFamily(family, response, until) : Promise.resolve(false),
      context: () => this.familyContext(),
      edit: (change) => {
        if (!editable() || !change()) {
          return false
        }
        this.refreshFamily()
        this.host.publish()
        return true
      },
      cancel: async (allowed) => {
        if (!editable() || !allowed()) {
          return false
        }
        family.cancelling = true
        const response = this.beginPromptResponse(
          family.model.kind,
          () => family.cancelling && allowed(),
          true,
        )
        if (!response) {
          family.cancelling = false
          return false
        }
        return response.send('CancelActionReq_097b', {})
      },
      submit: (createResponse) =>
        editable() ? this.submitFamily(family, createResponse) : Promise.resolve(false),
    }
    return family.model.bind(
      view,
      this.host.canRespond() && !this.host.isSpectatorMode() ? scope : null,
    )
  }

  /** Exact identity of the pending visible prompt, without exposing its response payload. */
  get decisionHorizon(): GreDecisionHorizon | null {
    const kind = this.prompt?.kind
    if (!kind) {
      return null
    }
    if (this.family) {
      const { gameStateId, msgId } = this.family
      return gameStateId > 0 && msgId > 0
        ? { kind, promptKey: `${gameStateId}:${msgId}`, gameStateId, respId: msgId }
        : null
    }
    return null
  }

  /** A replacement frame source preserves the visible draft with fresh controls. */
  attachSource(): void {
    this.requestGeneration += 1
    const delivered = this.respondingInteraction?.delivered === true
    if (!delivered) {
      this.respondingInteraction = null
    }
    if (this.family) {
      this.family = {
        ...this.family,
        source: this.host.sessionGeneration(),
        cancelling: delivered && this.family.cancelling,
        continuing: delivered ? this.family.continuing : null,
      }
      this.refreshFamily()
    }
  }

  beginPromptInteraction(continuation = false): number {
    this.family = null
    if (!continuation) {
      this.interactionGeneration += 1
    }
    return this.interactionGeneration
  }

  private isCurrentPrompt(
    kind: PromptView['kind'],
    requestGeneration: number,
    interactionGeneration: number,
  ): boolean {
    return (
      this.requestGeneration === requestGeneration &&
      this.interactionGeneration === interactionGeneration &&
      this.prompt?.kind === kind &&
      this.prompt.interactionKey === interactionGeneration
    )
  }

  private beginPromptResponse(
    kind: PromptView['kind'],
    allowed: () => boolean = () => true,
    waitForState = false,
    automaticKeep = false,
  ): {
    send(typeName: string, payload: ProtoObject): Promise<boolean>
  } | null {
    const prompt = this.prompt
    const gameStateId = this.family?.gameStateId
    if (
      !prompt ||
      prompt.kind !== kind ||
      gameStateId == null ||
      prompt.waiting ||
      this.respondingInteraction?.interactionKey === this.interactionGeneration
    ) {
      return null
    }
    const requestGeneration = this.requestGeneration
    const interactionGeneration = this.interactionGeneration
    const sessionGeneration = this.host.sessionGeneration()
    const isCurrent = () =>
      this.host.sessionGeneration() === sessionGeneration &&
      this.isCurrentPrompt(kind, requestGeneration, interactionGeneration)
    const attempt = { interactionKey: interactionGeneration, delivered: false }
    const active = () => isCurrent() && this.respondingInteraction === attempt
    const release = () => {
      if (this.respondingInteraction !== attempt) {
        return
      }
      this.respondingInteraction = null
      if (!isCurrent()) {
        return
      }
      if (this.family) {
        this.family.cancelling = false
        this.family.continuing = null
        this.refreshFamily()
      }
      this.host.publish()
    }
    this.respondingInteraction = attempt
    if (this.family) {
      this.refreshFamily()
    }
    this.host.publish()
    return {
      send: async (typeName, payload) => {
        try {
          const sent = await this.host.sendGreResponse(
            typeName,
            { ...payload, gameStateId },
            sessionGeneration,
            () =>
              active() &&
              this.host.canRespond() &&
              (automaticKeep || !this.host.isSpectatorMode()) &&
              allowed(),
          )
          if (sent && active() && allowed()) {
            if (waitForState) {
              attempt.delivered = true
              return true
            }
            this.respondingInteraction = null
            return true
          }
          release()
          return false
        } catch (error) {
          release()
          throw error
        }
      },
    }
  }

  /** State retires only the delivered response still waiting on this family. */
  retireFamilyStateWait(): void {
    if (this.family?.continuing !== 'state' || !this.respondingInteraction?.delivered) {
      return
    }
    this.respondingInteraction = null
    this.prompt = null
  }

  /** Reset every pending-request + staged-selection field. Single source of truth
   *  for teardown so the reset paths (new game, game over) can't drift apart. */
  reset(): void {
    this.requestGeneration += 1
    this.respondingInteraction = null
    this.prompt = null
  }

  /** Re-derive whichever prompt is currently pending, after card meta loads in. */
  refreshPendingPrompts(): void {
    if (this.family) {
      this.refreshFamily()
      return
    }
  }

  private async continueFamily(
    family: NonNullable<GreDispatch['family']>,
    createResponse: () => PromptResponse | null,
    until: 'request' | 'confirmation' | 'state',
  ): Promise<boolean> {
    const details = createResponse()
    if (!details || this.family !== family || family.source !== this.host.sessionGeneration()) {
      return false
    }
    family.continuing = until
    const response = this.beginPromptResponse(
      family.model.kind,
      () => createResponse() != null,
      true,
    )
    if (!response) {
      family.continuing = null
      return false
    }
    return response.send(details.type, { ...details.payload, respId: family.msgId })
  }

  /** A completion acknowledgement only retires a family waiting for confirmation. */
  retireFamilyContinuation(kind: PromptView['kind']): void {
    if (
      this.family?.model.kind !== kind ||
      this.family.continuing !== 'confirmation' ||
      !this.respondingInteraction?.delivered
    ) {
      return
    }
    this.respondingInteraction = null
    this.prompt = null
  }

  retireCancelledAction(): void {
    if (this.family?.cancelling && this.respondingInteraction?.delivered) {
      this.respondingInteraction = null
      this.prompt = null
    }
  }

  rejectPromptResponse(): void {
    if (this.family && this.respondingInteraction) {
      this.family.cancelling = false
      this.family.continuing = null
      this.respondingInteraction = null
      this.refreshFamily()
      this.host.publish()
    }
  }

  private async submitFamily(
    family: NonNullable<GreDispatch['family']>,
    createResponse: () => PromptResponse | null,
    automaticKeep = false,
  ): Promise<boolean> {
    if (this.family !== family || family.source !== this.host.sessionGeneration()) {
      return false
    }
    const details = createResponse()
    if (!details) {
      return false
    }
    const response = this.beginPromptResponse(
      family.model.kind,
      () => createResponse() != null,
      false,
      automaticKeep,
    )
    if (
      !response ||
      !(await response.send(details.type, { ...details.payload, respId: family.msgId }))
    ) {
      return false
    }
    if (this.family !== family || family.source !== this.host.sessionGeneration()) {
      return false
    }
    this.prompt = null
    this.host.publish()
    return true
  }
}
