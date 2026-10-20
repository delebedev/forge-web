import { test, expect, errors, type Locator, type Page } from '@playwright/test'
import { startPuzzleGame } from './gre-test'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import type { ActionCompletionState } from './action-completion'
import { completionState, resolveResult } from './gre-action-completion'
import { clickControl, requestDispatch, type ControlDispatch } from './gre-request-dispatch'
import {
  ACTION_CAST,
  ACTION_CAST_ADVENTURE,
  ACTION_CAST_MDFC,
  ACTION_CAST_OMEN,
  ACTION_PLAY,
  ACTION_PLAY_MDFC,
} from '../src/engine/state/gre-state'

export type RawSuite = {
  name: string
  web?: { skip?: string }
  scenarios: RawScenario[]
}

export type RawScenario = {
  id: string
  puzzle: string
  run?: string
  expect?: string
  web?: { skip?: string }
  steps: RawStep[]
  headless?: { full_control?: boolean }
}

type RawStep = Record<string, unknown>
export type Condition = Record<string, unknown>
export type ActionSpec = {
  type: string
  card: string
  zone?: string
  alt_cost?: string
  ability_grp_id?: number
}
type AttackSpec = {
  cards: string[]
  alt_cost?: string
  target?: string | { side: string; zone: string; card: string }
}

const LEYLINE_ROOT = process.env['LEYLINE_ROOT'] ?? resolve(import.meta.dirname, '../leyline')
const pendingOptionalActions = new WeakMap<Page, boolean>()
const settledStaticChoice = new WeakMap<Page, boolean>()

/** Suite name stems (no `.yaml`) for every acceptance suite in the pinned leyline checkout, sorted. */
export function discoverAcceptanceSuites(): string[] {
  return readdirSync(resolve(LEYLINE_ROOT, 'data/puzzles/sets'))
    .filter((name) => name.endsWith('.yaml'))
    .map((name) => name.replace(/\.yaml$/, ''))
    .sort()
}

export function loadAcceptanceSuite(suiteName: string): RawSuite {
  const suitePath = resolve(
    LEYLINE_ROOT,
    'data/puzzles/sets',
    suiteName.endsWith('.yaml') ? suiteName : `${suiteName}.yaml`,
  )
  return parse(readFileSync(suitePath, 'utf8')) as RawSuite
}

export function loadAcceptanceScenarios(suiteName: string): RawScenario[] {
  return loadAcceptanceSuite(suiteName).scenarios
}

export async function runGreAcceptanceScenario(page: Page, scenario: RawScenario): Promise<void> {
  await startPuzzleGame(page, scenario.puzzle)
  await runGreAcceptanceSteps(page, scenario)
}

