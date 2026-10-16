import type { Locator, Page } from '@playwright/test'
import type {
  BrowserGreState,
  CopilotProposal,
  DecisionHorizon,
  FailureClassification,
  VisibleInteraction,
} from './types.ts'

const ACTION_TYPES: Readonly<Record<string, number>> = {
  cast: 1,
  cast_mdfc: 1,
  activate: 2,
  play_land: 3,
  cast_adventure: 16,
  cast_omen: 24,
}
const VISIBLE_INTERACTION_TIMEOUT_MS = 2_000

export class DriverFailure extends Error {
  readonly classification: FailureClassification
  readonly details: Record<string, unknown>

  constructor(
    classification: FailureClassification,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'DriverFailure'
    this.classification = classification
    this.details = details
  }
}

export async function readGreState(page: Page): Promise<BrowserGreState | null> {
  return page.evaluate(() => {
    const read = (window as unknown as { __greState?: () => BrowserGreState | null }).__greState
    const state = typeof read === 'function' ? read() : null
    if (!state) {
      return null
    }
    return {
      matchId: state.matchId,
      horizon: state.horizon,
      presentationLagging: state.presentationLagging,
      positionKey: state.positionKey,
      prompt: state.prompt ? { kind: state.prompt.kind } : null,
      gameOver: state.gameOver,
      outcome: state.outcome,
      status: state.status,
      connected: state.connected,
      turn: state.turn,
      phase: state.phase,
      step: state.step,
      gsId: state.gsId,
    }
  })
}

function sameHorizon(left: DecisionHorizon | null, right: DecisionHorizon): boolean {
  return (
    left != null &&
    left.kind === right.kind &&
    left.promptKey === right.promptKey &&
    left.gameStateId === right.gameStateId &&
    left.respId === right.respId
  )
}

async function requireHorizon(
  page: Page,
  matchId: string,
  expected: DecisionHorizon,
): Promise<BrowserGreState> {
  const state = await readGreState(page)
  if (!state) {
    throw new DriverFailure('environment', 'The GRE debug state is unavailable')
  }
  if (state.matchId !== matchId) {
    throw new DriverFailure(
      'advisor_unavailable',
      `Match changed from ${matchId} to ${state.matchId || '(none)'}`,
      { expected, actual: state.horizon },
    )
  }
  if (!sameHorizon(state.horizon, expected)) {
    throw new DriverFailure(
      'advisor_unavailable',
      'The advisor proposal is stale for the visible decision',
      { expected, actual: state.horizon },
    )
  }
  return state
}

async function visibleEnabled(locator: Locator): Promise<Locator[]> {
  const matches: Locator[] = []
  for (const item of await locator.all()) {
    if (
      (await item.isVisible().catch(() => false)) &&
      (await item.isEnabled().catch(() => false))
    ) {
      matches.push(item)
    }
  }
  return matches
}

async function exactControl(locator: Locator, description: string): Promise<Locator> {
  const matches = await visibleEnabled(locator)
  if (matches.length !== 1) {
    throw new DriverFailure(
      'ui_missing',
      `Expected one visible enabled ${description}; found ${matches.length}`,
      {
        description,
        expectedLocator: description,
        visibleControls: await visibleControls(locator.page()),
      },
    )
  }
  return matches[0]!
}

async function click(
  page: Page,
  expected: { matchId: string; horizon: DecisionHorizon; deadline?: number },
  locator: Locator,
  description: string,
  intent: string,
  actions: VisibleInteraction[],
): Promise<void> {
  await requireHorizon(page, expected.matchId, expected.horizon)
  const control = await exactControl(locator, description)
  const observed = (
    (await control.getAttribute('aria-label'))?.trim() ||
    (await control.textContent())?.trim() ||
    description
  ).slice(0, 160)
  const remaining = expected.deadline == null ? undefined : expected.deadline - Date.now()
  const timeout =
    remaining == null
      ? VISIBLE_INTERACTION_TIMEOUT_MS
      : Math.min(remaining, VISIBLE_INTERACTION_TIMEOUT_MS)
  if (timeout != null && timeout <= 0) {
    throw new DriverFailure(
      'budget_exhausted',
      'Time budget exhausted before the visible interaction',
    )
  }
  try {
    await control.click({ timeout })
  } catch (_error) {
    if (expected.deadline != null && Date.now() >= expected.deadline) {
      throw new DriverFailure(
        'budget_exhausted',
        'Time budget exhausted during the visible interaction',
        { description },
      )
    }
    throw new DriverFailure(
      'advisor_unavailable',
      'The visible interaction became unavailable before activation',
      { description, cause: String(_error) },
    )
  }
  actions.push({
    at: new Date().toISOString(),
    control: description,
    observed,
    proposalIntent: intent,
  })
}

