/**
 * GRE debug bridge — exposes compact GRE match state + scripted actions on
 * `window` for AI agent tooling (Chrome DevTools MCP `evaluate_script`).
 *
 * Drives the live Leyline/GRE runtime via the `greStore` singleton.
 *
 * Usage:
 *   () => window.__greState()
 *   () => window.__greStart()                       // default Goblin/Shock vs Plains
 *   () => window.__greStart({ seat1Deck, seat2Deck })
 *   () => window.__greActWait('pass')
 *   () => window.__greActWait('land', 'Mountain')
 *   () => window.__greActWait('cast', 'Shock')      // then 'target'
 *   () => window.__greActWait('target', 'AI') / ('target', <iid>)
 *   () => window.__greActWait('attacker', 'Raging Goblin'); ('submitAttackers')
 *   () => window.__greActWait('keep') / ('mull')
 */

import { greStore } from '@engine/runtime/gre-store'
import { greSession } from '@engine/runtime/gre-session'
import { enumValue } from '@engine/wire/gre-proto'
import type { GreStartConfig } from '@engine/runtime/start'
import { DEFAULT_GRE_OPPONENT_DECK, DEFAULT_GRE_PLAYER_DECK } from '@engine/runtime/gre-match'
import { promptOptionSummaries } from '@engine/state/gre-prompt-view'
import {
  ACTION_ACTIVATE,
  ACTION_CAST,
  ACTION_PLAY,
  type CardView,
  type LegalAction,
} from '@engine/state/gre-state'
import type {
  GreDebugCard,
  GreDebugDiagnostics,
  GreDebugEvidence,
  GreDebugPrompt,
  GreDebugResult,
  GreDebugState,
  GreDebugWindow,
} from './gre-debug-contract'

const ACTION_TIMEOUT_MS = 4000
const START_TIMEOUT_MS = 240000
const WAIT_POLL_MS = 120
const RECENT_MESSAGE_TYPES = 20
const LOCAL_INTENT_VERBS = new Set(['damage', 'group', 'selectN', 'search'])

function playFlag(c: CardView): string | undefined {
  if (c.playableLand) {
    return 'land'
  }
  if (c.playableSpell) {
    return 'spell'
  }
  if (c.playableActivation) {
    return 'activate'
  }
  return undefined
}

function handCard(c: CardView): GreDebugCard {
  return {
    iid: c.instanceId,
    name: c.name,
    mana: c.manaCost || undefined,
    pt: c.powerToughness || undefined,
    play: playFlag(c),
  }
}

function boardCard(c: CardView): GreDebugCard {
  const out: GreDebugCard = { iid: c.instanceId, name: c.name }
  if (c.powerToughness) {
    out.pt = c.powerToughness
  }
  if (c.tapped) {
    out.tapped = true
  }
  if (c.attacking) {
    out.atk = true
  }
  if (c.playableActivation) {
    out.play = 'activate'
  }
  if (c.roomDoors) {
    out.roomDoors = c.roomDoors
  }
  return out
}

function compactPrompt(): GreDebugPrompt | null {
  const p = greStore.prompt
  if (!p) {
    return null
  }
  return {
    kind: p.kind,
    interactionKey: p.interactionKey,
    message: p.message,
    canSubmit: p.canSubmit,
    waiting: p.waiting,
    options: promptOptionSummaries(p),
  }
}

function diagnostics(): GreDebugDiagnostics {
  return {
    lastMessage: greStore.lastMessage,
    errorCount: greStore.errorCount,
    traffic: greStore.trafficStats,
    recentTypes: greStore.messageTypeFeed.slice(-RECENT_MESSAGE_TYPES),
  }
}

function evidence(): GreDebugEvidence {
  return {
    gsId: greStore.gameStateId,
    prompt: compactPrompt(),
    status: greStore.status,
    connected: greStore.connected,
    diagnostics: diagnostics(),
  }
}