/** Execute a scenario after another entry point has already launched its puzzle. */
export async function runGreAcceptanceSteps(
  page: Page,
  scenario: Pick<RawScenario, 'steps'> & Partial<RawScenario>,
  options: { stepDelayMs?: number; fullControl?: boolean } = {},
): Promise<void> {
  pendingOptionalActions.delete(page)
  settledStaticChoice.delete(page)
  await keepOpeningHandIfPrompt(page)
  const fullControl = page.getByRole('button', { name: 'Full control', exact: true })
  if (options.fullControl ?? scenario.headless?.full_control) {
    await expect(page.getByRole('button', { name: /^Full control(?: · On)?$/ })).toBeVisible({
      timeout: 20_000,
    })
    if (await fullControl.isVisible()) {
      await fullControl.click()
    }
    await expect(
      page.getByRole('button', { name: 'Full control · On', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
  }
  const baseline = { annotationSeq: -1 }

  let actionBefore: {
    state: ActionCompletionState
    annotationSeq: number
    resultAlreadyMet: boolean
  } | null = null
  for (const [index, step] of scenario.steps.entries()) {
    const entries = Object.entries(step)
    if (entries.length !== 1) {
      throw new Error(`Acceptance step must have one key: ${JSON.stringify(step)}`)
    }
    const [kind, value] = entries[0]
    if (!actionBefore && !['wait', 'expect', 'resolve_stack'].includes(kind)) {
      const nextResolution = scenario.steps.findIndex(
        (candidate, candidateIndex) => candidateIndex > index && 'resolve_stack' in candidate,
      )
      const upcoming =
        nextResolution >= 0 ? resolutionResult(scenario.steps, nextResolution) : undefined
      const annotationSeq = await latestAnnotationSeq(page)
      actionBefore = {
        state: await completionState(page),
        annotationSeq,
        resultAlreadyMet:
          upcoming != null && (await conditionsMet(page, conditions(upcoming), { annotationSeq })),
      }
    }
    switch (kind) {
      case 'wait':
      case 'expect':
        await expectConditions(page, conditions(value), baseline)
        break
      case 'pass_until':
        await passUntil(page, value as Record<string, unknown>)
        break
      case 'play_land':
        await playLand(page, String(value))
        break
      case 'cast':
        await cast(
          page,
          typeof value === 'string' ? { type: 'cast', card: value } : (value as ActionSpec),
        )
        break
      case 'cast_adventure':
        await performSpecialAction(page, String(value), ACTION_CAST_ADVENTURE)
        break
      case 'cast_mdfc':
        await performSpecialAction(page, String(value), ACTION_CAST_MDFC)
        break
      case 'play_mdfc':
        await performSpecialAction(page, String(value), ACTION_PLAY_MDFC)
        break
      case 'cast_omen':
        await performSpecialAction(page, String(value), ACTION_CAST_OMEN)
        break
      case 'target':
        await target(page, value)
        break
      case 'targets': {
        let interaction: number | undefined
        await expect
          .poll(
            async () => {
              const targeting = await completionState(page)
              interaction = targeting.interaction
              return (
                targeting.kind === 'targets' &&
                interaction !== undefined &&
                targeting.decision !== null &&
                !targeting.lagging &&
                !targeting.waiting &&
                (await page.locator('[data-prompt="targets"]').isVisible())
              )
            },
            { timeout: 20_000 },
          )
          .toBe(true)
        for (const targetSpec of value as Array<Record<string, unknown>>) {
          await target(page, targetSpec)
        }
        const submitTargets = page.getByRole('button', { name: 'Submit targets' })
        await expect
          .poll(
            async () => {
              const current = await completionState(page)
              if (targetDecisionRetired(current, interaction!)) {
                return 'advanced'
              }
              if (current.waiting || current.lagging || current.kind !== 'targets') {
                return 'pending'
              }
              return (await submitTargets.isEnabled({ timeout: 100 }).catch((error: unknown) => {
                if (error instanceof errors.TimeoutError) {
                  return false
                }
                throw error
              }))
                ? 'submit'
                : 'pending'
            },
            { timeout: 20_000 },
          )
          .not.toBe('pending')
        const current = await completionState(page)
        if (!targetDecisionRetired(current, interaction!)) {
          await submitTargets.click()
        }
        await expect
          .poll(
            async () => {
              return targetDecisionRetired(await completionState(page), interaction!)
            },
            { timeout: 20_000 },
          )
          .toBe(true)
        break
      }
      case 'distribute':
        await distribute(page, value as Array<{ side: string; card: string; amount: number }>)
        break
      case 'block':
        await block(page, value as { blocker: string; attacker: string })
        break
      case 'activate':
        await activate(
          page,
          typeof value === 'string'
            ? { card: value }
            : (value as {
                card: string
                zone?: string
                ability_index?: number
                ability_grp_id?: number
              }),
        )
        break
      case 'choose':
        if (
          typeof value === 'object' &&
          value != null &&
          'label' in value &&
          !('optional_cost' in value) &&
          !('cto_id' in value)
        ) {
          await selectN(page, [String((value as { label: unknown }).label)])
        } else {
          await choose(page, value as { optional_cost?: string; cto_id?: number; label?: string })
        }
        break
      case 'select_card':
        await selectCard(page, value as { side: string; zone: string; card: string })
        break
      case 'select_cards':
        await selectN(page, (value as { cards: string[] }).cards)
        break
      case 'group_keep': {
        await expect(promptLocator(page, 'GroupReq')).toBeVisible({ timeout: 20_000 })
        const submit = page.getByRole('button', { name: 'Submit groups', exact: true })
        await expect(submit).toBeEnabled({ timeout: 20_000 })
        await submit.click()
        break
      }
      case 'search_cards':
        await searchCards(page, (value as { cards: string[] }).cards)
        break
      case 'select_cost':
        await selectCost(page, value as { side?: string; zone: string; cards: string[] })
        break
      case 'order_cards':
        await orderCards(page, value as string[])
        break
      case 'modal_choice':
        await modalChoice(page, value as { index: number })
        break
      case 'static_choice':
        await staticChoice(page, value as { id: number })
        break
      case 'mana_type_choices':
        await chooseManaTypes(page, value as string[])
        break
      case 'numeric_input':
        await numericInput(page, value)
        break
      case 'optional_action':
        await optionalAction(page, value as { accept: boolean })
        break
      case 'cancel_action':
        await cancelAction(page)
        break
      case 'turn_face_up':
        await turnFaceUp(page, String(value))
        break
      case 'resolve_stack': {
        const result = resolutionResult(scenario.steps, index)
        if (
          result &&
          actionBefore &&
          !actionBefore.resultAlreadyMet &&
          !pendingOptionalActions.has(page)
        ) {
          const before = actionBefore
          const checks = conditions(result)
          const next = scenario.steps.slice(index + 1).find((step) => !('expect' in step))
          const nextPrompt = (next?.['pass_until'] as Record<string, unknown> | undefined)?.[
            'prompt'
          ]
          await resolveResult(page, {
            before: before.state,
            result: () => conditionsMet(page, checks, before),
            expected: result,
            expectedPrompt: checks.some((check) => 'prompt' in check),
            nextPrompt:
              nextPrompt == null ? undefined : () => promptVisible(page, promptType(nextPrompt)),
          })
          settledStaticChoice.delete(page)
        } else {
          await test.step('resolve stack (legacy)', () => resolveStack(page))
        }
        actionBefore = null
        break
      }
      case 'attack':
        await attack(page, value as AttackSpec)
        break
      case 'attack_all':
        await attackAll(page)
        break
      default:
        throw new Error(`Unsupported browser acceptance step: ${kind}`)
    }
    if (options.stepDelayMs) {
      await page.waitForTimeout(options.stepDelayMs)
    }
  }
}

function resolutionResult(steps: RawStep[], index: number): unknown {
  const explicit = steps[index]['resolve_stack'] as Record<string, unknown>
  if (explicit && typeof explicit === 'object' && Object.keys(explicit).length > 0) {
    return explicit
  }
  const following = steps[index + 1]
  if (following?.['optional_action']) {
    return { prompt: 'OptionalActionMessage' }
  }
  return following?.['expect'] ?? following?.['wait']
}

async function expectConditions(
  page: Page,
  checks: Condition[],
  baseline: { annotationSeq: number },
): Promise<void> {
  for (const check of checks) {
    await expectCondition(page, check, baseline)
  }
}

async function keepOpeningHandIfPrompt(page: Page): Promise<void> {
  const keep = page.getByRole('button', { name: 'Keep hand' })
  await expect
    .poll(async () => (await keep.isVisible()) || (await page.locator('[data-card]').count()) > 0, {
      timeout: 20_000,
    })
    .toBe(true)
  if (await keep.isVisible()) {
    await keep.click()
  }
}

export async function passUntil(page: Page, raw: Record<string, unknown>): Promise<void> {
  const maxPasses = Number(raw['max_passes'] ?? 20)
  const checks = conditions(
    Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'max_passes')),
  )
  const awaitedPrompts = new Set(
    checks.flatMap((check) => ('prompt' in check ? [promptType(check['prompt'])] : [])),
  )
  const baseline = { annotationSeq: await latestAnnotationSeq(page) }
  const requireFreshPriority = checks.some((check) => 'priority' in check)
  let submittedRequest = (await completionState(page)).request
  let passes = 0
  for (let i = 0; i <= maxPasses * 4 + 20; i += 1) {
    await expect
      .poll(async () => (await completionState(page)).lagging, { timeout: 20_000 })
      .toBe(false)
    const current = await completionState(page)
    const request = current.request
    if (
      (!requireFreshPriority || request > submittedRequest) &&
      (await conditionsMet(page, checks, baseline))
    ) {
      return
    }
    if (
      (!requireFreshPriority || passes === 0 || request > submittedRequest) &&
      request > 0 &&
      !current.waiting &&
      !current.terminal &&
      current.connected &&
      passes < maxPasses &&
      (await clickPass(
        page,
        awaitedPrompts,
        false,
        requestDispatch(
          current,
          async () =>
            (!requireFreshPriority || request > submittedRequest) &&
            (await conditionsMet(page, checks, baseline)),
        ),
      ))
    ) {
      submittedRequest = request
      passes += 1
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`pass_until did not reach ${JSON.stringify(raw)}`)
}

export async function conditionsMet(
  page: Page,
  checks: Condition[],
  baseline: { annotationSeq: number },
): Promise<boolean> {
  for (const check of checks) {
    if (!(await conditionMet(page, check, baseline))) {
      return false
    }
  }
  return true
}

export function conditions(raw: unknown): Condition[] {
  const map = raw as Record<string, unknown>
  if (Array.isArray(map['all'])) {
    return map['all'].map((item) => item as Condition)
  }
  return Object.entries(map).map(([key, value]) => ({ [key]: value }))
}

async function expectCondition(
  page: Page,
  check: Condition,
  baseline: { annotationSeq: number },
): Promise<void> {
  const [kind, value] = Object.entries(check)[0]
  switch (kind) {
    case 'action': {
      const action = value as ActionSpec
      const locator = exactActionLocator(page, action).first()
      await expect(locator).toBeVisible({ timeout: 20_000 })
      break
    }
    case 'action_not_available': {
      const action = value as ActionSpec
      await expect(visibleActionSource(page, action).first()).toBeVisible({ timeout: 20_000 })
      await expect(exactActionLocator(page, action)).toHaveCount(0)
      break
    }
    case 'zone_contains': {
      const zone = value as { side: string; zone: string; card: string }
      await expect(zoneLocator(page, zone.side, zone.zone, zone.card).first()).toBeVisible({
        timeout: 20_000,
      })
      break
    }
    case 'zone_not_contains': {
      const zone = value as { side: string; zone: string; card: string }
      await expect(zoneLocator(page, zone.side, zone.zone, zone.card)).toHaveCount(0)
      break
    }
    case 'opponent_life':
      await expect.poll(() => playerLife(page, 'opponent'), { timeout: 20_000 }).toBe(Number(value))
      break
    case 'our_life':
      await expect.poll(() => playerLife(page, 'ours'), { timeout: 20_000 }).toBe(Number(value))
      break
    case 'our_turn_after':
    case 'priority':
      await expect.poll(() => conditionMet(page, check, baseline), { timeout: 20_000 }).toBe(true)
      break
    case 'phase':
      await expect
        .poll(() => currentPhase(page).then((phase) => phaseMatches(phase, String(value))), {
          timeout: 30_000,
        })
        .toBe(true)
      break
    case 'battlefield_stats_at_least': {
      const spec = value as { side: string; card: string; power: number; toughness: number }
      await expect.poll(() => battlefieldStatsAtLeast(page, spec), { timeout: 20_000 }).toBe(true)
      break
    }
    case 'battlefield_stats': {
      const spec = value as { side: string; card: string; power: number; toughness: number }
      await expect.poll(() => battlefieldStats(page, spec), { timeout: 20_000 }).toBe(true)
      break
    }
    case 'annotation_seen':
      await expect.poll(() => annotationSeen(page, value, baseline)).toBe(true)
      break
    case 'annotation_seen_in_phase':
      await expect.poll(() => annotationPhaseReached(page, value, baseline)).toBe(true)
      break
    case 'zone_count': {
      const spec = value as { side: string; zone: string; count: number }
      await expect
        .poll(() => zoneCount(page, spec.side, spec.zone), { timeout: 20_000 })
        .toBe(spec.count)
      break
    }
    case 'zone_count_at_least': {
      const spec = value as { side: string; zone: string; count: number }
      await expect
        .poll(() => zoneCount(page, spec.side, spec.zone), { timeout: 20_000 })
        .toBeGreaterThanOrEqual(spec.count)
      break
    }
    case 'prompt':
      await expect(promptLocator(page, promptType(value))).toBeVisible({ timeout: 20_000 })
      break
    case 'stack_empty':
      await expect.poll(() => stackSize(page), { timeout: 20_000 }).toBe('0')
      break
    case 'outcome':
      await expect(
        page.getByRole('heading', { name: String(value), exact: true }).first(),
      ).toBeVisible({ timeout: 60_000 })
      break
    case 'winner':
    case 'loser':
      await expect(terminalOutcome(page, kind, value)).toBeVisible({ timeout: 60_000 })
      break
    default:
      throw new Error(`Unsupported browser acceptance condition: ${kind}`)
  }
}

async function conditionMet(
  page: Page,
  check: Condition,
  baseline: { annotationSeq: number },
): Promise<boolean> {
  const [kind, value] = Object.entries(check)[0]
  switch (kind) {
    case 'action': {
      const action = value as ActionSpec
      return exactActionLocator(page, action)
        .first()
        .isVisible({ timeout: 100 })
        .catch(() => false)
    }
    case 'action_not_available': {
      const action = value as ActionSpec
      if (
        !(await visibleActionSource(page, action)
          .first()
          .isVisible({ timeout: 100 })
          .catch(() => false))
      ) {
        return false
      }
      return (await exactActionLocator(page, action).count()) === 0
    }
    case 'zone_contains': {
      const zone = value as { side: string; zone: string; card: string }
      return zoneLocator(page, zone.side, zone.zone, zone.card)
        .first()
        .isVisible({ timeout: 100 })
        .catch(() => false)
    }
    case 'zone_not_contains': {
      const zone = value as { side: string; zone: string; card: string }
      return (await zoneLocator(page, zone.side, zone.zone, zone.card).count()) === 0
    }
    case 'opponent_life':
      return (await playerLife(page, 'opponent')) === Number(value)
    case 'our_life':
      return (await playerLife(page, 'ours')) === Number(value)
    case 'our_turn_after':
      return page.evaluate((turn) => {
        const state = window.__greState?.()
        return state != null && state.turn > turn && state.activeSeat === state.viewerSeat
      }, Number(value))
    case 'priority':
      return page.evaluate(
        (side) => {
          const state = window.__greState?.()
          return (
            state?.horizon?.kind === 'actions' &&
            !state.presentationLagging &&
            (side === 'ours'
              ? state.prioritySeat === state.viewerSeat
              : state.prioritySeat !== state.viewerSeat)
          )
        },
        acceptanceSide(value, 'priority'),
      )
    case 'phase':
      return phaseMatches(await currentPhase(page), String(value))
    case 'battlefield_stats_at_least':
      return battlefieldStatsAtLeast(
        page,
        value as { side: string; card: string; power: number; toughness: number },
      )
    case 'battlefield_stats':
      return battlefieldStats(
        page,
        value as { side: string; card: string; power: number; toughness: number },
      )
    case 'annotation_seen':
      return annotationSeen(page, value, baseline)
    case 'annotation_seen_in_phase':
      return annotationPhaseReached(page, value, baseline)
    case 'zone_count': {
      const spec = value as { side: string; zone: string; count: number }
      return (await zoneCount(page, spec.side, spec.zone)) === spec.count
    }
    case 'zone_count_at_least': {
      const spec = value as { side: string; zone: string; count: number }
      return (await zoneCount(page, spec.side, spec.zone)) >= spec.count
    }
    case 'prompt':
      return promptVisible(page, promptType(value))
    case 'stack_empty':
      return stackEmpty(page)
    case 'outcome':
      return page
        .getByRole('heading', { name: String(value), exact: true })
        .first()
        .isVisible({ timeout: 100 })
        .catch(() => false)
    case 'winner':
    case 'loser':
      return terminalOutcome(page, kind, value)
        .isVisible({ timeout: 100 })
        .catch(() => false)
    default:
      throw new Error(`Unsupported browser acceptance condition: ${kind}`)
  }
}

export function acceptanceSide(value: unknown, condition: string): 'ours' | 'opponent' {
  if (value !== 'ours' && value !== 'opponent') {
    throw new Error(`Unsupported ${condition} side: ${String(value)}`)
  }
  return value
}

function terminalOutcome(page: Page, kind: 'winner' | 'loser', value: unknown) {
  const side = acceptanceSide(value, kind)
  const viewerWon = (kind === 'winner') === (side === 'ours')
  return page.getByRole('dialog', { name: viewerWon ? 'Victory' : 'Defeat', exact: true })
}

function promptType(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  ) {
    return (value as { type: string }).type
  }
  return String(value)
}

// Player-facing prompt headings (mirror of PromptDock KIND_HEADINGS). The UI no
// longer shows raw request codes, so match scenarios against the humanised text.
const PROMPT_HEADINGS: Record<string, string | RegExp> = {
  DeclareAttackersReq: 'Declare attackers',
  DeclareBlockersReq: 'Declare blockers',
  SelectTargetsReq: 'target',
  DistributionReq: 'Distribute the amount',
  AssignDamageReq: 'Assign combat damage',
  GroupReq: 'Arrange cards',
  OrderReq: 'Order cards',
  SearchReq: /^Search (?:your |opponent's )?library$/,
  SearchFromGroupsReq: /^Search (?:your |opponent's )?library$/,
  SelectNReq: 'Choose options',
  PayCostsReq: 'Pay costs',
  NumericInputReq: 'Choose X',
  OptionalActionMessage: 'Optional action',
  CastingTimeOptionsReq: 'Choose how to cast',
}

function expectedHeading(prompt: string): string | RegExp {
  return PROMPT_HEADINGS[prompt] ?? prompt
}

async function promptVisible(page: Page, prompt: string): Promise<boolean> {
  if (prompt === 'SelectNReq') {
    return page
      .locator('[data-prompt="selectN"]')
      .isVisible()
      .catch(() => false)
  }
  const heading = await currentPromptText(page)
  if (!heading) {
    return false
  }
  const expected = expectedHeading(prompt)
  return (
    (typeof expected === 'string' ? heading.includes(expected) : expected.test(heading)) ||
    (prompt === 'CastingTimeOptionsReq' && heading === 'Cast your vote')
  )
}

async function currentPromptText(page: Page): Promise<string> {
  return (
    (await page
      .locator('[data-prompt]')
      .getByRole('heading')
      .textContent({ timeout: 100 })
      .catch(() => '')) ?? ''
  )
}

async function playLand(page: Page, card: string): Promise<void> {
  const locator = actionLocator(page, 'play_land', card).first()
  await expect(locator).toBeVisible({ timeout: 20_000 })
  await clickVisibleCard(locator)
}

export async function cast(page: Page, spec: ActionSpec): Promise<void> {
  const alternative =
    spec.alt_cost != null
      ? true
      : spec.zone === 'graveyard' || spec.zone === 'exile'
        ? undefined
        : false
  const source = castActionLocator(
    page,
    spec.card,
    spec.zone,
    spec.ability_grp_id,
    alternative,
  ).first()
  await expect(source).toBeVisible({ timeout: 20_000 })
  const directAction = (await source.getAttribute('data-action-key')) != null
  await clickVisibleCard(source)
  if (directAction) {
    return
  }

  const chooser = page
    .getByRole('dialog', { name: `Choose an action for ${spec.card}` })
    .or(page.getByLabel(`${spec.card} actions`))
  if (
    !(await chooser
      .first()
      .isVisible({ timeout: 250 })
      .catch(() => false))
  ) {
    return
  }
  const alternativeSelector = alternative == null ? '' : `[data-alternative-cost="${alternative}"]`
  const ability =
    spec.ability_grp_id == null ? '' : `[data-ability-grp-id="${spec.ability_grp_id}"]`
  const exactChoice = chooser
    .locator(`[data-action-key][data-action-type="${ACTION_CAST}"]${alternativeSelector}${ability}`)
    .filter({ visible: true })
  await expect(exactChoice).toHaveCount(1)
  await exactChoice.click()
}

async function performSpecialAction(
  page: Page,
  cardName: string,
  actionType: number,
): Promise<void> {
  const card = visibleActionCard(page, cardName, undefined, actionType).first()
  await expect(card).toBeVisible({ timeout: 20_000 })
  await clickVisibleCard(card)
  const chooser = page.getByRole('dialog', { name: `Choose an action for ${cardName}` })
  if (!(await chooser.isVisible({ timeout: 250 }).catch(() => false))) {
    return
  }
  const action = chooser.locator(`[data-action-type="${actionType}"]`)
  await expect(action).toHaveCount(1)
  await action.click()
}

export async function activate(
  page: Page,
  spec: { card: string; zone?: string; ability_index?: number; ability_grp_id?: number },
): Promise<void> {
  const card = visibleActionCard(page, spec.card, spec.zone, 2, spec.ability_grp_id).first()
  await expect(card).toBeVisible({ timeout: 20_000 })
  await clickVisibleCard(card)
  const chooser = page.getByRole('dialog', { name: `Choose an action for ${spec.card}` })
  if (!(await chooser.isVisible({ timeout: 250 }).catch(() => false))) {
    return
  }
  const action =
    spec.ability_grp_id == null
      ? chooser.locator('[data-action-type="2"]').nth(spec.ability_index ?? 0)
      : chooser
          .locator(`[data-action-type="2"][data-ability-grp-id="${spec.ability_grp_id}"]`)
          .first()
  await expect(action).toBeVisible({ timeout: 20_000 })
  await action.click()
}

async function choose(
  page: Page,
  spec: { optional_cost?: string; cto_id?: number; label?: string },
): Promise<void> {
  await expect(promptLocator(page, 'CastingTimeOptionsReq')).toBeVisible({ timeout: 20_000 })
  const prompt = page.locator('[data-prompt]')
  const locator = spec.label
    ? prompt.getByRole('button', { name: spec.label, exact: true })
    : spec.cto_id != null
      ? prompt.locator(`[data-cto-id][data-choice-id="${spec.cto_id}"]`).first()
      : prompt
          .locator(`[data-option-type="${castingOptionType(spec.optional_cost ?? '')}"]`)
          .first()
  await expect(locator).toBeVisible({ timeout: 20_000 })
  await locator.click()
}

async function modalChoice(page: Page, spec: { index: number }): Promise<void> {
  await expect(promptLocator(page, 'CastingTimeOptionsReq')).toBeVisible({ timeout: 20_000 })
  const locator = page.locator('[data-prompt] button[data-cto-id][data-grp-id]').nth(spec.index)
  await expect(locator).toBeVisible({ timeout: 20_000 })
  await locator.click()
}

async function staticChoice(page: Page, spec: { id: number }): Promise<void> {
  await expect(promptLocator(page, 'SelectNReq')).toBeVisible({ timeout: 20_000 })
  const choice = page.locator(`[data-prompt] [data-choice-id="${spec.id}"]`)
  await expect(choice).toBeVisible({ timeout: 20_000 })
  await choice.click()
  const submit = page.getByRole('button', { name: /Submit (selection|cost)/ })
  await expect(submit).toBeEnabled({ timeout: 5_000 })
  await submit.click()
  settledStaticChoice.set(page, true)
}

export async function numericInput(page: Page, value: unknown): Promise<void> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`numeric_input requires an integer: ${String(value)}`)
  }
  const prompt = page.locator('[data-prompt="numericInput"]')
  await expect(prompt).toBeVisible({ timeout: 20_000 })
  const display = prompt.getByLabel(/^X is /)
  let current = Number((await display.textContent())?.trim() || NaN)
  if (!Number.isSafeInteger(current)) {
    throw new Error('Numeric choice has no visible integer')
  }
  while (current !== value) {
    const direction = value > current ? 1 : -1
    const adjust = prompt.getByRole('button', {
      name: direction > 0 ? 'Increase X' : 'Decrease X',
      exact: true,
    })
    await expect(adjust).toBeEnabled()
    await adjust.click()
    await expect(display).not.toHaveText(String(current))
    const next = Number((await display.textContent())?.trim() || NaN)
    if (
      !Number.isSafeInteger(next) ||
      direction * (next - current) <= 0 ||
      direction * (next - value) > 0
    ) {
      throw new Error(
        `Numeric choice cannot reach ${value}: adjustment moved ${current} to ${next}`,
      )
    }
    current = next
  }
  await prompt.getByRole('button', { name: `Choose X = ${value}`, exact: true }).click()
  await expect(prompt).toHaveCount(0)
}