async function visibleControls(page: Page): Promise<Array<Record<string, string | null>>> {
  return page.locator('button, [role="button"]').evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        )
      })
      .slice(0, 40)
      .map((element) => ({
        text: element.textContent?.trim().slice(0, 100) ?? '',
        ariaLabel: element.getAttribute('aria-label'),
        instanceId: element.getAttribute('data-instance-id'),
        actionKey: element.getAttribute('data-action-key'),
        targetIndex: element.getAttribute('data-target-index'),
        groupZoneType: element.getAttribute('data-group-zone-type'),
        groupSubZoneType: element.getAttribute('data-group-sub-zone-type'),
        ctoId: element.getAttribute('data-cto-id'),
        choiceId: element.getAttribute('data-choice-id'),
        prompt: element.closest('[data-prompt]')?.getAttribute('data-prompt') ?? null,
      })),
  )
}

function actionTuple(actionType: number, proposal: CopilotProposal): string {
  if (proposal.alternativeGrpId != null) {
    return `${actionType}:1${proposal.abilityGrpId == null ? '' : `:${proposal.abilityGrpId}`}`
  }
  if (proposal.abilityGrpId != null) {
    return `${actionType}:ability:${proposal.abilityGrpId}`
  }
  return `${actionType}:0`
}

function keyMatches(key: string, actionType: number, proposal: CopilotProposal): boolean {
  const fields = key.split(':').map(Number)
  return (
    fields.length >= 10 &&
    fields[0] === actionType &&
    fields[1] === proposal.card?.instanceId &&
    (proposal.abilityGrpId == null || fields[4] === proposal.abilityGrpId) &&
    (proposal.alternativeGrpId == null ? fields[7] === 0 : fields[7] === proposal.alternativeGrpId)
  )
}

async function cardAction(
  page: Page,
  proposal: CopilotProposal,
  expected: { matchId: string; horizon: DecisionHorizon },
  actions: VisibleInteraction[],
): Promise<void> {
  const actionType = ACTION_TYPES[proposal.intent]
  if (actionType == null || !proposal.card) {
    throw new DriverFailure(
      'driver_unsupported',
      `Proposal ${proposal.intent} lacks a supported card action identity`,
    )
  }
  const tuple = actionTuple(actionType, proposal)
  const card = page.locator(
    `[data-card][data-instance-id="${proposal.card.instanceId}"][data-action-tuples~="${tuple}"]`,
  )
  await click(
    page,
    expected,
    card,
    `card-action:${proposal.card.instanceId}:${actionType}`,
    proposal.intent,
    actions,
  )

  const chooser = page.locator('dialog[open]')
  if (!(await chooser.isVisible({ timeout: 150 }).catch(() => false))) {
    return
  }
  const exactKeys = await chooser
    .locator('[data-action-key]')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute('data-action-key'))
        .filter((value): value is string => value != null),
    )
  const matching = exactKeys.filter((key) => keyMatches(key, actionType, proposal))
  if (matching.length !== 1) {
    throw new DriverFailure(
      'ui_missing',
      `Expected one exact action choice; found ${matching.length}`,
      { exactKeys, proposal },
    )
  }
  await click(
    page,
    expected,
    chooser.locator(`[data-action-key="${matching[0]}"]`),
    `action-choice:${matching[0]}`,
    proposal.intent,
    actions,
  )
}

async function promptButton(
  page: Page,
  proposal: CopilotProposal,
  expected: { matchId: string; horizon: DecisionHorizon },
  name: string | RegExp,
  actions: VisibleInteraction[],
): Promise<void> {
  await click(
    page,
    expected,
    page.locator('[data-prompt]').getByRole('button', { name, exact: typeof name === 'string' }),
    `button:${String(name)}`,
    proposal.intent,
    actions,
  )
}