function greState(): GreDebugState | null {
  if (!greStore.connected && greStore.status === 'idle') {
    return null
  }
  const opp = greStore.opponent
  const presentationLagging = greStore.snapshot().presentation?.lagging === true
  const positionKey = JSON.stringify({
    turn: greStore.turnNumber,
    phase: greStore.phaseName,
    step: greStore.stepName,
    life: [greStore.viewer.lifeTotal, opp?.lifeTotal ?? 0],
    hand: greStore.hand.map((card) => card.instanceId),
    board: [greStore.battlefield.map(boardCard), greStore.opponentBattlefield.map(boardCard)],
    stack: greStore.stack.map((card) => card.instanceId),
    prompt: greStore.prompt?.kind ?? null,
  })
  return {
    matchId: greStore.currentMatchId,
    horizon: greStore.decisionHorizon,
    presentationLagging,
    positionKey,
    status: greStore.status,
    connected: greStore.connected,
    diagnostics: diagnostics(),
    gameOver: greStore.gameOver,
    turn: greStore.turnNumber,
    phase: greStore.phaseName,
    step: greStore.stepName,
    activeSeat: greStore.activeSeatId,
    prioritySeat: greStore.prioritySeatId,
    viewerSeat: greStore.viewerSeatId,
    gsId: greStore.gameStateId,
    life: { you: greStore.viewer.lifeTotal, opp: opp?.lifeTotal ?? 0 },
    counts: {
      you: greStore.viewerZoneCounts(),
      opp: opp
        ? {
            hand: opp.handCount,
            library: opp.libraryCount,
            graveyard: opp.graveyardCount,
            exile: opp.exileCount,
          }
        : null,
    },
    hand: greStore.hand.map(handCard),
    board: {
      you: greStore.battlefield.map(boardCard),
      opp: greStore.opponentBattlefield.map(boardCard),
    },
    stack: greStore.stack.map((c) => c.name),
    prompt: compactPrompt(),
    actions: greStore.legalActions.map((a) => a.label),
    annotations: greStore.annotationHistory,
    logs: greStore.logs.slice(0, 20),
    outcome: greStore.outcome
      ? { title: greStore.outcome.title, result: greStore.outcome.viewerResult }
      : null,
  }
}

/** Resolve a card by instance id (number) or name (case-insensitive substring). */
function resolveCard(list: readonly CardView[], arg: string | number | undefined): CardView | null {
  if (arg == null) {
    return null
  }
  if (typeof arg === 'number') {
    return list.find((c) => c.instanceId === arg) ?? null
  }
  const lower = arg.toLowerCase()
  return (
    list.find((c) => c.name.toLowerCase() === lower) ??
    list.find((c) => c.name.toLowerCase().includes(lower)) ??
    null
  )
}

function exactCardAction(card: CardView, actionType: number): LegalAction | string {
  const actions = greStore.legalActions.filter(
    (action) => action.instanceId === card.instanceId && action.actionType === actionType,
  )
  if (actions.length === 1) {
    return actions[0]!
  }
  if (actions.length === 0) {
    return `No matching action for ${card.name}`
  }
  return `Multiple actions for ${card.name}; use the action verb with an exact label`
}