async function chooseManaTypes(page: Page, choices: string[]): Promise<void> {
  await expect(promptLocator(page, 'CastingTimeOptionsReq')).toBeVisible({ timeout: 20_000 })
  const groups = page.locator('[data-prompt="castingOptions"] [data-mana-choice]')
  await expect(groups).toHaveCount(choices.length)
  for (const [index, choice] of choices.entries()) {
    const button = groups
      .nth(index)
      .getByRole('button', { name: manaChoiceLabel(choice), exact: true })
    await expect(button).toBeVisible()
    await button.click()
  }
  const submit = page.getByRole('button', { name: 'Submit mana choices', exact: true })
  await expect(submit).toBeEnabled()
  await submit.click()
}

async function turnFaceUp(page: Page, card: string): Promise<void> {
  const locator = visibleActionCard(page, card, 'battlefield', 8).first()
  await expect(locator).toBeVisible({ timeout: 20_000 })
  await clickVisibleCard(locator)
}

async function clickVisibleCard(card: Locator): Promise<void> {
  if ((await card.getAttribute('data-attached-to')) != null) {
    // Attached cards expose their top strip until hover raises them above the host.
    await card.click({ position: { x: 10, y: 10 } })
    return
  }
  await card.click()
}

async function optionalAction(page: Page, spec: { accept: boolean }): Promise<void> {
  if (await respondToVisibleOptionalAction(page, spec.accept)) {
    return
  }
  await expect
    .poll(
      async () => {
        if (
          await promptLocator(page, 'OptionalActionMessage')
            .isVisible()
            .catch(() => false)
        ) {
          return 'optional'
        }
        if (
          await page
            .locator('[data-prompt]')
            .getByRole('heading')
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          return 'advanced'
        }
        return 'pending'
      },
      { timeout: 20_000 },
    )
    .not.toBe('pending')
  if (await respondToVisibleOptionalAction(page, spec.accept)) {
    return
  }
  if (
    await page
      .locator('[data-prompt]')
      .getByRole('heading')
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    pendingOptionalActions.set(page, spec.accept)
    return
  }
}