async function choicesById(
  page: Page,
  proposal: CopilotProposal,
  expected: { matchId: string; horizon: DecisionHorizon },
  ids: readonly number[],
  selector: (id: number) => string,
  actions: VisibleInteraction[],
): Promise<void> {
  for (const id of ids) {
    await click(
      page,
      expected,
      page.locator('[data-prompt]').locator(selector(id)),
      `choice:${id}`,
      proposal.intent,
      actions,
    )
  }
}

async function executePrompt(
  page: Page,
  proposal: CopilotProposal,
  expected: { matchId: string; horizon: DecisionHorizon },
  actions: VisibleInteraction[],
): Promise<void> {
  const ids =
    proposal.targets.length > 0
      ? proposal.targets.map((target) => target.instanceId)
      : proposal.responseIds
  switch (proposal.intent) {
    case 'target':
    case 'untarget': {
      const entries = Object.entries(proposal.targetGroups)
      if (entries.length > 0) {
        const targetCount = entries.reduce((count, [, targetIds]) => count + targetIds.length, 0)
        if (targetCount > 1) {
          throw new DriverFailure(
            'driver_unsupported',
            'Multiple target toggles require separate accepted prompt steps',
          )
        }
        const onlyId = entries[0]?.[1][0]
        const entity = proposal.targets.find((target) => target.instanceId === onlyId)
        if (entity?.kind === 'player') {
          const label =
            entity.ownerSeat === proposal.seat || entity.instanceId === proposal.seat
              ? 'Target yourself'
              : 'Target opponent'
          await click(
            page,
            expected,
            page.getByRole('button', { name: label, exact: true }),
            `button:${label}`,
            proposal.intent,
            actions,
          )
          return
        }
        for (const [targetIndex, targetIds] of entries) {
          await choicesById(
            page,
            proposal,
            expected,
            targetIds,
            (id) => `[data-target-index="${targetIndex}"][data-instance-id="${id}"]`,
            actions,
          )
        }
        return
      }
      if (proposal.targets.length !== 1) {
        throw new DriverFailure(
          'driver_unsupported',
          `${proposal.intent} requires one target or targetGroups`,
        )
      }
      const target = proposal.targets[0]!
      if (target.kind === 'player') {
        const label =
          target.ownerSeat === proposal.seat || target.instanceId === proposal.seat
            ? 'Target yourself'
            : 'Target opponent'
        await click(
          page,
          expected,
          page.getByRole('button', { name: label, exact: true }),
          `button:${label}`,
          proposal.intent,
          actions,
        )
      } else {
        await choicesById(
          page,
          proposal,
          expected,
          [target.instanceId],
          (id) => `[data-instance-id="${id}"]`,
          actions,
        )
      }
      return
    }
    case 'submit_targets':
      return promptButton(page, proposal, expected, 'Submit targets', actions)
    case 'select_n':
      await choicesById(page, proposal, expected, ids, (id) => `[data-choice-id="${id}"]`, actions)
      return promptButton(page, proposal, expected, /Submit (selection|cost)/, actions)
    case 'pay_cost':
      await choicesById(
        page,
        proposal,
        expected,
        ids,
        (id) => `[data-instance-id="${id}"]`,
        actions,
      )
      return promptButton(page, proposal, expected, /Done paying|Submit cost/, actions)
    case 'search':
      await choicesById(
        page,
        proposal,
        expected,
        proposal.responseIds,
        (id) => `[data-instance-id="${id}"]`,
        actions,
      )
      return promptButton(page, proposal, expected, 'Submit search', actions)
    case 'optional_action':
      return promptButton(page, proposal, expected, proposal.accept ? 'Accept' : 'Decline', actions)
    case 'keep_hand':
      return promptButton(page, proposal, expected, 'Keep hand', actions)
    case 'cancel':
      return promptButton(page, proposal, expected, 'Cancel', actions)
    case 'attack': {
      const opponentSeat = proposal.seat === 1 ? 2 : 1
      const opponentRecipient = `[data-recipient$=":${opponentSeat}:0"]`
      if (ids.length > 1) {
        const pending = page
          .locator(
            ids
              .map(
                (id) =>
                  `[data-option-index][data-instance-id="${id}"]${opponentRecipient}[aria-pressed="false"]`,
              )
              .join(','),
          )
          .first()
        if (await pending.isVisible().catch(() => false)) {
          return click(
            page,
            expected,
            pending,
            `attack:${await pending.getAttribute('data-instance-id')}`,
            proposal.intent,
            actions,
          )
        }
        return promptButton(page, proposal, expected, 'Submit attackers', actions)
      }
      await choicesById(
        page,
        proposal,
        expected,
        ids,
        (id) => `[data-option-index][data-instance-id="${id}"]${opponentRecipient}`,
        actions,
      )
      return
    }
    case 'submit_attackers':
      return promptButton(page, proposal, expected, 'Submit attackers', actions)
    case 'block': {
      if (proposal.blocks.length === 0) {
        return promptButton(page, proposal, expected, 'Submit blockers', actions)
      }
      let pending: (typeof proposal.blocks)[number] | undefined
      for (const assignment of proposal.blocks) {
        const selected = await page
          .locator(
            `[role="group"][data-instance-id="${assignment.blocker.instanceId}"] button[data-instance-id="${assignment.attacker.instanceId}"]`,
          )
          .getAttribute('aria-pressed')
          .catch(() => null)
        if (selected !== 'true') {
          pending = assignment
          break
        }
      }
      if (!pending) {
        return promptButton(page, proposal, expected, 'Submit blockers', actions)
      }
      const group = page.locator(`[role="group"][data-instance-id="${pending.blocker.instanceId}"]`)
      await click(
        page,
        expected,
        group.locator(`button[data-instance-id="${pending.attacker.instanceId}"]`),
        `block:${pending.blocker.instanceId}:${pending.attacker.instanceId}`,
        proposal.intent,
        actions,
      )
      return
    }
    case 'unblock':
      if (ids.length !== 1) {
        throw new DriverFailure('driver_unsupported', 'Unblock requires one blocker identity')
      }
      await choicesById(
        page,
        proposal,
        expected,
        ids,
        (id) => `[role="group"][data-instance-id="${id}"] button[aria-pressed="true"]`,
        actions,
      )
      return
    case 'submit_blockers':
      return promptButton(page, proposal, expected, 'Submit blockers', actions)
    case 'modal': {
      if (proposal.ctoId == null) {
        throw new DriverFailure('driver_unsupported', 'Modal proposal is missing ctoId')
      }
      await choicesById(
        page,
        proposal,
        expected,
        proposal.modalGrpIds,
        (id) => `[data-cto-id="${proposal.ctoId}"][data-grp-id="${id}"]`,
        actions,
      )
      const submit = page
        .locator('[data-prompt]')
        .getByRole('button', { name: 'Submit modes', exact: true })
      if (await submit.isVisible().catch(() => false)) {
        await click(page, expected, submit, 'button:Submit modes', proposal.intent, actions)
      }
      return
    }
    case 'mana_type':
      for (const choice of proposal.manaTypes) {
        await click(
          page,
          expected,
          page.locator(
            `[data-mana-choice][data-cto-id="${choice.ctoId}"] button[data-mana-color="${choice.color}"]`,
          ),
          `mana:${choice.ctoId}:${choice.color}`,
          proposal.intent,
          actions,
        )
      }
      return promptButton(page, proposal, expected, 'Submit mana choices', actions)
    case 'optional_cost':
      if (proposal.ctoId == null) {
        throw new DriverFailure('driver_unsupported', 'Optional-cost proposal is missing ctoId')
      }
      return click(
        page,
        expected,
        page.locator(`[data-prompt] button[data-cto-id="${proposal.ctoId}"]`),
        `optional-cost:${proposal.ctoId}`,
        proposal.intent,
        actions,
      )
    case 'alternate_cost': {
      if (proposal.ctoId == null || proposal.responseIds.length !== 1) {
        throw new DriverFailure(
          'driver_unsupported',
          'Alternate-cost proposal lacks exact option identity',
        )
      }
      return click(
        page,
        expected,
        page.locator(
          `[data-prompt] button[data-cto-id="${proposal.ctoId}"][data-choice-id="${proposal.responseIds[0]}"]`,
        ),
        `alternate-cost:${proposal.ctoId}:${proposal.responseIds[0]}`,
        proposal.intent,
        actions,
      )
    }
    case 'numeric':
      return executeNumeric(page, proposal, expected, actions)
    case 'order':
      await choicesById(
        page,
        proposal,
        expected,
        proposal.responseIds,
        (id) => `[data-instance-id="${id}"]`,
        actions,
      )
      return promptButton(page, proposal, expected, 'Submit order', actions)
    case 'distribute':
      return executeDistribution(page, proposal, expected, actions)
    case 'assign_damage':
      return executeCombatDamage(page, proposal, expected, actions)
    case 'group':
      if (proposal.groupAssignments.length === 0) {
        throw new DriverFailure(
          'driver_unsupported',
          'Group proposal does not identify destination groups',
        )
      }
      for (const assignment of proposal.groupAssignments) {
        for (const instanceId of assignment.instanceIds) {
          const destination = page.locator(
            `[data-prompt="group"] [data-instance-id="${instanceId}"] button[data-group-zone-type="${assignment.zoneType}"][data-group-sub-zone-type="${assignment.subZoneType}"]`,
          )
          const control = await exactControl(
            destination,
            `group:${instanceId}:${assignment.zoneType}:${assignment.subZoneType}`,
          )
          if ((await control.getAttribute('aria-pressed')) !== 'true') {
            await click(
              page,
              expected,
              destination,
              `group:${instanceId}:${assignment.zoneType}:${assignment.subZoneType}`,
              proposal.intent,
              actions,
            )
          }
        }
      }
      return promptButton(page, proposal, expected, 'Submit groups', actions)
    case 'auto_tap':
    case 'choose_starting_player':
    case 'perform':
      throw new DriverFailure(
        'driver_unsupported',
        `Visible execution is not implemented for ${proposal.intent}`,
      )
    case 'select_replacement':
      if (proposal.replacementEffectId == null) {
        throw new DriverFailure(
          'driver_unsupported',
          'Replacement proposal is missing replacementEffectId',
        )
      }
      return click(
        page,
        expected,
        page.locator(
          `[data-prompt="replacement"] [data-replacement-effect-id="${proposal.replacementEffectId}"]`,
        ),
        `replacement:${proposal.replacementEffectId}`,
        proposal.intent,
        actions,
      )
    default:
      throw new DriverFailure('driver_unsupported', `Unknown proposal intent: ${proposal.intent}`)
  }
}

