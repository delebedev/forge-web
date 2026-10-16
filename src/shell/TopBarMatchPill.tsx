import styles from './TopBar.module.css'

/** Center pill leaf, visible only during a live GRE match. */
export function TopBarMatchPill({
  label,
  primary,
  secondary,
}: {
  label: string
  primary: string
  secondary: string
}) {
  return (
    <div className={styles.navCenter}>
      <div className={styles.greMatchPill}>
        <span>{label}</span>
        <strong>{primary}</strong>
        <small>{secondary}</small>
      </div>
    </div>
  )
}