async function cancelAction(page: Page): Promise<void> {
  const prompt = page.locator('[data-prompt]').first()
  const cancel = prompt.getByRole('button', { name: 'Cancel', exact: true })
  await expect(cancel).toBeVisible({ timeout: 20_000 })
  await cancel.click()
  await expect(prompt).toBeHidden({ timeout: 20_000 })
}

async function selectCard(
  page: Page,
  spec: { side: string; zone: string; card: string },
): Promise<void> {
  await selectN(page, [spec.card])
}

async function selectCost(
  page: Page,
  spec: { side?: string; zone: string; cards: string[] },
): Promise<void> {
  const prompt = page.locator('[data-prompt]').first()
  await expect
    .poll(
      async () => {
        const kind = await prompt.getAttribute('data-prompt').catch(() => null)
        if (kind !== 'selectN' && kind !== 'targets' && kind !== 'payCosts') {
          return 'pending'
        }
        for (const card of spec.cards) {
          if (
            !(await prompt
              .getByRole('button', { name: card })
              .first()
              .isVisible()
              .catch(() => false))
          ) {
            return 'pending'
          }
        }
        return kind
      },
      { timeout: 20_000 },
    )
    .not.toBe('pending')
  const kind = await prompt.getAttribute('data-prompt')
  if (kind === 'payCosts') {
    for (const card of spec.cards) {
      const choice = page
        .locator('[data-prompt="payCosts"]')
        .getByRole('button', { name: card, exact: true })
      const previousCount = await choice.count()
      await expect(choice).toBeVisible({ timeout: 20_000 })
      await choice.first().click()
      await expect.poll(() => choice.count(), { timeout: 20_000 }).toBeLessThan(previousCount)
    }
    const done = page
      .locator('[data-prompt="payCosts"]')
      .getByRole('button', { name: 'Done paying', exact: true })
    await expect(done).toBeEnabled({ timeout: 20_000 })
    await done.click()
    return
  }
  if (kind === 'selectN') {
    await submitSelectN(page, spec.cards)
    return
  }
  for (const card of spec.cards) {
    const target = prompt.getByRole('button', { name: card }).first()
    await expect(target).toBeVisible({ timeout: 20_000 })
    await target.click()
  }
  const submit = prompt.getByRole('button', { name: 'Submit targets' })
  await expect
    .poll(
      async () => {
        if (
          !(await prompt.isVisible().catch(() => false)) ||
          (await prompt.getAttribute('data-prompt')) !== 'targets'
        ) {
          return 'advanced'
        }
        const selected = await Promise.all(
          spec.cards.map((card) =>
            prompt
              .getByRole('button', { name: card })
              .first()
              .getAttribute('aria-pressed')
              .catch(() => null),
          ),
        )
        if (
          selected.every((value) => value === 'true') &&
          (await submit.isEnabled().catch(() => false))
        ) {
          return 'submit'
        }
        return 'waiting'
      },
      { timeout: 20_000 },
    )
    .not.toBe('waiting')
  const selected = await Promise.all(
    spec.cards.map((card) =>
      prompt
        .getByRole('button', { name: card })
        .first()
        .getAttribute('aria-pressed')
        .catch(() => null),
    ),
  )
  if (
    selected.every((value) => value === 'true') &&
    (await submit.isEnabled().catch(() => false))
  ) {
    await submit.click()
  }
}