async function executeCombatDamage(
  page: Page,
  proposal: CopilotProposal,
  expected: { matchId: string; horizon: DecisionHorizon },
  actions: VisibleInteraction[],
): Promise<void> {
  if (proposal.combatDamageAssignments.length === 0) {
    throw new DriverFailure(
      'driver_unsupported',
      'Combat-damage proposal does not identify exact assignments',
    )
  }
  const prompt = page.locator('[data-prompt="assignDamage"]')
  const visiblePairs = await prompt
    .locator('[data-damage-assigner-id] [data-damage-recipient-id]')
    .evaluateAll((rows) =>
      rows.map((row) => ({
        assignerId: Number(
          row.closest('[data-damage-assigner-id]')?.getAttribute('data-damage-assigner-id'),
        ),
        recipientId: Number(row.getAttribute('data-damage-recipient-id')),
      })),
    )
  const requested = proposal.combatDamageAssignments.flatMap((assigner) =>
    assigner.recipients.map((recipient) => ({
      assignerId: assigner.assignerId,
      recipientId: recipient.recipientId,
      amount: recipient.amount,
    })),
  )
  const pairKey = (value: { assignerId: number; recipientId: number }) =>
    `${value.assignerId}:${value.recipientId}`
  const visibleKeys = visiblePairs.map(pairKey).sort()
  const requestedKeys = requested.map(pairKey).sort()
  if (
    new Set(visibleKeys).size !== visibleKeys.length ||
    new Set(requestedKeys).size !== requestedKeys.length ||
    visibleKeys.join() !== requestedKeys.join()
  ) {
    throw new DriverFailure(
      'driver_unsupported',
      'Combat-damage proposal does not match the complete visible assignment map',
      { visiblePairs, requested },
    )
  }
  const pending: Array<{ assignment: (typeof requested)[number]; current: number }> = []
  for (const assignment of requested) {
    if (!Number.isSafeInteger(assignment.amount) || assignment.amount < 0) {
      throw new DriverFailure(
        'driver_unsupported',
        'Combat-damage proposal contains an invalid amount',
        { assignment },
      )
    }
    const row = prompt.locator(
      `[data-damage-assigner-id="${assignment.assignerId}"] [data-damage-recipient-id="${assignment.recipientId}"]`,
    )
    const currentAttribute = await row.getAttribute('data-assigned-damage')
    if (currentAttribute == null) {
      throw new DriverFailure('ui_missing', 'Combat-damage control has no current amount', {
        assignment,
      })
    }
    const current = Number(currentAttribute)
    if (!Number.isSafeInteger(current) || current < 0) {
      throw new DriverFailure('ui_missing', 'Combat-damage control has no valid current amount', {
        assignment,
      })
    }
    pending.push({ assignment, current })
  }
  const adjust = async (entry: (typeof pending)[number], direction: 1 | -1): Promise<void> => {
    const { assignment } = entry
    const row = prompt.locator(
      `[data-damage-assigner-id="${assignment.assignerId}"] [data-damage-recipient-id="${assignment.recipientId}"]`,
    )
    let { current } = entry
    while (current !== assignment.amount) {
      const control =
        direction > 0
          ? row.locator('button[aria-label^="Assign 1 damage to "]')
          : row.locator('button[aria-label^="Remove 1 damage from "]')
      await click(
        page,
        expected,
        control,
        `combat-damage:${assignment.assignerId}:${assignment.recipientId}:${direction > 0 ? '+' : '-'}1`,
        proposal.intent,
        actions,
      )
      const updated = Number(await row.getAttribute('data-assigned-damage'))
      if (updated !== current + direction) {
        throw new DriverFailure('stalled', 'Combat-damage control did not change by one', {
          assignment,
          current,
          updated,
          interactions: actions,
        })
      }
      current = updated
    }
  }
  for (const entry of pending.filter(({ assignment, current }) => assignment.amount < current)) {
    await adjust(entry, -1)
  }
  for (const entry of pending.filter(({ assignment, current }) => assignment.amount > current)) {
    await adjust(entry, 1)
  }
  const finalAssignments = await prompt
    .locator('[data-damage-assigner-id] [data-damage-recipient-id]')
    .evaluateAll((rows) =>
      rows.map((row) => ({
        assignerId: Number(
          row.closest('[data-damage-assigner-id]')?.getAttribute('data-damage-assigner-id'),
        ),
        recipientId: Number(row.getAttribute('data-damage-recipient-id')),
        amount: Number(row.getAttribute('data-assigned-damage')),
      })),
    )
  const finalKeys = finalAssignments.map(pairKey).sort()
  if (
    new Set(finalKeys).size !== finalKeys.length ||
    finalKeys.join() !== requestedKeys.join() ||
    finalAssignments.some(
      (actual) =>
        requested.find((item) => pairKey(item) === pairKey(actual))?.amount !== actual.amount,
    )
  ) {
    throw new DriverFailure(
      'stalled',
      'Visible combat-damage assignments do not match the advisor proposal',
      { requested, finalAssignments, interactions: actions },
    )
  }
  return promptButton(page, proposal, expected, 'Assign damage', actions)
}

