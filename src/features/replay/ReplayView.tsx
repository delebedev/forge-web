/**
 * `/play/replay` — plays a saved game transcript through the real board.
 *
 * The board, projection and prompt dock are the same ones a live match renders;
 * only the frame source differs, so what you are judging here is the actual
 * client. Nothing is submitted: the store has no socket behind it and the
 * interactions are inert.
 *
 * The board gets the whole window and the transport floats over it, because the
 * point is to watch the game, not to read a page. Load a bundle with the file
 * picker, or pass `?src=<path>` to fetch one.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CardView } from '@engine/state/gre-state'
import { greNormalizer } from '@engine/replay/gre-enum-names'
import { GreStore } from '@engine/runtime/gre-store'
import { humanDwellPolicy } from '@engine/state/presentation-policy'
import {
  TranscriptFrameSource,
  parseTranscriptBundle,
  transcriptCardMeta,
  transcriptFrames,
  type TranscriptBundle,
  type TranscriptEvent,
  type TranscriptPosition,
} from '@engine/replay/gre-transcript'
import { createExternalStore } from '@shared/react/create-external-store'
import { cx } from '@shared/react/cx'
import { Board } from '@features/gre/board/variants/classic/Board'
import {
  currentZoneViewer,
  currentHandHoveredCard,
  type ZoneViewerState,
} from '@features/gre/board/types'
import { READ_ONLY_INTERACTIONS } from '@features/gre/board/read-only-interactions'
import { buildReplayTimeline, nextStackRun, type ReplayTimeline } from './replay-timeline'
import styles from './ReplayView.module.css'

const EMPTY_POSITION: TranscriptPosition = {
  index: 0,
  total: 0,
  playing: false,
  batchIndex: 0,
  batchTotal: 0,
}
const EMPTY_TIMELINE: ReplayTimeline = { occupied: [], runs: [] }

/** Slow enough to read a board between frames; the transport can outrun it. */
const STEP_MS = 200

