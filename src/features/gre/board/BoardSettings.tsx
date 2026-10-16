/**
 * View options for the board, behind a gear in the top bar.
 *
 * Everything in here is a durable viewer preference rather than a game action,
 * which is why it lives behind a menu instead of on the table: you set it once
 * and it persists, so it should not hold permanent space on the play surface.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { boardAudio } from '@shared/audio'
import { useSoundPreferences } from '@shared/audio-react'
import { SOUND_DEFAULT_VOLUME, SOUND_VOLUME_STEP } from '@shared/sound-cues'
import { cx } from '@shared/react/cx'
import { createExternalStore } from '@shared/react/create-external-store'
import {
  boardView,
  BOARD_VIEW_DEFAULTS,
  BOARD_WIDTHS,
  CARD_SCALE_MAX,
  CARD_SCALE_MIN,
  CARD_SCALE_STEP,
  HAND_OVERLAP_MAX,
  HAND_OVERLAP_MIN,
  HAND_OVERLAP_STEP,
  type BoardViewSnapshot,
  type BoardWidth,
} from './board-view'
import styles from './BoardSettings.module.css'

const viewExternal = createExternalStore(boardView)

type RangeSettingProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  initial: number
  onChange: (value: number) => void
}

function RangeSetting({ label, value, min, max, step, initial, onChange }: RangeSettingProps) {
  return (
    <>
      <p className={styles.group}>
        {label} · {Math.round(value * 100)}%
      </p>
      <div className={styles.slider}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <button
          className={styles.reset}
          onClick={() => onChange(initial)}
          disabled={value === initial}
        >
          Reset
        </button>
      </div>
    </>
  )
}

export function useBoardView(): BoardViewSnapshot {
  return useSyncExternalStore(
    viewExternal.subscribe,
    viewExternal.getSnapshot,
    viewExternal.getSnapshot,
  )
}

export function BoardSettings() {
  const view = useBoardView()
  const sound = useSoundPreferences()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={styles.settings} ref={rootRef}>
      <button
        className={styles.trigger}
        aria-label="Board options"
        aria-expanded={open}
        title="Board options"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        ⚙
      </button>

      {open && (
        <div className={styles.menu} role="group" aria-label="Board options">
          <label className={styles.option}>
            <input
              type="checkbox"
              checked={!sound.muted}
              onChange={(event) => boardAudio.setMuted(!event.currentTarget.checked)}
            />
            <span>Sounds</span>
          </label>
          <RangeSetting
            label="Sound volume"
            value={sound.volume}
            min={0}
            max={1}
            step={SOUND_VOLUME_STEP}
            initial={SOUND_DEFAULT_VOLUME}
            onChange={boardAudio.setVolume}
          />
          <div className={styles.choices}>
            <button
              className={styles.choice}
              onClick={() => {
                boardAudio.unlock()
                boardAudio.play(['place'])
              }}
              disabled={sound.muted || sound.volume === 0}
            >
              Test sound
            </button>
          </div>
          <div className={styles.rule} />
          <p className={styles.group}>Width</p>
          <div className={styles.choices} role="radiogroup" aria-label="Width">
            {(Object.keys(BOARD_WIDTHS) as BoardWidth[]).map((id) => (
              <button
                key={id}
                className={cx(styles.choice, view.width === id && styles.chosen)}
                role="radio"
                aria-checked={view.width === id}
                onClick={() => boardView.setWidth(id)}
              >
                {BOARD_WIDTHS[id].label}
              </button>
            ))}
          </div>

          <RangeSetting
            label="Card size"
            value={view.cardScale}
            min={CARD_SCALE_MIN}
            max={CARD_SCALE_MAX}
            step={CARD_SCALE_STEP}
            initial={BOARD_VIEW_DEFAULTS.cardScale}
            onChange={boardView.setCardScale}
          />
          <RangeSetting
            label="Hand size"
            value={view.handScale}
            min={CARD_SCALE_MIN}
            max={CARD_SCALE_MAX}
            step={CARD_SCALE_STEP}
            initial={BOARD_VIEW_DEFAULTS.handScale}
            onChange={boardView.setHandScale}
          />
          <RangeSetting
            label="Hand overlap"
            value={view.handOverlap}
            min={HAND_OVERLAP_MIN}
            max={HAND_OVERLAP_MAX}
            step={HAND_OVERLAP_STEP}
            initial={BOARD_VIEW_DEFAULTS.handOverlap}
            onChange={boardView.setHandOverlap}
          />
          <RangeSetting
            label="Preview size"
            value={view.previewScale}
            min={CARD_SCALE_MIN}
            max={CARD_SCALE_MAX}
            step={CARD_SCALE_STEP}
            initial={BOARD_VIEW_DEFAULTS.previewScale}
            onChange={boardView.setPreviewScale}
          />

          <RangeSetting
            label="Player panel size"
            value={view.playerPanelScale}
            min={CARD_SCALE_MIN}
            max={CARD_SCALE_MAX}
            step={CARD_SCALE_STEP}
            initial={BOARD_VIEW_DEFAULTS.playerPanelScale}
            onChange={boardView.setPlayerPanelScale}
          />

          <div className={styles.rule} />

          <label className={styles.option}>
            <input
              type="checkbox"
              checked={view.hideCardArt}
              onChange={(event) => boardView.setHideCardArt(event.currentTarget.checked)}
            />
            <span>Hide card art</span>
          </label>

          <label className={styles.option}>
            <input
              type="checkbox"
              checked={view.hideStack}
              onChange={(event) => boardView.setHideStack(event.currentTarget.checked)}
            />
            <span>Hide stack panel</span>
          </label>
        </div>
      )}
    </div>
  )
}