async function selectN(page: Page, cards: string[]): Promise<void> {
  const prompt = promptLocator(page, 'SelectNReq')
  await expect(prompt).toBeVisible({ timeout: 20_000 })
  await submitSelectN(page, cards)
}

async function searchCards(page: Page, cards: string[]): Promise<void> {
  const prompt = page.locator('[data-prompt="search"]')
  await expect(prompt).toBeVisible({ timeout: 20_000 })
  for (const card of cards) {
    await prompt
      .getByRole('button', { name: card, exact: true })
      .and(page.locator('[aria-pressed="false"]'))
      .first()
      .click()
  }
  const submit = prompt.getByRole('button', { name: 'Submit search', exact: true })
  await expect(submit).toBeEnabled({ timeout: 20_000 })
  await submit.click()
}

async function submitSelectN(page: Page, cards: string[]): Promise<void> {
  const prompt = page.locator('[data-prompt]')
  for (const card of cards) {
    const locator = prompt.getByRole('button', { name: card }).first()
    await expect(locator).toBeVisible({ timeout: 20_000 })
    await locator.click()
  }
  const submit = page.getByRole('button', { name: /Submit (selection|cost)/ })
  await expect(submit).toBeEnabled({ timeout: 20_000 })
  await submit.click()
}

async function orderCards(page: Page, cards: string[]): Promise<void> {
  await expect(promptLocator(page, 'OrderReq')).toBeVisible({ timeout: 20_000 })
  const prompt = page.locator('[data-prompt]')
  // Click each card in the desired order; each click assigns the next position.
  for (const card of cards) {
    const locator = prompt
      .getByRole('button', { name: card })
      .filter({ hasNotText: 'Submit order' })
      .first()
    await expect(locator).toBeVisible({ timeout: 20_000 })
    await locator.click()
  }
  const submit = page.getByRole('button', { name: 'Submit order', exact: true })
  await expect(submit).toBeEnabled({ timeout: 20_000 })
  await submit.click()
}

export async function target(page: Page, targetSpec: unknown): Promise<void> {
  const label =
    typeof targetSpec === 'string'
      ? targetSpec === 'opponent'
        ? 'Opponent'
        : 'You'
      : String((targetSpec as Record<string, unknown>)['card'])
  const locator = page.locator('[data-prompt]').getByRole('button', { name: label }).first()
  await expect(locator).toBeVisible({ timeout: 20_000 })
  await locator.click()
}

async function distribute(
  page: Page,
  assignments: Array<{ side: string; card: string; amount: number }>,
): Promise<void> {
  const prompt = page.locator('[data-prompt="distribution"]')
  await expect(prompt).toBeVisible({ timeout: 20_000 })
  for (const assignment of assignments) {
    const instanceId = await battlefieldInstanceId(page, assignment.side, assignment.card)
    if (instanceId == null) {
      throw new Error(`Distribution target not found: ${assignment.side} ${assignment.card}`)
    }
    const row = prompt.locator(`[data-instance-id="${instanceId}"]`)
    await expect(row).toBeVisible({ timeout: 20_000 })
    const assigned = Number(await row.locator('strong').textContent())
    for (let amount = assigned; amount < assignment.amount; amount += 1) {
      await row.getByRole('button', { name: `Assign 1 to ${assignment.card}` }).click()
    }
  }
  const submit = prompt.getByRole('button', { name: 'Submit distribution' })
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(prompt).toBeHidden()
}