async function executeNumeric(
  page: Page,
  proposal: CopilotProposal,
  expected: { matchId: string; horizon: DecisionHorizon },
  actions: VisibleInteraction[],
): Promise<void> {
  if (proposal.numericValue == null) {
    throw new DriverFailure('driver_unsupported', 'Numeric proposal is missing numericValue')
  }
  const currentLabel = await page
    .locator('[data-prompt] [aria-label^="X is "]')
    .getAttribute('aria-label')
    .catch(() => null)
  if (!currentLabel) {
    if (proposal.ctoId != null) {
      return click(
        page,
        expected,
        page.locator(
          `[data-prompt] button[data-cto-id="${proposal.ctoId}"][data-choice-id="${proposal.numericValue}"]`,
        ),
        `numeric:${proposal.numericValue}`,
        proposal.intent,
        actions,
      )
    }
    throw new DriverFailure('ui_missing', 'Numeric value control is missing')
  }
  let current = Number(currentLabel.replace('X is ', ''))
  const direction = proposal.numericValue > current ? 1 : -1
  while (current !== proposal.numericValue) {
    const label = direction > 0 ? 'Increase X' : 'Decrease X'
    await promptButton(page, proposal, expected, label, actions)
    const updated = await page
      .locator('[data-prompt] [aria-label^="X is "]')
      .getAttribute('aria-label')
    const next = Number(updated?.replace('X is ', ''))
    if (!Number.isFinite(next) || next === current) {
      throw new DriverFailure('stalled', `Numeric control did not advance from ${current}`)
    }
    current = next
    if (
      (direction > 0 && current > proposal.numericValue) ||
      (direction < 0 && current < proposal.numericValue)
    ) {
      throw new DriverFailure(
        'driver_unsupported',
        `Numeric step skipped requested value ${proposal.numericValue}`,
      )
    }
  }
  return promptButton(page, proposal, expected, `Choose X = ${proposal.numericValue}`, actions)
}

