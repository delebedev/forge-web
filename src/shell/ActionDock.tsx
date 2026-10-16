import type { ReactNode } from 'react'
import styles from './ActionDock.module.css'

export function ActionDock({
  children,
  action,
}: {
  /** Main dock content (settings, checklist, info) */
  children?: ReactNode
  /** Bottom-anchored action area (start button, etc.) */
  action?: ReactNode
}) {
  return (
    <aside className={styles.dock}>
      <div className={styles.dockBody}>{children}</div>
      {action && <div className={styles.dockAction}>{action}</div>}
    </aside>
  )
}