async function resolveStack(page: Page): Promise<void> {
  if (settledStaticChoice.get(page)) {
    settledStaticChoice.delete(page)
    await page.waitForTimeout(500)
    return
  }
  await expect
    .poll(() => stackSize(page), { timeout: 1_000 })
    .not.toBe('0')
    .catch(() => undefined)
  for (let i = 0; i < 12; i += 1) {
    if (await stackRemainsEmpty(page)) {
      return
    }
    if (pendingOptionalActions.has(page) && (await waitForPendingOptionalAction(page))) {
      continue
    }
    if (await satisfyPendingOptionalAction(page)) {
      continue
    }
    if (await satisfyVisibleIncidentalPrompt(page)) {
      continue
    }
    if (await clickPass(page, new Set(), true)) {
      await expect
        .poll(() => stackEmpty(page), { timeout: 5_000 })
        .toBe(true)
        .catch(() => undefined)
      continue
    }
    await satisfyPendingOptionalAction(page)
  }
  await expect.poll(() => stackSize(page), { timeout: 5_000 }).toBe('0')
}

async function attackAll(page: Page): Promise<void> {
  await expect(promptLocator(page, 'DeclareAttackersReq')).toBeVisible({ timeout: 20_000 })
  const attackers = await page.locator('[data-option-index]').all()
  for (const attacker of attackers) {
    await attacker.click()
  }
  await page.getByRole('button', { name: 'Submit attackers' }).click()
}

async function attack(page: Page, spec: AttackSpec): Promise<void> {
  await expect(promptLocator(page, 'DeclareAttackersReq')).toBeVisible({ timeout: 20_000 })
  for (const card of spec.cards) {
    const attackerId = await battlefieldInstanceId(page, 'ours', card)
    if (attackerId == null) {
      throw new Error(`Attacker not found on battlefield: ${card}`)
    }
    let attackers = page.locator(`[data-option-index][data-instance-id="${attackerId}"]`)
    if (typeof spec.target === 'string') {
      const defender = spec.target === 'ours' ? 'You' : 'Opponent'
      attackers = attackers.and(
        page.getByRole('button', { name: `${card} attacks ${defender}`, exact: true }),
      )
    } else if (spec.target) {
      if (spec.target.zone !== 'battlefield') {
        throw new Error('Attack target must be on the battlefield')
      }
      const targetId = await battlefieldInstanceId(page, spec.target.side, spec.target.card)
      if (targetId == null) {
        throw new Error(`Attack target not found: ${spec.target.card}`)
      }
      attackers = attackers.and(page.locator(`[data-recipient$=":${targetId}"]`))
    }
    const attacker =
      spec.alt_cost && (await attackers.count()) > 1 ? attackers.nth(1) : attackers.first()
    await expect(attacker).toBeVisible({ timeout: 20_000 })
    await attacker.click()
  }
  await page.getByRole('button', { name: 'Submit attackers' }).click()
}

async function clickPass(
  page: Page,
  awaitedPrompts: ReadonlySet<string> = new Set(),
  requireStack = false,
  dispatch?: ControlDispatch,
): Promise<boolean> {
  if (
    !awaitedPrompts.has('OptionalActionMessage') &&
    (await satisfyPendingOptionalAction(page, dispatch))
  ) {
    return true
  }
  if (await satisfyVisibleIncidentalPrompt(page, awaitedPrompts, dispatch)) {
    return true
  }
  const actionScope = page.locator(
    requireStack ? '[data-board]:not([data-stack="0"])' : '[data-board]',
  )
  const pass = actionScope
    .getByRole('button', { name: /^(Pass|Resolve)$/ })
    .filter({ visible: true })
    .first()
  if (await pass.isEnabled({ timeout: 100 }).catch(() => false)) {
    if (dispatch) {
      return dispatch(pass)
    }
    await pass.click()
    return true
  }
  const passPriority = actionScope
    .getByRole('button', { name: 'Pass priority', exact: true })
    .and(page.locator('button:not([data-action-key])'))
    .filter({ visible: true })
    .first()
  if (!(await passPriority.isEnabled({ timeout: 100 }).catch(() => false))) {
    return false
  }
  if (dispatch) {
    return dispatch(passPriority)
  }
  await passPriority.click()
  return true
}

async function satisfyPendingOptionalAction(
  page: Page,
  dispatch: ControlDispatch = clickControl,
): Promise<boolean> {
  const accept = pendingOptionalActions.get(page)
  if (accept == null) {
    return false
  }
  if (!(await respondToVisibleOptionalAction(page, accept, dispatch))) {
    return false
  }
  pendingOptionalActions.delete(page)
  return true
}

async function waitForPendingOptionalAction(page: Page): Promise<boolean> {
  await expect(promptLocator(page, 'OptionalActionMessage')).toBeVisible({ timeout: 20_000 })
  return satisfyPendingOptionalAction(page)
}

async function respondToVisibleOptionalAction(
  page: Page,
  accept: boolean,
  dispatch: ControlDispatch = clickControl,
): Promise<boolean> {
  const target = page
    .locator('[data-prompt]')
    .getByRole('button', { name: accept ? 'Accept' : 'Decline', exact: true })
    .first()
  if (!(await target.isVisible({ timeout: 100 }).catch(() => false))) {
    return false
  }
  if (!(await dispatch(target))) {
    return false
  }
  await page.waitForTimeout(100)
  return true
}

async function satisfyVisibleIncidentalPrompt(
  page: Page,
  awaitedPrompts: ReadonlySet<string> = new Set(),
  dispatch: ControlDispatch = clickControl,
): Promise<boolean> {
  if (
    !awaitedPrompts.has('OptionalActionMessage') &&
    (await respondToVisibleOptionalAction(page, true, dispatch))
  ) {
    return true
  }
  const submitAttackers = page.getByRole('button', { name: 'Submit attackers' })
  if (
    !awaitedPrompts.has('DeclareAttackersReq') &&
    (await submitAttackers.isVisible({ timeout: 100 }).catch(() => false))
  ) {
    return dispatch(submitAttackers).catch(() => false)
  }
  const submitBlockers = page.getByRole('button', { name: 'Submit blockers' })
  if (
    !awaitedPrompts.has('DeclareBlockersReq') &&
    (await submitBlockers.isVisible({ timeout: 100 }).catch(() => false))
  ) {
    return dispatch(submitBlockers).catch(() => false)
  }
  const assignDamage = page.getByRole('button', { name: 'Assign damage' })
  if (
    !awaitedPrompts.has('AssignDamageReq') &&
    (await assignDamage.isEnabled({ timeout: 100 }).catch(() => false))
  ) {
    return dispatch(assignDamage).catch(() => false)
  }
  const submitGroups = page.getByRole('button', { name: 'Submit groups' })
  if (
    !awaitedPrompts.has('GroupReq') &&
    (await submitGroups.isEnabled({ timeout: 100 }).catch(() => false))
  ) {
    return dispatch(submitGroups).catch(() => false)
  }
  return false
}

function actionLocator(
  page: Page,
  type: string,
  card: string,
  zone?: string,
  altCost?: string,
  abilityGrpId?: number,
) {
  const specialType = specialActionType(type)
  if (specialType != null) {
    return visibleActionCard(page, card, zone, specialType)
  }
  const label = type === 'play_land' ? 'Play land' : type === 'cast' ? 'Cast spell' : 'Activate'
  if (type === 'play_land') {
    return visibleActionCard(page, card, zone, ACTION_PLAY)
  }
  if (type === 'cast') {
    return castActionLocator(page, card, zone, abilityGrpId, altCost == null ? undefined : true)
  }
  if (type === 'activate') {
    return visibleActionCard(page, card, zone, 2)
  }
  if (zone === 'battlefield') {
    return page
      .locator('[data-zone="battlefield"] [data-card]', { hasText: label })
      .filter({ hasText: card })
  }
  if (zone === 'hand') {
    return page
      .locator('[data-zone="hand"][data-owner="self"] [data-card]', { hasText: label })
      .filter({ hasText: card })
  }
  return page
    .locator(
      '[data-zone="hand"][data-owner="self"] [data-card], [data-zone="battlefield"] [data-card]',
      { hasText: label },
    )
    .filter({ hasText: card })
}

