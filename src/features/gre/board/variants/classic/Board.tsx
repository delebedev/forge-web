import type { PromptBinding } from '@engine/runtime/prompts/family'
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { computeArrows } from '@engine/state/arrow-view'
import type { CardView, LegalAction } from '@engine/state/gre-state'
import type { PresentationMotionKind } from '@engine/state/presentation-policy'
import { legalActionKey } from '@engine/state/gre-state'
import type { BoardSnapshot } from '@engine/runtime/snapshot'
import { cx } from '@shared/react/cx'
import { BoardConnectionDetails } from '@shell/chrome/BoardConnectionDetails'
import { PromptDock } from '../../../prompts/PromptDock'
import { ActionButton } from '../../ActionButton'
import { ArrowLayer } from '../../ArrowLayer'
import { BoardSettings, useBoardView } from '../../BoardSettings'
import { GameLogDrawer } from '../../GameLogDrawer'
import {
  attachmentsOf,
  lanesOf,
  pilesOf,
  soloPilesOf,
  tappedManaCountOf,
  visibleStackOf,
} from '../../board-derive'
import type { BoardInteractions } from '../../board-interactions'
import { Card } from '../../Card'
import { CardPreview } from '../../CardPreview'
import { HandFan } from '../../HandFan'
import { NonHandActionRail, nonHandActionEntries } from '../../NonHandActionRail'
import { OppHandFan } from '../../OppHandFan'
import { PhaseRail } from '../../PhaseRail'
import { PlayerPlate } from '../../PlayerPlate'
import { StackPanel } from '../../StackPanel'
import { ZoneMotionLayer } from '../../ZoneMotionLayer'
import type { ZoneViewerState } from '../../types'
import { ZoneViewer } from '../../ZoneViewer'
import styles from './Board.module.css'
import '@shared/public-theme.css'

export type BoardProps = {
  board: BoardSnapshot
  interactive: boolean
  inputEnabled?: boolean
  replay?: boolean
  embedded: boolean
  interactions: BoardInteractions
  stops: Set<string>
  canRespond: boolean
  passing: boolean
  fullControl?: boolean
  onFullControl?: (enabled: boolean) => void
  onCancelYield?: () => void
  onToggleStop: (key: string) => void
  onPassPriority: () => void
  onResolveAll: () => void
  onEndTurn: () => void
  onLegalAction: (action: LegalAction) => void
  promptBinding?: PromptBinding | null
  hoveredCard: CardView | null
  onHover: (card: CardView | null) => void
  zoneViewer: ZoneViewerState
  onOpenZone: (title: string, cards: CardView[], source?: 'library-top' | 'opponent-hand') => void
  onCloseZone: () => void
  dropZoneRef: (el: HTMLElement | null) => void
  onBackToPlay?: () => void
  onPlayAgain?: () => void
  context?: { label: string; objective: string; turns?: number }
  backLabel?: string
  playAgainLabel?: string
  fullGameHref?: string
  outcomeExtra?: ReactNode
  bugReport?: { url: string; onOpen: () => void }
}

function supportGroupStyle(count: number, availableCqw: number): CSSProperties | undefined {
  if (count <= 3) {
    return undefined
  }
  const columns = Math.ceil(count / 2)
  return {
    '--support-card-max': `calc(${availableCqw / columns}cqw - 8px)`,
  } as CSSProperties
}