async function executeDistribution(
  page: Page,
  proposal: CopilotProposal,
  expected: { matchId: string; horizon: DecisionHorizon },
  actions: VisibleInteraction[],
): Promise<void> {
  for (const amount of proposal.distribution) {
    const row = page.locator(
      `[data-prompt="distribution"] [data-instance-id="${amount.instanceId}"]`,
    )
    const value = Number(
      await row
        .locator('strong')
        .textContent()
        .catch(() => Number.NaN),
    )
    if (!Number.isFinite(value)) {
      throw new DriverFailure(
        'ui_missing',
        `Distribution row ${amount.instanceId} has no current amount`,
      )
    }
    const delta = amount.amount - value
    for (let index = 0; index < Math.abs(delta); index += 1) {
      const label = new RegExp(`^${delta > 0 ? 'Assign' : 'Remove'} 1 (to|from) `)
      await click(
        page,
        expected,
        row.getByRole('button', { name: label }),
        `distribution:${amount.instanceId}:${delta > 0 ? '+' : '-'}1`,
        proposal.intent,
        actions,
      )
    }
  }
  return promptButton(page, proposal, expected, 'Submit distribution', actions)
}

export async function executeProposal(
  page: Page,
  proposal: CopilotProposal,
  expected: { matchId: string; horizon: DecisionHorizon; deadline?: number },
): Promise<{ actions: VisibleInteraction[] }> {
  if (proposal.intent === 'unrealizable') {
    throw new DriverFailure(
      'advisor_unavailable',
      proposal.reason ?? 'Advisor returned an unrealizable proposal',
      { proposal },
    )
  }
  if (
    proposal.promptKey !== expected.horizon.promptKey ||
    proposal.gameStateId !== expected.horizon.gameStateId ||
    proposal.respId !== expected.horizon.respId
  ) {
    throw new DriverFailure(
      'advisor_unavailable',
      'Advisor response does not match the requested decision horizon',
      { expected: expected.horizon, proposal },
    )
  }
  await requireHorizon(page, expected.matchId, expected.horizon)
  const actions: VisibleInteraction[] = []
  try {
    if (proposal.intent === 'pass') {
      const pass = page.getByRole('button', { name: /^(Pass|Resolve)$/ })
      await click(page, expected, pass, 'button:Pass', proposal.intent, actions)
    } else if (proposal.intent in ACTION_TYPES) {
      await cardAction(page, proposal, expected, actions)
    } else {
      await executePrompt(page, proposal, expected, actions)
    }
  } catch (error) {
    if (error instanceof DriverFailure) {
      throw new DriverFailure(error.classification, error.message, {
        ...error.details,
        interactions: actions,
      })
    }
    throw error
  }
  return { actions }
}