function castActionLocator(
  page: Page,
  card: string,
  zone: string | undefined,
  abilityGrpId: number | undefined,
  alternative: boolean | undefined,
) {
  const source = visibleActionCard(page, card, zone, ACTION_CAST, abilityGrpId, alternative)
  const altSelector = alternative == null ? '' : `[data-alternative-cost="${alternative}"]`
  const abilitySelector = abilityGrpId == null ? '' : `[data-ability-grp-id="${abilityGrpId}"]`
  const direct = page.locator(
    `[data-action-key][data-action-type="${ACTION_CAST}"]${altSelector}${abilitySelector}${zoneSelector(zone)}`,
    { hasText: card },
  )
  return source.or(direct)
}

function exactActionLocator(page: Page, spec: ActionSpec) {
  if (spec.ability_grp_id != null && spec.type === 'activate') {
    return visibleActionCard(page, spec.card, spec.zone, 2, spec.ability_grp_id)
  }
  return actionLocator(page, spec.type, spec.card, spec.zone, spec.alt_cost, spec.ability_grp_id)
}

function visibleActionCard(
  page: Page,
  card: string,
  zone: string | undefined,
  actionType: number,
  abilityGrpId?: number,
  alternative?: boolean,
) {
  const action =
    alternative == null && abilityGrpId == null
      ? `[data-action-types~="${actionType}"]`
      : `[data-action-tuples~="${alternative == null ? `${actionType}:ability:${abilityGrpId}` : `${actionType}:${Number(alternative)}${abilityGrpId == null ? '' : `:${abilityGrpId}`}`}"]`
  if (zone === 'graveyard' || zone === 'exile' || zone === 'library') {
    const zoneType = zone === 'graveyard' ? 5 : zone === 'exile' ? 6 : 1
    return page.locator(
      `[data-non-hand-action][data-source-zone="${zoneType}"] [data-card]${action}`,
      { hasText: card },
    )
  }
  const visibleCard = visiblePlayerCard(page, card, zone, action)
  if (zone != null) {
    return visibleCard
  }
  return visibleCard.or(
    page.locator(`[data-non-hand-action] [data-card]${action}`, { hasText: card }),
  )
}

function visiblePlayerCard(page: Page, card: string, zone: string | undefined, suffix = '') {
  const selector =
    zone === 'hand'
      ? `[data-zone="hand"][data-owner="self"] [data-card]${suffix}`
      : zone === 'battlefield'
        ? `[data-zone="battlefield"][data-owner="self"] [data-card]${suffix}`
        : `[data-zone="hand"][data-owner="self"] [data-card]${suffix}, [data-zone="battlefield"][data-owner="self"] [data-card]${suffix}`
  return page.locator(selector, { hasText: card })
}

function visibleActionSource(page: Page, spec: ActionSpec) {
  return spec.zone === 'graveyard' || spec.zone === 'exile'
    ? zoneLocator(page, 'ours', spec.zone, spec.card)
    : visiblePlayerCard(page, spec.card, spec.zone)
}

function zoneSelector(zone?: string): string {
  switch (zone) {
    case 'library':
      return '[data-source-zone="1"]'
    case 'graveyard':
      return '[data-source-zone="5"]'
    case 'exile':
      return '[data-source-zone="6"]'
    case 'sideboard':
      return '[data-source-zone="10"]'
    default:
      return ''
  }
}

function zoneLocator(page: Page, side: string, zone: string, card: string) {
  const visibleCard = card.endsWith(' Token') ? card.slice(0, -' Token'.length) : card
  if (zone === 'battlefield') {
    const selector =
      side === 'opponent'
        ? '[data-zone="battlefield"][data-owner="opponent"] [data-card]'
        : '[data-zone="battlefield"][data-owner="self"] [data-card]'
    return page.locator(selector, { hasText: visibleCard })
  }
  if (zone === 'hand' && side === 'ours') {
    return page.locator('[data-zone="hand"][data-owner="self"] [data-card]', {
      hasText: visibleCard,
    })
  }
  if (zone === 'hand' && side === 'opponent') {
    return page.locator('[data-zone="hand"][data-owner="opponent"] [data-card]', {
      hasText: visibleCard,
    })
  }
  if (zone === 'graveyard' && side === 'ours') {
    return page.locator('[data-zone="graveyard"][data-owner="self"] [data-card]', {
      hasText: visibleCard,
    })
  }
  if (zone === 'graveyard' && side === 'opponent') {
    return page.locator('[data-zone="graveyard"][data-owner="opponent"] [data-card]', {
      hasText: visibleCard,
    })
  }
  if (zone === 'exile' && side === 'ours') {
    return page.locator('[data-zone="exile"][data-owner="self"] [data-card]', {
      hasText: visibleCard,
    })
  }
  if (zone === 'exile' && side === 'opponent') {
    return page.locator('[data-zone="exile"][data-owner="opponent"] [data-card]', {
      hasText: visibleCard,
    })
  }
  if (zone === 'sideboard' && side === 'ours') {
    return page.locator('[data-zone="sideboard"][data-owner="self"] [data-card]', {
      hasText: visibleCard,
    })
  }
  throw new Error(`Unsupported browser acceptance zone: ${side} ${zone}`)
}

async function zoneCount(page: Page, side: string, zone: string): Promise<number> {
  if (zone === 'battlefield') {
    const cards = page.locator(
      side === 'opponent'
        ? '[data-zone="battlefield"][data-owner="opponent"] [data-card]'
        : '[data-zone="battlefield"][data-owner="self"] [data-card]',
    )
    return await cards.evaluateAll((elements) =>
      elements.reduce(
        (total, element) => total + Number(element.getAttribute('data-pile-count') ?? 1),
        0,
      ),
    )
  }
  if (zone === 'hand' && side === 'ours') {
    return page.locator('[data-zone="hand"][data-owner="self"] [data-card]').count()
  }
  if (zone === 'hand' && side === 'opponent') {
    return Number(
      (await page
        .locator('[data-zone="hand"][data-owner="opponent"][data-zone-count]')
        .getAttribute('data-zone-count')) ?? 0,
    )
  }
  if (zone === 'graveyard' && side === 'ours') {
    return page.locator('[data-zone="graveyard"][data-owner="self"] [data-card]').count()
  }
  if (zone === 'graveyard' && side === 'opponent') {
    return page.locator('[data-zone="graveyard"][data-owner="opponent"] [data-card]').count()
  }
  if (zone === 'exile' && side === 'ours') {
    return page.locator('[data-zone="exile"][data-owner="self"] [data-card]').count()
  }
  if (zone === 'exile' && side === 'opponent') {
    return page.locator('[data-zone="exile"][data-owner="opponent"] [data-card]').count()
  }
  if (zone === 'sideboard' && side === 'ours') {
    return page.locator('[data-zone="sideboard"][data-owner="self"] [data-card]').count()
  }
  throw new Error(`Unsupported browser acceptance zone count: ${side} ${zone}`)
}

function promptLocator(page: Page, prompt: string) {
  if (prompt === 'SelectNReq') {
    return page.locator('[data-prompt="selectN"]')
  }
  return page.getByRole('heading', {
    name:
      prompt === 'CastingTimeOptionsReq'
        ? /Choose how to cast|Cast your vote/
        : expectedHeading(prompt),
  })
}

type BlockAssignment = { blocker: string; attacker: string }