async function dispatch(verb: string, args: (string | number)[]): Promise<GreDebugResult> {
  const p = greStore.prompt
  const [a0, a1] = args
  switch (verb) {
    case 'start':
      return greStart(typeof a0 === 'string' ? JSON.parse(a0) : undefined)
    case 'disconnect':
      greStore.disconnect()
      return ok()
    case 'concede':
      await greStore.concede()
      return ok()
    case 'pass':
      await greStore.passPriority()
      return ok()
    case 'land': {
      const c = resolveCard(greStore.hand, a0)
      if (!c) {
        return err(`Land not found: ${a0}`)
      }
      const action = exactCardAction(c, ACTION_PLAY)
      if (typeof action === 'string') {
        return err(action)
      }
      await greStore.performLegalAction(action)
      return ok()
    }
    case 'cast': {
      const c = resolveCard(greStore.hand, a0)
      if (!c) {
        return err(`Spell not found: ${a0}`)
      }
      const action = exactCardAction(c, ACTION_CAST)
      if (typeof action === 'string') {
        return err(action)
      }
      await greStore.performLegalAction(action)
      return ok()
    }
    case 'activate': {
      const c = resolveCard([...greStore.battlefield, ...greStore.hand], a0)
      if (!c) {
        return err(`Card not found: ${a0}`)
      }
      const action = exactCardAction(c, ACTION_ACTIVATE)
      if (typeof action === 'string') {
        return err(action)
      }
      await greStore.performLegalAction(action)
      return ok()
    }
    case 'action': {
      const matches =
        typeof a0 === 'number'
          ? greStore.legalActions.slice(a0, a0 + 1)
          : greStore.legalActions.filter(
              (action) => action.label.toLowerCase() === String(a0).toLowerCase(),
            )
      if (matches.length === 0) {
        return err(`No exact action: ${a0}`)
      }
      if (matches.length > 1) {
        return err(`Multiple exact actions: ${a0}; use the action index`)
      }
      const v = matches[0]!
      await greStore.performLegalAction(v)
      return ok()
    }
    case 'target': {
      if (p?.kind !== 'targets') {
        return err('No target prompt active')
      }
      const t = (p.candidates ?? []).find((c) =>
        typeof a0 === 'number'
          ? c.targetInstanceId === a0
          : c.name.toLowerCase().includes(String(a0).toLowerCase()),
      )
      if (!t) {
        return err(`Target not found: ${a0}`)
      }
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'targets' && binding.controls && (await binding.controls.choose(t))
        ? ok()
        : err('Target unavailable')
    }
    case 'attacker': {
      if (p?.kind !== 'attackers') {
        return err('No attackers prompt active')
      }
      const c = (p.attackers ?? []).find((x) =>
        typeof a0 === 'number'
          ? x.attackerInstanceId === a0
          : x.name.toLowerCase().includes(String(a0).toLowerCase()),
      )
      if (!c) {
        return err(`Attacker not found: ${a0}`)
      }
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'attackers' && binding.controls && (await binding.controls.choose(c))
        ? ok()
        : err('Attacker unavailable')
    }
    case 'attackAll': {
      if (p?.kind !== 'attackers') {
        return err('No attackers prompt active')
      }
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'attackers' && binding.controls && (await binding.controls.all())
        ? ok()
        : err('Attackers unavailable')
    }
    case 'submitAttackers': {
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'attackers' && binding.controls && (await binding.controls.submit())
        ? ok()
        : err('Attackers unavailable')
    }
    case 'block': {
      if (p?.kind !== 'blockers') {
        return err('No blockers prompt active')
      }
      const b = (p.blockers ?? []).find((x) =>
        typeof a0 === 'number'
          ? x.blockerInstanceId === a0
          : x.blockerName.toLowerCase().includes(String(a0).toLowerCase()),
      )
      if (!b) {
        return err(`Blocker not found: ${a0}`)
      }
      const atk = b.attackers.find((x) =>
        typeof a1 === 'number'
          ? x.attackerInstanceId === a1
          : x.name.toLowerCase().includes(String(a1 ?? '').toLowerCase()),
      )
      if (!atk) {
        return err(`Attacker to block not found: ${a1}`)
      }
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'blockers' &&
        binding.controls &&
        (await binding.controls.choose(b, atk.attackerInstanceId))
        ? ok()
        : err('Blocker unavailable')
    }
    case 'submitBlockers': {
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'blockers' && binding.controls && (await binding.controls.submit())
        ? ok()
        : err('Blockers unavailable')
    }
    case 'damage': {
      if (p?.kind !== 'assignDamage') {
        return err('No damage prompt active')
      }
      const assigner = p.damageAssigners?.[Number(a0)]
      const assignment = assigner?.assignments[Number(a1)]
      if (!assigner || !assignment) {
        return err(`damage <assignerIdx> <assignmentIdx> <delta> — bad index`)
      }
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'assignDamage' &&
        binding.controls?.adjust(assigner, assignment, Number(args[2] ?? 1))
        ? ok()
        : err('Damage choice unavailable')
    }
    case 'submitDamage': {
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'assignDamage' &&
        binding.controls &&
        (await binding.controls.submit())
        ? ok()
        : err('Damage assignment unavailable')
    }
    case 'group': {
      if (p?.kind !== 'group') {
        return err('No group prompt active')
      }
      const cand = p.groupCandidates[Number(a0)]
      if (!cand) {
        return err('group <candidateIdx> <specIdx> — bad index')
      }
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'group' && binding.controls?.move(cand.instanceId, Number(a1 ?? 0))
        ? ok()
        : err('Group choice unavailable')
    }
    case 'submitGroups': {
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'group' && (await binding.controls?.submit())
        ? ok()
        : err('Group submission unavailable')
    }
    case 'casting': {
      if (p?.kind !== 'castingOptions') {
        return err('No casting prompt active')
      }
      const binding = greStore.bindPrompt(p)
      if (binding?.kind !== 'castingOptions' || !binding.controls) {
        return err('Casting controls unavailable')
      }
      const controls = binding.controls
      const opt =
        typeof a0 === 'number'
          ? p.castingOptions?.[a0]
          : p.castingOptions?.find((o) => o.label.toLowerCase().includes(String(a0).toLowerCase()))
      if (!opt) {
        return err(`Casting option not found: ${a0}`)
      }
      if (opt.modalOptions.length > 0 && a1 != null) {
        const m = opt.modalOptions.find((x) =>
          x.label.toLowerCase().includes(String(a1).toLowerCase()),
        )
        if (!m) {
          return err(`Casting mode not found: ${a1}`)
        }
        if (!m.available) {
          return err(`Casting mode is unavailable: ${m.label}`)
        }
        if (!m.selectable) {
          const selectedCount = opt.modalOptions.reduce(
            (count, modal) => count + (modal.selectedCount ?? Number(modal.selected)),
            0,
          )
          return err(
            opt.maxSelect > 0 && selectedCount >= opt.maxSelect
              ? `Choose at most ${opt.maxSelect} casting modes`
              : `Casting mode cannot be paid with the current selection: ${m.label}`,
          )
        }
        if (opt.maxSelect > 1) {
          return (
            opt.repeatsAllowed
              ? controls.adjustModalOption(opt, m, 1)
              : controls.toggleModalOption(opt, m)
          )
            ? ok(true)
            : err('Casting mode selection is stale or waiting')
        }
        return (await controls.chooseModalOption(opt, m))
          ? ok()
          : err('Casting mode selection is stale or waiting')
      }
      if (opt.selectNOptions.length > 0 && a1 != null) {
        const s = opt.selectNOptions.find((x) =>
          x.label.toLowerCase().includes(String(a1).toLowerCase()),
        )
        if (!s) {
          return err(`Casting choice not found: ${a1}`)
        }
        return (await controls.chooseCastingOptionSelect(opt, s))
          ? ok()
          : err('Casting choice is stale or waiting')
      }
      if (opt.maxSelect > 1) {
        const selectedCount = opt.modalOptions.reduce(
          (count, modal) => count + (modal.selectedCount ?? Number(modal.selected)),
          0,
        )
        if (selectedCount < opt.minSelect || selectedCount > opt.maxSelect) {
          return err(`Choose ${opt.minSelect}–${opt.maxSelect} modes before submitting`)
        }
        if (!opt.selectionPayable) {
          return err('Selected casting modes cannot be paid together')
        }
        return (await controls.submitModalOptions(opt))
          ? ok()
          : err('Casting selection is stale or already submitting')
      }
      return (await controls.chooseCastingOption(opt))
        ? ok()
        : err('Casting option is stale or waiting')
    }
    case 'selectN': {
      if (p?.kind !== 'selectN') {
        return err('No selectN prompt active')
      }
      const c = (p.selectNCandidates ?? []).find((x) =>
        typeof a0 === 'number'
          ? x.instanceId === a0
          : x.name.toLowerCase().includes(String(a0).toLowerCase()),
      )
      if (!c) {
        return err(`selectN candidate not found: ${a0}`)
      }
      const binding = greStore.bindPrompt(p)
      if (binding?.kind !== 'selectN' || !binding.controls?.toggle(c)) {
        return err('Selection unavailable')
      }
      return ok()
    }
    case 'submitSelectN': {
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'selectN' && (await binding.controls?.submit())
        ? ok()
        : err('Selection unavailable')
    }
    case 'search': {
      if (p?.kind !== 'search') {
        return err('No search prompt active')
      }
      const c = (p.searchCandidates ?? []).find((x) =>
        typeof a0 === 'number'
          ? x.instanceId === a0
          : x.name.toLowerCase().includes(String(a0).toLowerCase()),
      )
      if (!c) {
        return err(`search candidate not found: ${a0}`)
      }
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'search' && binding.controls?.toggle(c.instanceId)
        ? ok()
        : err('Search choice is stale or unavailable')
    }
    case 'submitSearch': {
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'search' && (await binding.controls?.submit())
        ? ok()
        : err('Search is stale or unavailable')
    }
    case 'failSearch': {
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'search' && (await binding.controls?.fail())
        ? ok()
        : err('Search cannot fail to find')
    }
    case 'optional': {
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'optionalAction' &&
        (await binding.controls?.respond(a0 === 'true' || a0 === 'accept' || a0 === 1))
        ? ok()
        : err('Optional action is stale or unavailable')
    }
    case 'keep':
    case 'mull': {
      const binding = greStore.bindPrompt(p)
      return binding?.kind === 'mulligan' &&
        (await binding.controls?.[verb === 'keep' ? 'keep' : 'mulligan']())
        ? ok()
        : err('Opening hand is stale or unavailable')
    }
    default:
      return err(`Unknown verb: ${verb}`)
  }
}