export function ReplayView() {
  const [{ store, external }] = useState(() => {
    const store = new GreStore()
    return { store, external: createExternalStore(store) }
  })
  const board = useSyncExternalStore(external.subscribe, external.getSnapshot, external.getSnapshot)

  const sourceRef = useRef<TranscriptFrameSource | null>(null)
  const [position, setPosition] = useState<TranscriptPosition>(EMPTY_POSITION)
  const [timeline, setTimeline] = useState<ReplayTimeline>(EMPTY_TIMELINE)
  const [label, setLabel] = useState('')
  const [origin, setOrigin] = useState('')
  const [bundleInfo, setBundleInfo] = useState<TranscriptBundle | null>(null)
  const [selectedChoice, setSelectedChoice] = useState<TranscriptEvent | null>(null)
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)
  const [misses, setMisses] = useState(0)
  const [idle, setIdle] = useState(false)
  const [hoveredCard, setHoveredCard] = useState<CardView | null>(null)
  const [zoneViewer, setZoneViewer] = useState<ZoneViewerState>(null)
  const priorKnownHandIds = useRef<Set<number>>(new Set())
  const visibleZoneViewer = currentZoneViewer(zoneViewer, board)
  const visibleHoveredCard = zoneViewer
    ? (visibleZoneViewer?.cards.find((card) => card.instanceId === hoveredCard?.instanceId) ?? null)
    : currentHandHoveredCard(hoveredCard, priorKnownHandIds.current, board)
  useEffect(() => {
    if (hoveredCard !== visibleHoveredCard) {
      setHoveredCard(visibleHoveredCard)
    }
    if (zoneViewer && !visibleZoneViewer) {
      setZoneViewer(null)
    }
    priorKnownHandIds.current = new Set(board.opponentHand.map((card) => card.instanceId))
  }, [board.opponentHand, hoveredCard, visibleHoveredCard, visibleZoneViewer, zoneViewer])

  const load = useCallback(
    async (raw: unknown) => {
      try {
        const bundle = parseTranscriptBundle(raw)
        setHoveredCard(null)
        setZoneViewer(null)
        sourceRef.current?.stop()
        const source = new TranscriptFrameSource(bundle, {
          stepMs: STEP_MS,
          onPosition: setPosition,
        })
        await source.ready()
        store.setViewerSeat(bundle.viewerSeatId)
        // Replay is where dwell is safe: nothing here can be answered, so holding
        // a frame back cannot delay anybody's decision.
        store.setDwellPolicy(humanDwellPolicy())
        store.seedCardMeta(transcriptCardMeta(bundle))
        store.attachSource(source)
        sourceRef.current = source
        setTimeline(buildReplayTimeline(transcriptFrames(bundle), await greNormalizer()))
        setLabel(bundle.label)
        setOrigin(bundle.source)
        setBundleInfo(bundle)
        setError('')
        setMisses(0)
        setStarted(false)
        setSelectedChoice(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not read that transcript')
      }
    },
    [store],
  )

  // `?src=` makes a replay linkable, which is what lets a screenshot or a bug
  // report point at an exact transcript instead of describing one.
  useEffect(() => {
    const src = new URLSearchParams(location.search).get('src')?.trim()
    if (!src) {
      return
    }
    void fetch(src)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${src}: ${res.status}`))))
      .then(load)
      .catch((cause: Error) => setError(cause.message))
  }, [load])

  useEffect(
    () => () => {
      sourceRef.current?.stop()
      external.destroy()
    },
    [external],
  )

  // Enum names the descriptor could not match. Zero for a well-formed bundle;
  // anything else means values are being read as something they are not.
  useEffect(() => {
    setMisses(sourceRef.current?.misses.length ?? 0)
  }, [position])

  // Quiet the transport during playback while keeping its controls reachable.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    function wake() {
      setIdle(false)
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => setIdle(true), 2200)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      if (timer) {
        clearTimeout(timer)
      }
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  async function onPickFile(file: File | null): Promise<void> {
    if (!file) {
      return
    }
    try {
      await load(JSON.parse(await file.text()))
    } catch {
      setError(`${file.name} is not a transcript bundle`)
    }
  }

  const source = sourceRef.current
  const loaded = position.total > 0
  const atEnd = loaded && position.index >= position.total
  const inbound = bundleInfo?.events?.filter((event) => event.direction === 'inbound') ?? []

  function start(): void {
    setStarted(true)
    source?.play()
  }

  const controls = useMemo(
    () => ({
      toggle: () => source?.toggle(),
      stepBack: () => source?.stepBack(),
      stepForward: () => source?.stepForward(),
      seek: (index: number) => source?.seek(index),
      nextStack: () => {
        const target = nextStackRun(timeline, position.index)
        if (target != null) {
          source?.seek(target)
        }
      },
    }),
    [source, timeline, position.index],
  )

  const stackHere = timeline.occupied[position.index - 1] === true

  return (
    <main className={styles.stage}>
      <Board
        board={board}
        interactive={false}
        replay
        embedded={false}
        interactions={READ_ONLY_INTERACTIONS}
        stops={new Set<string>()}
        canRespond={false}
        passing={false}
        onToggleStop={() => {}}
        onPassPriority={() => {}}
        onResolveAll={() => {}}
        onEndTurn={() => {}}
        onLegalAction={() => {}}
        hoveredCard={visibleHoveredCard}
        onHover={setHoveredCard}
        zoneViewer={visibleZoneViewer}
        onOpenZone={(title, source) =>
          setZoneViewer({ title, source, matchId: board.currentMatchId })
        }
        onCloseZone={() => setZoneViewer(null)}
        dropZoneRef={() => {}}
      />

      {!started && (
        <div className={styles.curtain}>
          <div className={styles.card}>
            <p className={styles.eyebrow}>Transcript replay</p>
            <h1 className={styles.title}>{label || 'No transcript loaded'}</h1>
            {bundleInfo?.status && (
              <p
                className={bundleInfo.status.complete ? styles.complete : styles.error}
                role="status"
              >
                {bundleInfo.status.complete
                  ? 'Complete match'
                  : `Incomplete: ${bundleInfo.status.reason}`}
                {bundleInfo.status.truncated && ' · truncated'}
              </p>
            )}
            {loaded ? (
              <>
                <p className={styles.meta}>
                  {origin && <span className={styles.chip}>{origin}</span>}
                  {position.total} frames · {position.batchTotal} arrivals
                  {timeline.runs.length > 0 && ` · ${timeline.runs.length} stack moments`}
                </p>
                {inbound.length > 0 && (
                  <details className={styles.responses}>
                    <summary>
                      {inbound.length} player choice{inbound.length === 1 ? '' : 's'}
                    </summary>
                    <ol>
                      {inbound.map((event) => (
                        <li key={event.seq}>
                          <button type="button" onClick={() => seekToChoice(event)}>
                            #{event.seq} · seat {event.seatId} · {responseName(event.message)}
                          </button>
                          <details>
                            <summary>Submitted payload</summary>
                            <pre>{JSON.stringify(event.message, null, 2)}</pre>
                          </details>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                <button className={styles.start} onClick={start} autoFocus>
                  Start replay
                </button>
                <p className={styles.hint}>
                  Or step through it frame by frame with the transport below.
                </p>
              </>
            ) : (
              <p className={styles.hint}>
                {bundleInfo
                  ? 'No replay frames were retained.'
                  : 'Load a transcript bundle to watch a game back.'}
              </p>
            )}
            <label className={styles.file}>
              {loaded ? 'Load a different transcript' : 'Load transcript'}
              <input
                type="file"
                accept=".json,.greplay.json"
                onChange={(event) => void onPickFile(event.currentTarget.files?.[0] ?? null)}
              />
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      <section
        className={cx(styles.transport, position.playing && idle && styles.dim)}
        aria-label="Replay transport"
      >
        <button
          onClick={controls.stepBack}
          disabled={!loaded || position.index === 0}
          aria-label="Step back"
        >
          ◀
        </button>
        <button className={styles.primary} onClick={controls.toggle} disabled={!loaded || atEnd}>
          {position.playing ? 'Pause' : started ? 'Play' : 'Start'}
        </button>
        <button
          onClick={controls.stepForward}
          disabled={!loaded || atEnd}
          aria-label="Step forward"
        >
          ▶
        </button>

        <div className={styles.track}>
          <input
            className={styles.scrub}
            type="range"
            min={0}
            max={Math.max(position.total, 1)}
            value={position.index}
            disabled={!loaded}
            onChange={(event) => controls.seek(Number(event.currentTarget.value))}
            aria-label="Scrub"
          />
          {/* Where the stack is occupied. Without these the moments worth
              watching are a fraction of the frames and impossible to find. */}
          <div className={styles.marks} aria-hidden="true">
            {timeline.runs.map((run) => (
              <span
                key={run.start}
                className={styles.mark}
                style={{
                  left: `${(run.start / Math.max(position.total, 1)) * 100}%`,
                  width: `${Math.max(((run.end - run.start + 1) / Math.max(position.total, 1)) * 100, 0.5)}%`,
                }}
              />
            ))}
          </div>
        </div>

        <button
          className={cx(styles.jump, stackHere && styles.jumpActive)}
          onClick={controls.nextStack}
          disabled={!loaded || timeline.runs.length === 0}
          title="Jump to the next spell on the stack"
        >
          Stack ▸
        </button>

        <output className={styles.readout}>
          Turn {board.turnNumber} · {board.stepName || board.phaseName}
        </output>

        {started && (
          <label className={styles.file}>
            Load
            <input
              type="file"
              accept=".json,.greplay.json"
              onChange={(event) => void onPickFile(event.currentTarget.files?.[0] ?? null)}
            />
          </label>
        )}
      </section>

      {misses > 0 && (
        <p className={styles.warning} role="status">
          {misses} enum name{misses === 1 ? '' : 's'} in this transcript matched no known value —
          values may be read as defaults.
        </p>
      )}
      {started && bundleInfo?.status && (
        <p
          className={bundleInfo.status.complete ? styles.completeBanner : styles.warning}
          role="status"
        >
          {bundleInfo.status.complete
            ? `Complete · ${inbound.length} choices`
            : `Incomplete · ${bundleInfo.status.reason}`}
        </p>
      )}
      {started && selectedChoice && !position.playing && (
        <aside className={styles.choiceInspector} aria-label="Submitted player choice">
          <button
            type="button"
            onClick={() => setSelectedChoice(null)}
            aria-label="Close submitted choice"
          >
            ×
          </button>
          <strong>
            #{selectedChoice.seq} · seat {selectedChoice.seatId} ·{' '}
            {responseName(selectedChoice.message)}
          </strong>
          <details open>
            <summary>Submitted payload</summary>
            <pre>{JSON.stringify(selectedChoice.message, null, 2)}</pre>
          </details>
        </aside>
      )}
    </main>
  )

  function seekToChoice(event: TranscriptEvent): void {
    const replay = sourceRef.current
    if (!replay) {
      return
    }
    const precedingFrames = replay.frames.filter(
      (frame) => frame.batchIndex <= event.batchIndex,
    ).length
    replay.seek(precedingFrames)
    setSelectedChoice(event)
    setStarted(true)
  }
}

function responseName(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) {
    return 'Unknown response'
  }
  const value = (raw as Record<string, unknown>)['clientToMatchServiceMessageType']
  if (typeof value === 'string') {
    return value.replace(/^ClientToMatchServiceMessageType_/, '')
  }
  const type = (raw as Record<string, unknown>)['type']
  return typeof type === 'string' ? type.replace(/^ClientMessageType_/, '') : 'Gameplay response'
}