async function block(page: Page, spec: BlockAssignment | BlockAssignment[]): Promise<void> {
  await expect(promptLocator(page, 'DeclareBlockersReq')).toBeVisible({ timeout: 20_000 })
  for (const assignment of Array.isArray(spec) ? spec : [spec]) {
    const group = page.getByRole('group', { name: assignment.blocker }).first()
    await expect(group).toBeVisible({ timeout: 20_000 })
    await group.getByRole('button', { name: assignment.attacker }).first().click()
    await expect
      .poll(async () => (await page.evaluate(() => window.__greState()!)).prompt?.waiting)
      .not.toBe(true)
  }
  await page.getByRole('button', { name: 'Submit blockers' }).click()
}

async function stackSize(page: Page): Promise<string> {
  // Read the board root by its own marker rather than by accessible name: the
  // stack size is engine state, not something a player reads off a label.
  //
  // Treating a missing board as an empty stack would make every stack_empty
  // condition pass vacuously the moment the board stops publishing the
  // attribute, so require the root to be attached and fail loudly otherwise.
  const board = page.locator('[data-board]').first()
  await expect(board).toBeAttached({ timeout: 10_000 })
  return (await board.getAttribute('data-stack')) ?? '0'
}

async function stackEmpty(page: Page): Promise<boolean> {
  return (await stackSize(page)) === '0'
}

async function stackRemainsEmpty(page: Page): Promise<boolean> {
  if (!(await stackEmpty(page))) {
    return false
  }
  await expect
    .poll(() => stackSize(page), { timeout: 1_000 })
    .not.toBe('0')
    .catch(() => undefined)
  return stackEmpty(page)
}

async function playerLife(page: Page, side: 'ours' | 'opponent'): Promise<number> {
  const selector =
    side === 'opponent'
      ? '[data-player="opponent"] [data-life]'
      : '[data-player="self"] [data-life]'
  return Number(await page.locator(selector).innerText())
}

async function battlefieldStatsAtLeast(
  page: Page,
  spec: { side: string; card: string; power: number; toughness: number },
): Promise<boolean> {
  const [power, toughness] = await battlefieldPowerToughness(page, spec)
  return (
    Number.isFinite(power) &&
    Number.isFinite(toughness) &&
    power >= spec.power &&
    toughness >= spec.toughness
  )
}

async function battlefieldStats(
  page: Page,
  spec: { side: string; card: string; power: number; toughness: number },
): Promise<boolean> {
  const [power, toughness] = await battlefieldPowerToughness(page, spec)
  return power === spec.power && toughness === spec.toughness
}

async function battlefieldPowerToughness(
  page: Page,
  spec: { side: string; card: string },
): Promise<[number, number]> {
  const card = zoneLocator(page, spec.side, 'battlefield', spec.card).first()
  const pt = await card
    .locator('[data-pt]')
    .getAttribute('data-pt', { timeout: 100 })
    .catch(() => null)
  const text = pt || (await card.innerText({ timeout: 100 }).catch(() => ''))
  const match = text.match(/(\d+)\/(\d+)/)
  return match ? [Number(match[1]), Number(match[2])] : [NaN, NaN]
}

async function battlefieldInstanceId(
  page: Page,
  side: string,
  card: string,
): Promise<number | null> {
  const value = await zoneLocator(page, side, 'battlefield', card)
    .first()
    .getAttribute('data-instance-id', { timeout: 100 })
    .catch(() => null)
  return value == null ? null : Number(value)
}

async function currentPhase(page: Page): Promise<string> {
  return (await page.locator('[data-phase]').first().getAttribute('data-phase')) ?? ''
}

export async function latestAnnotationSeq(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(-1, ...(window.__greState?.()?.annotations ?? []).map((annotation) => annotation.seq)),
  )
}

export async function annotationSeen(
  page: Page,
  value: unknown,
  baseline: { annotationSeq: number },
): Promise<boolean> {
  const typeName = annotationTypeName(value, 'annotation_seen')
  const expectedDetails = annotationDetails(value, 'annotation_seen')
  const type = await page.evaluate(
    (name) => window.__greEnumValue('AnnotationType', name),
    typeName,
  )
  const annotations = await page.evaluate(() => window.__greState?.()?.annotations ?? [])
  return annotations.some(
    (annotation) =>
      annotation.seq > baseline.annotationSeq &&
      annotation.types.some((candidate) => candidate === typeName || candidate === type) &&
      Object.entries(expectedDetails).every(([key, expected]) =>
        (annotation.details[key] ?? []).some((actual) => String(actual) === String(expected)),
      ),
  )
}

async function annotationPhaseReached(
  page: Page,
  value: unknown,
  baseline: { annotationSeq: number },
): Promise<boolean> {
  const spec = value as { type?: unknown; phase?: unknown }
  const typeName = annotationTypeName(value, 'annotation_seen_in_phase')
  const phase = String(spec.phase ?? '')
  if (!phase) {
    return false
  }
  const type = await page.evaluate(
    (name) => window.__greEnumValue('AnnotationType', name),
    typeName,
  )
  const annotations = await page.evaluate(() => window.__greState?.()?.annotations ?? [])
  return annotations.some(
    (annotation) =>
      annotation.seq > baseline.annotationSeq &&
      phaseMatches(annotation.phase, phase) &&
      annotation.types.some((candidate) => candidate === typeName || candidate === type),
  )
}

function annotationTypeName(value: unknown, condition: string): string {
  if (typeof value === 'string' && value) {
    return value
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`${condition} requires an annotation type`)
  }
  const spec = value as Record<string, unknown>
  if (typeof spec['type'] !== 'string' || !spec['type']) {
    throw new Error(`${condition} requires an annotation type`)
  }
  return spec['type']
}

function annotationDetails(value: unknown, condition: string): Record<string, unknown> {
  if (typeof value === 'string') {
    return {}
  }
  const details = (value as Record<string, unknown>)['details']
  if (details == null) {
    return {}
  }
  if (typeof details !== 'object' || Array.isArray(details)) {
    throw new Error(`${condition} details must be a map`)
  }
  return details as Record<string, unknown>
}

function phaseMatches(actual: string, expected: string): boolean {
  const normalizedExpected = expected.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return (
    normalizedExpected.length > 0 &&
    actual
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .includes(normalizedExpected)
  )
}

function specialActionType(type: string): number | null {
  switch (type) {
    case 'cast_adventure':
      return ACTION_CAST_ADVENTURE
    case 'cast_mdfc':
      return ACTION_CAST_MDFC
    case 'play_mdfc':
      return ACTION_PLAY_MDFC
    case 'cast_omen':
      return ACTION_CAST_OMEN
    default:
      return null
  }
}

function manaChoiceLabel(value: string): string {
  switch (value) {
    case 'phyrexian':
      return 'Pay 2 life'
    case 'two_generic':
      return 'Two generic'
    case 'white':
      return 'White'
    case 'blue':
      return 'Blue'
    case 'black':
      return 'Black'
    case 'red':
      return 'Red'
    case 'green':
      return 'Green'
    default:
      throw new Error(`Unsupported mana type choice: ${value}`)
  }
}

function castingOptionType(value: string): number {
  switch (value) {
    case 'kicker':
      return 3
    case 'additional_cost':
      return 5
    case 'blight':
      return 11
    default:
      throw new Error(`Unsupported casting option: ${value}`)
  }
}

export function targetDecisionRetired(
  state: Awaited<ReturnType<typeof completionState>>,
  interaction: number,
): boolean {
  return (
    state.terminal ||
    (state.decision !== null &&
      !state.waiting &&
      !state.lagging &&
      (state.kind !== 'targets' ||
        (state.interaction !== undefined && state.interaction !== interaction)))
  )
}
