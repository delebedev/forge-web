/**
 * Families own request interpretation, draft state, projection, and response details.
 * GreDispatch owns interaction identity, waiting, publication, and delivery through
 * FamilyScope. Views stay serializable; bound controls are kept outside snapshots.
 * Successful choice submission retires the interaction. Cancellation waits for
 * authoritative state or rejection. Bounded continuations retain that same owner.
 */
import type {
  MulliganPromptView,
  DamagePromptView,
  DamageAssignerCandidate,
  DamageAssignmentCandidate,
  AttackersPromptView,
  BlockersPromptView,
  AttackCandidate,
  BlockCandidate,
  PaymentPromptView,
  PayCostCandidate,
  GatherCounterCandidate,
  TargetPromptView,
  TargetCandidate,
  CardMeta,
  CastingPromptView,
  SelectionPromptView,
  SelectNCandidate,
  CastingOptionCandidate,
  CastingOptionSelectCandidate,
  ModalOptionCandidate,
  GreTables,
  NumericPromptView,
  DistributionPromptView,
  GroupPromptView,
  OrderPromptView,
  ReplacementPromptView,
  OptionalActionPromptView,
  SearchPromptView,
  ProtoObject,
  PromptView,
} from '@engine/state/gre-state'

export type AttackerControls = {
  choose(candidate: AttackCandidate): Promise<boolean>
  all(): Promise<boolean>
  submit(): Promise<boolean>
}
export type BlockerControls = {
  choose(candidate: BlockCandidate, attackerInstanceId: number): Promise<boolean>
  submit(): Promise<boolean>
}

export type DamageControls = {
  adjust(
    assigner: DamageAssignerCandidate,
    assignment: DamageAssignmentCandidate,
    delta: number,
  ): boolean
  submit(): Promise<boolean>
}

export type MulliganControls = { keep(): Promise<boolean>; mulligan(): Promise<boolean> }

export type FamilyView =
  | MulliganPromptView
  | DamagePromptView
  | AttackersPromptView
  | BlockersPromptView
  | PaymentPromptView
  | TargetPromptView
  | SelectionPromptView
  | CastingPromptView
  | NumericPromptView
  | SearchPromptView
  | GroupPromptView
  | OrderPromptView
  | DistributionPromptView
  | ReplacementPromptView
  | OptionalActionPromptView
export type PaymentControls = {
  pay(candidate: PayCostCandidate): Promise<boolean>
  finish(): Promise<boolean>
  adjust(candidate: GatherCounterCandidate, delta: number): boolean
  submit(): Promise<boolean>
  cancel(): Promise<boolean>
}
export type TargetControls = {
  choose(candidate: TargetCandidate): Promise<boolean>
  submit(): Promise<boolean>
  cancel(): Promise<boolean>
}
export type NumericControls = {
  adjust(direction: -1 | 1): boolean
  submit(): Promise<boolean>
}
export type SearchControls = {
  toggle(instanceId: number): boolean
  submit(): Promise<boolean>
  fail(): Promise<boolean>
}
export type GroupControls = {
  move(instanceId: number, groupIndex: number): boolean
  submit(): Promise<boolean>
}
export type OrderControls = {
  toggle(instanceId: number): boolean
  submit(): Promise<boolean>
}
export type DistributionControls = {
  adjust(instanceId: number, delta: number): boolean
  submit(): Promise<boolean>
}
export type ReplacementControls = { choose(replacementEffectId: number): Promise<boolean> }
export type OptionalActionControls = { respond(accept: boolean): Promise<boolean> }
export type SelectionControls = {
  toggle(candidate: SelectNCandidate): boolean
  submit(): Promise<boolean>
  cancel(): Promise<boolean>
}
export type CastingControls = {
  chooseCastingOption(option: CastingOptionCandidate): Promise<boolean>
  chooseCastingOptionSelect(
    option: CastingOptionCandidate,
    choice: CastingOptionSelectCandidate,
  ): Promise<boolean>
  selectManaType(option: CastingOptionCandidate, color: number): boolean
  submitManaTypes(): Promise<boolean>
  chooseModalOption(option: CastingOptionCandidate, modal: ModalOptionCandidate): Promise<boolean>
  toggleModalOption(option: CastingOptionCandidate, modal: ModalOptionCandidate): boolean
  adjustModalOption(
    option: CastingOptionCandidate,
    modal: ModalOptionCandidate,
    delta: number,
  ): boolean
  submitModalOptions(option: CastingOptionCandidate): Promise<boolean>
  cancel(): Promise<boolean>
}
export type PromptBinding =
  | { kind: 'mulligan'; view: MulliganPromptView; controls: MulliganControls | null }
  | { kind: 'assignDamage'; view: DamagePromptView; controls: DamageControls | null }
  | { kind: 'attackers'; view: AttackersPromptView; controls: AttackerControls | null }
  | { kind: 'blockers'; view: BlockersPromptView; controls: BlockerControls | null }
  | { kind: 'payCosts'; view: PaymentPromptView; controls: PaymentControls | null }
  | { kind: 'targets'; view: TargetPromptView; controls: TargetControls | null }
  | { kind: 'selectN'; view: SelectionPromptView; controls: SelectionControls | null }
  | { kind: 'castingOptions'; view: CastingPromptView; controls: CastingControls | null }
  | { kind: 'replacement'; view: ReplacementPromptView; controls: ReplacementControls | null }
  | {
      kind: 'optionalAction'
      view: OptionalActionPromptView
      controls: OptionalActionControls | null
    }
  | { kind: 'distribution'; view: DistributionPromptView; controls: DistributionControls | null }
  | { kind: 'group'; view: GroupPromptView; controls: GroupControls | null }
  | { kind: 'order'; view: OrderPromptView; controls: OrderControls | null }
  | { kind: 'numericInput'; view: NumericPromptView; controls: NumericControls | null }
  | { kind: 'search'; view: SearchPromptView; controls: SearchControls | null }

export type PromptContext = {
  waiting?: boolean
  waitingFor?: 'cancellation' | 'request' | 'confirmation' | 'state' | null
  tables: GreTables
  cardMeta: Map<number, CardMeta>
  viewerSeatId: number
}
export type PromptResponse = { type: string; payload: ProtoObject }

/** The lifetime owner validates identity before running a family's edit or response. */
export type FamilyScope = {
  /** Retain the interaction until its requested authoritative event. */
  continue(
    response: () => PromptResponse | null,
    until: 'request' | 'confirmation' | 'state',
  ): Promise<boolean>
  context(): PromptContext
  edit(change: () => boolean): boolean
  /** Re-evaluated before delivery; build from current state without mutating it. */
  submit(response: () => PromptResponse | null): Promise<boolean>
  /** Wait for authoritative state; rejection restores this interaction. */
  cancel(allowed: () => boolean): Promise<boolean>
}

export interface PromptFamily {
  readonly kind: FamilyView['kind']
  readonly continuation?: {
    key: string
    automaticResponse(context: PromptContext): PromptResponse | null
  }
  project(context: PromptContext, interactionKey: number): FamilyView
  bind(view: PromptView, scope: FamilyScope | null): PromptBinding | null
}

/** Unsupported shapes still supersede the interaction, with family-owned presentation. */
export type FamilyRequest =
  PromptFamily | { kind: 'unsupported'; message: string; diagnostic: string } | null
