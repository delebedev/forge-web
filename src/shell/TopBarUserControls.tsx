import type { MessageTypeEntry, TrafficStats } from '@engine/state/gre-state'
import type { GreGameType } from '@engine/runtime/start'
import { cx } from '@shared/react/cx'
import { ConnectionPopup } from './chrome/ConnectionPopup'
import type { ChromeLogEntry, GreConnectionStatus } from './chrome-derive'
import styles from './TopBar.module.css'

/** Nav-right leaf: identity, sound toggle, and the connection indicator/popup. */
export function TopBarUserControls({
  playerName,
  onLogout,
  soundMuted,
  onToggleSound,
  iconConnectionStatus,
  errorCount,
  showConnectionPopup,
  onToggleConnectionPopup,
  onCloseConnectionPopup,
  popupConnectionStatus,
  messageTypeFeed,
  lastMessage,
  trafficStats,
  roomId,
  gameId,
  logs,
}: {
  playerName?: string
  onLogout: () => void
  soundMuted: boolean
  onToggleSound: () => void
  /** Gated to 'idle' outside a live match — drives the icon's color only. */
  iconConnectionStatus: GreConnectionStatus | 'idle'
  errorCount: number
  showConnectionPopup: boolean
  onToggleConnectionPopup: () => void
  onCloseConnectionPopup: () => void
  /** Ungated — the popup always shows the real transport state. */
  popupConnectionStatus: GreConnectionStatus
  messageTypeFeed: MessageTypeEntry[]
  lastMessage: string
  trafficStats: TrafficStats
  roomId: string | null
  gameId: GreGameType | null
  logs: ChromeLogEntry[]
}) {
  return (
    <div className={styles.navRight}>
      {playerName && (
        <>
          <span className={styles.userName}>{playerName}</span>
          <button className={styles.navBtn} onClick={onLogout}>
            Logout
          </button>
        </>
      )}
      <button
        className={cx(styles.iconBtn, soundMuted && styles.muted)}
        type="button"
        onClick={onToggleSound}
        aria-label={soundMuted ? 'Unmute sounds' : 'Mute sounds'}
        title={soundMuted ? 'Unmute sounds' : 'Mute sounds'}
      >
        {soundMuted ? '\u{1F507}' : '\u{1F50A}'}
      </button>
      <div className={styles.connAnchor}>
        <button
          className={cx(
            styles.connButton,
            showConnectionPopup && styles.open,
            iconConnectionStatus === 'connected' && styles.connected,
            iconConnectionStatus === 'error' && styles.error,
          )}
          type="button"
          onClick={onToggleConnectionPopup}
          aria-label="Connection details"
          title="Connection details"
        >
          <span className={styles.connDot} />
          {errorCount > 0 && <span className={styles.connError}>{errorCount}</span>}
        </button>
        <ConnectionPopup
          open={showConnectionPopup}
          onClose={onCloseConnectionPopup}
          connectionStatus={popupConnectionStatus}
          messageTypeFeed={messageTypeFeed}
          lastMessage={lastMessage}
          errorCount={errorCount}
          trafficStats={trafficStats}
          roomId={roomId}
          gameId={gameId}
          logs={logs}
        />
      </div>
    </div>
  )
}
