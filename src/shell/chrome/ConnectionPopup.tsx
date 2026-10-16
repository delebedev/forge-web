import type { MessageTypeEntry, TrafficStats } from '@engine/state/gre-state'
import type { GreGameType } from '@engine/runtime/start'
import { cx } from '@shared/react/cx'
import { Modal } from '@shared/ui/Modal'
import type { ChromeLogEntry, GreConnectionStatus } from '../chrome-derive'
import styles from './ConnectionPopup.module.css'

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const kb = bytes / 1024
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`
  }
  const mb = kb / 1024
  if (mb < 1024) {
    return `${mb.toFixed(2)} MB`
  }
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

export function ConnectionPopup({
  open,
  onClose,
  connectionStatus,
  messageTypeFeed,
  lastMessage,
  errorCount,
  trafficStats,
  roomId,
  gameId,
  logs,
}: {
  open: boolean
  onClose: () => void
  connectionStatus: GreConnectionStatus
  messageTypeFeed: MessageTypeEntry[]
  lastMessage: string
  errorCount: number
  trafficStats: TrafficStats
  roomId: string | null
  gameId: GreGameType | null
  logs: ChromeLogEntry[]
}) {
  const totalBytes = trafficStats.sentBytes + trafficStats.recvBytes

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connection"
      ariaLabel="Connection details"
      maxWidth="380px"
    >
      <div className={styles.connPopup}>
        <div className={styles.connHeader}>
          <span
            className={cx(styles.statusPill, connectionStatus === 'connected' && styles.connected)}
          >
            {connectionStatus}
          </span>
          <span className={styles.errorCount}>Errors {errorCount}</span>
        </div>
        <div className={styles.connRow}>
          <span className={styles.connLabel}>Room</span>
          <strong className={styles.mono}>{roomId ?? '—'}</strong>
        </div>
        <div className={styles.connRow}>
          <span className={styles.connLabel}>Game</span>
          <strong className={styles.mono}>{gameId ?? '—'}</strong>
        </div>
        <div className={styles.connRow}>
          <span className={styles.connLabel}>Endpoint</span>
          <strong>/gre</strong>
        </div>
        <div className={styles.connRow}>
          <span className={styles.connLabel}>Traffic</span>
          <strong>{formatBytes(totalBytes)}</strong>
        </div>
        <div className={styles.connGrid}>
          <div>
            <div className={styles.connSub}>In</div>
            <div className={styles.connValue}>
              <strong>{formatBytes(trafficStats.recvBytes)}</strong> ·{' '}
              <span>{trafficStats.recvMessages}</span>
            </div>
          </div>
          <div>
            <div className={styles.connSub}>Out</div>
            <div className={styles.connValue}>
              <strong>{formatBytes(trafficStats.sentBytes)}</strong> ·{' '}
              <span>{trafficStats.sentMessages}</span>
            </div>
          </div>
        </div>
        <div className={styles.connBlock}>
          <div className={styles.connLabel}>Message Types</div>
          <div className={styles.connFeed}>
            {messageTypeFeed.length === 0 ? (
              <div className={styles.connFeedEmpty}>No messages yet</div>
            ) : (
              [...messageTypeFeed].reverse().map((entry) => (
                <div className={styles.connFeedRow} key={entry.id}>
                  <span className={styles.connFeedTime}>{entry.time}</span>
                  <span className={cx(styles.connFeedDir, entry.direction === 'out' && styles.out)}>
                    {entry.direction}
                  </span>
                  <code>{entry.type}</code>
                </div>
              ))
            )}
          </div>
          <details className={styles.connLast}>
            <summary>Last message</summary>
            <pre>{lastMessage}</pre>
          </details>
        </div>
        <div className={styles.connBlock}>
          <div className={styles.connLabel}>System Log</div>
          <div className={styles.connFeed}>
            {logs.length === 0 ? (
              <div className={styles.connFeedEmpty}>No entries</div>
            ) : (
              [...logs].reverse().map((log) => (
                <div className={styles.connLogRow} key={log.id}>
                  <span className={styles.connFeedTime}>{log.time}</span>
                  <span className={styles.connLogMsg}>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
