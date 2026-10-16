import styles from './ActionButton.module.css'

export function ActionButton({
  canPass,
  interactive,
  gameOver,
  stackSize,
  canRespond = false,
  passing = false,
  fullControl = false,
  onPass,
  onResolveAll,
  onEndTurn,
  onFullControl,
  onCancelYield,
}: {
  canPass: boolean
  interactive: boolean
  gameOver: boolean
  stackSize: number
  canRespond?: boolean
  passing?: boolean
  fullControl?: boolean
  onPass: () => void
  onResolveAll?: () => void
  onEndTurn?: () => void
  onFullControl?: (enabled: boolean) => void
  onCancelYield?: () => void
}) {
  const disabled = !interactive || gameOver
  return (
    <div className={styles.actionDock} data-stack={stackSize} data-respond={canRespond}>
      {passing && onCancelYield ? (
        <button className={styles.primary} onClick={onCancelYield} disabled={disabled}>
          Cancel auto-pass
        </button>
      ) : (
        <button className={styles.primary} onClick={onPass} disabled={disabled || !canPass}>
          {stackSize > 0 ? 'Resolve' : 'Pass'}
        </button>
      )}
      {stackSize > 0 && onResolveAll && (
        <button
          className={styles.skip}
          onClick={onResolveAll}
          disabled={disabled || !canPass || passing}
        >
          Resolve all
        </button>
      )}
      {onEndTurn && (
        <button
          className={styles.skip}
          onClick={onEndTurn}
          disabled={disabled || !canPass || passing}
        >
          Pass turn
        </button>
      )}
      {onFullControl && (
        <button
          className={styles.control}
          aria-pressed={fullControl}
          onClick={() => onFullControl(!fullControl)}
          disabled={disabled}
        >
          Full control{fullControl ? ' · On' : ''}
        </button>
      )}
    </div>
  )
}