function ok(local = false): GreDebugResult {
  return { ok: true, ...(local ? { local: true } : {}), state: greState() }
}
function err(error: string): GreDebugResult {
  return { ok: false, error, state: greState() }
}

async function greAct(verb: string, ...args: (string | number)[]): Promise<GreDebugResult> {
  try {
    return await dispatch(verb, args)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = WAIT_POLL_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    if (predicate()) {
      return true
    }
  }
  return false
}

export function stallResult(
  operation: string,
  before: GreDebugEvidence,
  after: GreDebugEvidence,
  timeoutMs: number,
): GreDebugResult {
  return {
    ok: false,
    error: `${operation} made no observable progress within ${timeoutMs}ms`,
    state: greState(),
    before,
    after,
  }
}

/** Fire an action, then poll until the server advances observable match state. */
async function greActWaitFor(
  verb: string,
  args: (string | number)[],
  timeoutMs: number,
  pollMs = WAIT_POLL_MS,
): Promise<GreDebugResult> {
  const before = evidence()
  const gameOverBefore = greStore.gameOver
  const result = await greAct(verb, ...args)
  if (!result.ok) {
    return result
  }
  if (result.local || LOCAL_INTENT_VERBS.has(verb)) {
    return { ...result, state: greState(), before, after: evidence() }
  }
  const promptAfterDispatch = greStore.prompt
  const recvMessagesAfterDispatch = greStore.trafficStats.recvMessages
  const settled = await waitUntil(
    () =>
      greStore.gameStateId !== before.gsId ||
      greStore.connected !== before.connected ||
      greStore.gameOver !== gameOverBefore ||
      greStore.errorCount > before.diagnostics.errorCount ||
      (greStore.trafficStats.recvMessages > recvMessagesAfterDispatch &&
        greStore.prompt !== promptAfterDispatch),
    timeoutMs,
    pollMs,
  )
  if (!settled) {
    return stallResult(`Action ${verb}`, before, evidence(), timeoutMs)
  }
  const after = evidence()
  if (after.diagnostics.errorCount > before.diagnostics.errorCount) {
    return { ok: false, error: `Action ${verb} was rejected`, state: greState(), before, after }
  }
  if (before.connected && !after.connected && !greStore.gameOver) {
    return {
      ok: false,
      error: `Action ${verb} lost the GRE connection`,
      state: greState(),
      before,
      after,
    }
  }
  return { ok: true, state: greState(), before, after }
}