export function Board({
  board,
  interactive,
  inputEnabled = interactive && board.connected && !board.connectionClose && !board.gameOver,
  replay = false,
  embedded,
  interactions,
  stops,
  canRespond,
  passing,
  fullControl,
  onFullControl,
  onCancelYield,
  onToggleStop,
  onPassPriority,
  onResolveAll,
  onEndTurn,
  onLegalAction,
  promptBinding,
  hoveredCard,
  onHover,
  zoneViewer,
  onOpenZone,
  onCloseZone,
  dropZoneRef,
  onBackToPlay,
  onPlayAgain,
  context,
  backLabel = 'Back to Play',
  playAgainLabel = 'Play Again',
  fullGameHref,
  outcomeExtra,
  bugReport,
}: BoardProps) {
  const [gameLogOpen, setGameLogOpen] = useState(false)
  const showPrompt = Boolean((inputEnabled || replay) && board.prompt)
  const outcome = board.outcome
  const outcomeDialogRef = useRef<HTMLDialogElement>(null)
  const [actionCard, setActionCard] = useState<CardView | null>(null)
  const motionRootRef = useRef<HTMLElement>(null)
  const visibleStack = visibleStackOf(board)
  const attachments = attachmentsOf([...board.battlefield, ...board.opponentBattlefield])
  const attachedIds = new Set([...attachments.values()].flat().map((card) => card.instanceId))
  const attachmentHosts = new Set([
    ...attachments.keys(),
    ...(board.prompt?.kind === 'targets' ? board.prompt.candidates : []).map(
      (candidate) => candidate.targetInstanceId,
    ),
  ])
  const self = lanesOf(board.battlefield.filter((card) => !attachedIds.has(card.instanceId)))
  const opponent = lanesOf(
    board.opponentBattlefield.filter((card) => !attachedIds.has(card.instanceId)),
  )
  const selfLands = pilesOf(self.lands, attachmentHosts)
  const selfCreatures = soloPilesOf(self.creatures)
  // Solo for now: grouping these is the token-stacking question, still open.
  const selfPermanents = soloPilesOf(self.permanents)
  const opponentLands = pilesOf(opponent.lands, attachmentHosts)
  const opponentCreatures = soloPilesOf(opponent.creatures)
  const opponentPermanents = soloPilesOf(opponent.permanents)
  const tappedManaCount = tappedManaCountOf(board)
  const selectedTargets =
    board.prompt?.kind === 'targets' && board.prompt.source
      ? (board.prompt.candidates ?? [])
          .filter((candidate) => candidate.selected)
          .map((candidate) => ({
            id: `selection-${candidate.targetIdx}-${candidate.targetInstanceId}`,
            kind: 'targetSpec' as const,
            from: String(board.prompt!.source!.instanceId),
            to:
              candidate.targetInstanceId === board.viewerSeatId
                ? 'self'
                : candidate.targetInstanceId === board.opponentSeatId
                  ? 'opponent'
                  : String(candidate.targetInstanceId),
          }))
      : []
  const arrows = [
    ...computeArrows(
      board.prompt?.kind,
      interactions.declaredAttackers,
      interactions.blockAssignments,
    ),
    ...board.targetArrows,
    ...selectedTargets,
  ]
  const view = useBoardView()
  const yourTurn = board.activeSeatId === board.viewerSeatId
  const nonHandEntries = nonHandActionEntries(board)
  const visibleCardIds = new Set(
    [...board.hand, ...board.battlefield].map((card) => card.instanceId),
  )
  const visibleActionKeys = new Set(
    inputEnabled
      ? [
          ...nonHandEntries.flatMap((entry) => entry.actions.map(legalActionKey)),
          ...board.legalActions
            .filter((action) => visibleCardIds.has(action.instanceId))
            .map(legalActionKey),
        ]
      : [],
  )
  const actionChoices = actionCard ? actionsForCard(board.legalActions, actionCard.instanceId) : []
  const motionFor = (instanceId: number): PresentationMotionKind | undefined =>
    board.presentation?.hints.find((hint) => hint.affectedIds.includes(instanceId))?.kind
  const turnMotion = board.presentation?.hints.some((hint) => hint.kind === 'turn')
  const canEndMatch =
    interactive &&
    Boolean(board.currentMatchId) &&
    !board.gameOver &&
    board.currentGameType !== 'puzzle' &&
    board.currentGameType !== 'spectator' &&
    (!board.connectionClose || board.connectionClose.category === 'transient')

  function offerCardActions(card: CardView): void {
    const actions = actionsForCard(board.legalActions, card.instanceId)
    if (actions.length === 1) {
      onLegalAction(actions[0]!)
    } else if (actions.length > 1) {
      setActionCard(card)
    }
  }

  function cardState(card: CardView) {
    if (!inputEnabled) {
      return {
        selectable: false,
        selected: false,
        disabled: true,
        actions: [] as LegalAction[],
        ariaLabel: undefined,
        onClick: undefined,
      }
    }
    const state = interactions.boardCardState(card, 'self', inputEnabled)
    if (state.selectable) {
      return { ...state, actions: [] as LegalAction[], ariaLabel: undefined }
    }
    const actions = actionsForCard(board.legalActions, card.instanceId)
    return {
      ...state,
      actions,
      ariaLabel:
        actions.length === 1
          ? actions[0]!.label
          : actions.length > 1
            ? `Choose an action for ${card.name}`
            : undefined,
      disabled: !inputEnabled || board.gameOver || actions.length === 0,
      onClick: actions.length > 0 ? () => offerCardActions(card) : state.onClick,
    }
  }

  function renderPermanent(card: CardView, pileCount = 1, attachment = false): React.ReactNode {
    const own = card.controllerSeatId === board.viewerSeatId
    const state = own ? cardState(card) : interactions.boardCardState(card, 'opp', inputEnabled)
    const tile = (
      <Card
        card={card}
        pileCount={pileCount}
        attachment={attachment}
        variant={own ? 'board' : 'opponent'}
        compact={embedded}
        actionChrome={inputEnabled}
        motion={motionFor(card.instanceId)}
        {...state}
        onHover={onHover}
      />
    )
    const children = attachments.get(card.instanceId)
    if (!children?.length) {
      return tile
    }
    return (
      <div
        className={styles.attachmentGroup}
        data-attachment-host={card.instanceId}
        role="group"
        aria-label={`Attachments on ${card.name}`}
      >
        {children.map((child) => (
          <div key={child.instanceId} className={styles.attachmentSlot}>
            {renderPermanent(child, 1, true)}
          </div>
        ))}
        <div className={styles.attachmentHost}>{tile}</div>
      </div>
    )
  }

  useEffect(() => {
    const dialog = outcomeDialogRef.current
    if (!outcome || !interactive || !dialog) {
      return
    }
    dialog.showModal()
    return () => {
      if (dialog.open) {
        dialog.close()
      }
    }
  }, [interactive, outcome])

  useEffect(() => {
    if (actionCard && actionChoices.length <= 1) {
      setActionCard(null)
    }
  }, [actionCard, actionChoices.length])

  return (
    <section
      ref={motionRootRef}
      className={cx(styles.arenaBoard, embedded && styles.embedded)}
      data-replay={replay}
      data-decision={showPrompt ? board.prompt?.kind : undefined}
      data-has-stack={!view.hideStack && board.stack.length > 0}
      data-has-priority={inputEnabled && board.canPass}
      style={
        {
          '--board-card-scale': view.cardScale,
          '--board-hand-scale': view.handScale,
          '--board-hand-overlap': view.handOverlap,
          '--board-preview-scale': view.previewScale,
          '--board-player-panel-scale': view.playerPanelScale,
        } as CSSProperties
      }
      aria-label="Battlefield"
      data-board="true"
      data-card-art={view.hideCardArt ? 'off' : 'on'}
      data-challenge={context?.turns ? 'true' : undefined}
      data-turn={board.turnNumber}
      data-priority={board.prioritySeatId}
      data-stack={board.stackCount}
      data-presentation-seq={board.presentation?.seq}
      data-presentation-motion={turnMotion ? 'turn' : undefined}
    >
      <ZoneMotionLayer
        rootRef={motionRootRef}
        moves={board.presentation?.moves ?? []}
        viewerSeatId={board.viewerSeatId}
      />
      {/* Only for someone who played the game. A spectator has no "victory", and
          the surface hosting the feed names the decks instead. */}
      {outcome && interactive && (
        <div className={styles.outcomeScrim} data-outcome={outcome.viewerResult} aria-live="polite">
          <dialog
            ref={outcomeDialogRef}
            className={styles.outcomeBanner}
            aria-labelledby="match-outcome"
            aria-describedby="match-outcome-detail"
          >
            <h2 id="match-outcome">{outcome.title}</h2>
            <p id="match-outcome-detail">
              {context?.turns && outcome.viewerResult === 'loss'
                ? 'You did not find the win. Try again.'
                : outcome.detail}
            </p>
            {outcomeExtra}
            {onBackToPlay && onPlayAgain && (
              <div className={styles.outcomeActions}>
                <button
                  autoFocus
                  className={fullGameHref ? styles.outcomePrimary : styles.outcomeSecondary}
                  type="button"
                  onClick={onBackToPlay}
                >
                  {backLabel}
                </button>
                <button
                  className={fullGameHref ? styles.outcomeSecondary : styles.outcomePrimary}
                  type="button"
                  onClick={onPlayAgain}
                >
                  {playAgainLabel}
                </button>
                {fullGameHref && (
                  <a className={styles.outcomeSecondary} href={fullGameHref}>
                    Play a full game
                  </a>
                )}
              </div>
            )}
          </dialog>
        </div>
      )}

      {/* Status cluster: the only chrome, floating in the free corner. */}
      <div className={styles.statusCluster}>
        {!replay && interactive && bugReport && (
          <a
            className={styles.reportBug}
            href={bugReport.url}
            onClick={bugReport.onOpen}
            target="_blank"
            rel="noopener noreferrer"
            title="Report a bug (opens in a new tab)"
          >
            Report a bug ↗
          </a>
        )}
        {!replay && context && onPlayAgain && !board.gameOver && (
          <button className={styles.leaveMatch} type="button" onClick={onPlayAgain}>
            {playAgainLabel}
          </button>
        )}
        {!replay && onBackToPlay && (
          <button className={styles.leaveMatch} type="button" onClick={onBackToPlay}>
            ←{' '}
            {context
              ? backLabel
              : canEndMatch
                ? 'End Match'
                : board.gameOver || board.connectionClose
                  ? backLabel
                  : 'Leave Match'}
          </button>
        )}
        {!replay && !board.connected && !board.gameOver && (
          <div className={styles.connectionChip} role="status">
            Disconnected
          </div>
        )}
        <BoardSettings />
        <button
          className={styles.leaveMatch}
          type="button"
          aria-expanded={gameLogOpen}
          onClick={() => setGameLogOpen((open) => !open)}
        >
          Game log
        </button>
        {!replay && interactive && <BoardConnectionDetails board={board} />}
      </div>

      {gameLogOpen && (
        <GameLogDrawer entries={board.gameLog ?? []} onClose={() => setGameLogOpen(false)} />
      )}

      {context && (
        <section className={styles.matchContext} aria-label="Puzzle objective">
          <strong>{context.label}</strong>
          <span>{context.objective}</span>
          {context.turns && board.turnNumber > 0 && !outcome && (
            <span>
              {Math.max(0, context.turns - board.turnNumber + 1)}{' '}
              {context.turns - board.turnNumber + 1 === 1 ? 'turn' : 'turns'} remaining
            </span>
          )}
        </section>
      )}

      <div className={styles.matchState} aria-label="Match status" role="status">
        <span>
          {board.turnNumber > 0
            ? `Turn ${board.turnNumber}`
            : board.prompt?.kind === 'mulligan'
              ? 'Opening hand'
              : 'Preparing game'}
        </span>
        <strong>
          {board.turnNumber === 0
            ? ''
            : interactive
              ? yourTurn
                ? 'Your turn'
                : 'Opponent’s turn'
              : yourTurn
                ? 'Near side'
                : 'Far side'}
        </strong>
        <span>
          {board.phaseName === '-' ? '' : board.phaseName.replace(/Main([12])/, 'Main $1')}
          {board.stepName && board.stepName !== '-' && board.stepName !== board.phaseName
            ? ` · ${board.stepName}`
            : ''}
        </span>
      </div>
      <PhaseRail
        seat={yourTurn ? 'self' : 'opponent'}
        taking={board.turnNumber > 0}
        phaseName={board.phaseName}
        stepName={board.stepName}
        stops={stops}
        interactive={inputEnabled}
        onToggleStop={onToggleStop}
      />
      <PlayerPlate
        showLifeChange={board.turnNumber > 0}
        player={board.opponent}
        seat="opponent"
        label={interactive ? 'Opponent' : 'Far side'}
        active={board.turnNumber > 0 && !yourTurn}
        priority={
          board.connected &&
          board.opponentSeatId > 0 &&
          board.prioritySeatId === board.opponentSeatId
        }
        graveyard={board.opponentGraveyard}
        exile={board.opponentExile}
        emblems={board.opponentEmblems}
        dungeon={board.opponentDungeon}
        dungeonCard={board.opponentDungeonCard}
        hideCardArt={view.hideCardArt}
        onHover={onHover}
        target={playerTarget(board, board.opponentSeatId, inputEnabled)}
        waiting={board.prompt?.waiting}
        onTarget={
          promptBinding?.kind === 'targets' &&
          promptBinding.view === board.prompt &&
          promptBinding.controls
            ? (candidate) => void promptBinding.controls!.choose(candidate)
            : undefined
        }
        onOpenZone={onOpenZone}
      />
      <PlayerPlate
        showLifeChange={board.turnNumber > 0}
        player={board.viewer}
        seat="self"
        label={interactive ? 'You' : 'Near side'}
        active={yourTurn}
        priority={
          board.connected && board.viewerSeatId > 0 && board.prioritySeatId === board.viewerSeatId
        }
        libraryTop={board.libraryTop}
        resourceNote={
          tappedManaCount > 0
            ? `${tappedManaCount} tapped land${tappedManaCount === 1 ? '' : 's'}`
            : undefined
        }
        graveyard={board.graveyard}
        exile={board.exile}
        emblems={board.emblems}
        dungeon={board.dungeon}
        dungeonCard={board.dungeonCard}
        hideCardArt={view.hideCardArt}
        onHover={onHover}
        target={playerTarget(board, board.viewerSeatId, inputEnabled)}
        waiting={board.prompt?.waiting}
        onTarget={
          promptBinding?.kind === 'targets' &&
          promptBinding.view === board.prompt &&
          promptBinding.controls
            ? (candidate) => void promptBinding.controls!.choose(candidate)
            : undefined
        }
        onOpenZone={onOpenZone}
      />

      {/* A flattened mirror of the hidden zones, for browser automation. */}
      <div className={styles.automationSurface} aria-hidden="true">
        <div data-zone="graveyard" data-owner="self">
          {board.graveyard.map((card) => (
            <small key={card.instanceId} data-card={card.name}>
              {card.name}
            </small>
          ))}
        </div>
        <div data-zone="exile" data-owner="self">
          {board.exile.map((card) => (
            <small key={card.instanceId} data-card={card.name}>
              {card.name}
            </small>
          ))}
        </div>
        <div data-zone="sideboard" data-owner="self">
          {board.sideboard.map((card) => (
            <small key={card.instanceId} data-card={card.name}>
              {card.name}
            </small>
          ))}
        </div>
        <div data-zone="hand" data-owner="opponent">
          {board.opponentHand.map((card) => (
            <small key={card.instanceId} data-card={card.name}>
              {card.name}
            </small>
          ))}
        </div>
        <div data-zone="graveyard" data-owner="opponent">
          {board.opponentGraveyard.map((card) => (
            <small key={card.instanceId} data-card={card.name}>
              {card.name}
            </small>
          ))}
        </div>
        <div data-zone="exile" data-owner="opponent">
          {board.opponentExile.map((card) => (
            <small key={card.instanceId} data-card={card.name}>
              {card.name}
            </small>
          ))}
        </div>
      </div>

      {/*
        Actions without a visible card affordance stay available to browser
        automation. The non-hand rail removes its exact actions from this
        mirror so assistive technology sees one control for each command.
      */}
      {inputEnabled && (
        <div className={styles.actionMirror}>
          {board.legalActions
            .filter((action) => !visibleActionKeys.has(legalActionKey(action)))
            .map((action) => (
              <button
                key={legalActionKey(action)}
                tabIndex={-1}
                data-action-key={legalActionKey(action)}
                data-action-type={action.actionType}
                data-alternative-cost={action.hasAlternativeCost ? 'true' : 'false'}
                data-ability-grp-id={action.abilityGrpId || undefined}
                data-source-zone={action.zoneType}
                onClick={() => onLegalAction(action)}
                disabled={board.gameOver}
              >
                {action.label}
                {action.manaCost && <span> · {action.manaCost}</span>}
              </button>
            ))}
        </div>
      )}

      {/* Pinned to the top edge, mirroring your own hand at the bottom, so the
          battlefield centres on the board rather than on the space the two
          fans leave behind. */}
      <div className={styles.oppHandShelf}>
        <OppHandFan
          count={board.opponent?.handCount ?? 0}
          known={board.opponentHand}
          onHover={onHover}
          onInspect={() => onOpenZone('Known opponent hand', board.opponentHand, 'opponent-hand')}
        />
      </div>

      <section
        className={cx(styles.centerBoard, interactions.drag != null && styles.dragging)}
        aria-label="Battlefield lanes"
        ref={dropZoneRef}
      >
        <section
          className={cx(styles.lane, styles.landLane, styles.opponentLands)}
          aria-label="Opponent lands"
          data-zone="battlefield"
          data-owner="opponent"
        >
          <div
            className={cx(styles.landGroup, opponentLands.length > 3 && styles.supportCompact)}
            style={supportGroupStyle(opponentLands.length, 32)}
            data-piles={opponentLands.length}
          >
            {opponentLands.map((pile) => (
              <Fragment key={pile.card.instanceId}>
                {renderPermanent(pile.card, pile.members.length)}
              </Fragment>
            ))}
          </div>
          <div
            role="group"
            className={cx(
              styles.permanentGroup,
              opponentPermanents.length > 3 && styles.supportCompact,
            )}
            style={supportGroupStyle(opponentPermanents.length, 28)}
            data-piles={opponentPermanents.length}
            aria-label="Opponent other permanents"
          >
            {opponentPermanents.map((pile) => (
              <Fragment key={pile.card.instanceId}>
                {renderPermanent(pile.card, pile.members.length)}
              </Fragment>
            ))}
          </div>
        </section>

        <section
          className={cx(styles.lane, styles.opponentCreatures)}
          style={creatureLaneStyle(opponentCreatures.length)}
          aria-label="Opponent creatures"
          data-zone="battlefield"
          data-owner="opponent"
        >
          {opponentCreatures.map((pile) => (
            <Fragment key={pile.card.instanceId}>
              {renderPermanent(pile.card, pile.members.length)}
            </Fragment>
          ))}
        </section>

        {/* The midline is now only a midline — the phase strip moved to the
            top bar so it stops cutting the battlefield in half. */}
        <div className={styles.phaseDivider}>
          <div className={styles.dividerLine} />
          <div className={styles.phaseOrb} aria-hidden="true">
            <strong data-phase={`${board.phaseName} ${board.stepName}`}>
              {board.phaseName} {board.stepName}
            </strong>
          </div>
        </div>

        <section
          className={styles.lane}
          style={creatureLaneStyle(selfCreatures.length)}
          aria-label="Your creatures"
          data-zone="battlefield"
          data-owner="self"
        >
          {selfCreatures.map((pile) => (
            <Fragment key={pile.card.instanceId}>
              {renderPermanent(pile.card, pile.members.length)}
            </Fragment>
          ))}
        </section>

        <section
          className={cx(styles.lane, styles.landLane)}
          aria-label="Your lands"
          data-zone="battlefield"
          data-owner="self"
        >
          <div
            className={cx(styles.landGroup, selfLands.length > 3 && styles.supportCompact)}
            style={supportGroupStyle(selfLands.length, 32)}
            data-piles={selfLands.length}
          >
            {selfLands.map((pile) => (
              <Fragment key={pile.card.instanceId}>
                {renderPermanent(pile.card, pile.members.length)}
              </Fragment>
            ))}
          </div>
          <div
            role="group"
            className={cx(
              styles.permanentGroup,
              selfPermanents.length > 3 && styles.supportCompact,
            )}
            style={supportGroupStyle(selfPermanents.length, 28)}
            data-piles={selfPermanents.length}
            aria-label="Your other permanents"
          >
            {selfPermanents.map((pile) => (
              <Fragment key={pile.card.instanceId}>
                {renderPermanent(pile.card, pile.members.length)}
              </Fragment>
            ))}
          </div>
        </section>
      </section>

      <div className={styles.handShelf}>
        <div className={styles.handGroup}>
          <HandFan
            cards={board.hand}
            actions={board.legalActions}
            interactive={inputEnabled}
            gameOver={board.gameOver}
            compact={embedded}
            actionChrome={inputEnabled}
            onCardAction={offerCardActions}
            onDragStart={(card, action, event) => {
              if (interactions.startHandDrag(card, action, event, inputEnabled)) {
                onHover(null)
              }
            }}
            onHover={onHover}
            motionFor={motionFor}
          />
          {inputEnabled && (
            <NonHandActionRail
              entries={nonHandEntries}
              disabled={board.gameOver}
              onAction={onLegalAction}
              onHover={onHover}
            />
          )}
        </div>
      </div>

      {inputEnabled && interactions.drag && (
        <div
          className={styles.dragGhost}
          style={{ left: interactions.drag.x, top: interactions.drag.y }}
        >
          <Card card={interactions.drag.card} variant="hand" />
        </div>
      )}

      {inputEnabled && actionCard && actionChoices.length > 1 && (
        <CardActionChooser
          cardName={actionCard.name}
          actions={actionChoices}
          onAction={(action) => {
            setActionCard(null)
            onLegalAction(action)
          }}
          onClose={() => setActionCard(null)}
        />
      )}

      <ArrowLayer arrows={arrows} />

      <div className={styles.decisionColumn}>
        {!view.hideStack && (
          <StackPanel
            cards={board.stack}
            compact={embedded}
            canRespond={inputEnabled && canRespond}
            viewerSeatId={board.viewerSeatId}
            replay={!interactive}
            onHover={onHover}
            motionFor={motionFor}
          />
        )}
        {showPrompt && board.prompt && (
          <PromptDock
            prompt={board.prompt}
            binding={promptBinding}
            cards={[
              ...board.battlefield,
              ...board.opponentBattlefield,
              ...board.hand,
              ...board.stack,
              ...board.graveyard,
              ...board.exile,
            ]}
            onHover={onHover}
          />
        )}
      </div>

      <CardPreview card={hoveredCard} hideCardArt={view.hideCardArt} />
      {interactive && !board.gameOver && !board.prompt && (
        <div className={styles.priorityStatus} role="status">
          {!board.connected
            ? 'Connection interrupted. Game actions are paused.'
            : board.presentation?.lagging
              ? 'Catching up…'
              : board.canPass
                ? canRespond && board.stack.length > 0
                  ? 'You may respond'
                  : 'Your priority'
                : board.prioritySeatId === board.opponentSeatId
                  ? 'Waiting for opponent'
                  : 'Waiting for the game'}
        </div>
      )}

      {inputEnabled && !board.prompt && (
        <ActionButton
          canPass={board.canPass}
          interactive={inputEnabled}
          gameOver={board.gameOver}
          stackSize={visibleStack.length}
          canRespond={inputEnabled && canRespond}
          passing={passing}
          fullControl={fullControl}
          onFullControl={onFullControl}
          onCancelYield={onCancelYield}
          onPass={onPassPriority}
          onResolveAll={onResolveAll}
          onEndTurn={onEndTurn}
        />
      )}

      {zoneViewer && <ZoneViewer zone={zoneViewer} onClose={onCloseZone} onHover={onHover} />}
    </section>
  )
}

export function CardActionChooser({
  cardName,
  actions,
  onAction,
  onClose,
}: {
  cardName: string
  actions: LegalAction[]
  onAction: (action: LegalAction) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const headingId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }
    dialog.showModal()
    return () => {
      if (dialog.open) {
        dialog.close()
      }
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={styles.actionChooser}
      aria-labelledby={headingId}
      onCancel={onClose}
    >
      <h2 id={headingId}>Choose an action for {cardName}</h2>
      <div>
        {actions.map((action, index) => (
          <button
            key={legalActionKey(action)}
            type="button"
            autoFocus={index === 0}
            data-action-key={legalActionKey(action)}
            data-action-type={action.actionType}
            data-alternative-cost={action.hasAlternativeCost ? 'true' : 'false'}
            data-ability-grp-id={action.abilityGrpId || undefined}
            onClick={() => onAction(action)}
          >
            {action.label}
            {action.manaCost && <span> · {action.manaCost}</span>}
          </button>
        ))}
      </div>
      <button type="button" className={styles.actionChooserCancel} onClick={onClose}>
        Cancel
      </button>
    </dialog>
  )
}

function actionsForCard(actions: LegalAction[], instanceId: number): LegalAction[] {
  return actions.filter((action) => action.instanceId === instanceId)
}

function creatureLaneStyle(count: number): CSSProperties {
  return { '--lane-count': Math.max(count, 1) } as CSSProperties
}

export function playerTarget(board: BoardSnapshot, seatId: number, inputEnabled: boolean) {
  if (!inputEnabled || board.prompt?.kind !== 'targets') {
    return undefined
  }
  const candidates = (board.prompt.candidates ?? []).filter(
    (candidate) => candidate.targetInstanceId === seatId,
  )
  return candidates.length === 1 ? candidates[0] : undefined
}