/** Boot a match. Defaults to the Goblin/Shock (combat + stack + targeting) vs Plains scenario. */
async function greStart(
  config?: GreStartConfig,
  timeoutMs = START_TIMEOUT_MS,
  pollMs = 150,
): Promise<GreDebugResult> {
  const before = evidence()
  const deadline = Date.now() + timeoutMs
  const abort = new AbortController()
  try {
    const cfg: GreStartConfig = {
      seat1Deck: DEFAULT_GRE_PLAYER_DECK,
      seat2Deck: DEFAULT_GRE_OPPONENT_DECK,
      ...config,
    }
    greSession.startBrowser({ ...cfg, gameType: cfg.gameType ?? 'constructed' }, false)
    const start = greSession.connectBrowser(greSession.config!, abort.signal)
    let timer: ReturnType<typeof setTimeout> | undefined
    let completed: boolean
    try {
      completed = await Promise.race([
        start.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs)
        }),
      ])
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
    if (!completed) {
      abort.abort()
      greStore.disconnect()
      void start.catch(() => undefined)
      return stallResult('Start', before, evidence(), timeoutMs)
    }
    const remainingMs = Math.max(0, deadline - Date.now())
    const ready =
      remainingMs > 0 &&
      (await waitUntil(
        () =>
          greStore.gameOver ||
          (greStore.connected && Boolean(greStore.prompt || greStore.hand.length > 0)),
        remainingMs,
        pollMs,
      ))
    if (!ready) {
      abort.abort()
      greStore.disconnect()
      return stallResult('Start', before, evidence(), timeoutMs)
    }
    return { ok: true, state: greState(), before, after: evidence() }
  } catch (e) {
    if (abort.signal.aborted) {
      return stallResult('Start', before, evidence(), timeoutMs)
    }
    return { ok: false, error: String(e), state: greState(), before, after: evidence() }
  }
}

declare global {
  interface Window extends GreDebugWindow {}
}

export function installGreDebugBridge(
  options: { actionTimeoutMs?: number; startTimeoutMs?: number; pollMs?: number } = {},
): void {
  window.__greState = greState
  window.__greEnumValue = enumValue
  window.__greAct = greAct
  window.__greActWait = (verb, ...args) =>
    greActWaitFor(
      verb,
      args,
      options.actionTimeoutMs ?? ACTION_TIMEOUT_MS,
      options.pollMs ?? WAIT_POLL_MS,
    )
  window.__greStart = (config) => greStart(config, options.startTimeoutMs, options.pollMs)
  window.__greBrowserAdvice = () => greSession.browserAdvice()
  window.__greBrowserDiagnostics = () => greSession.browserDiagnostics()
}
