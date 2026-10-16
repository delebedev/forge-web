import { Dialog } from '@base-ui/react/dialog'
import { useRef, type ReactNode } from 'react'
import styles from './Modal.module.css'
export function Modal({
  open,
  onClose,
  zIndex = 120,
  title,
  ariaLabel,
  maxWidth = '880px',
  children,
}: {
  open: boolean
  onClose?: () => void
  zIndex?: number
  title?: string
  ariaLabel?: string
  maxWidth?: string
  children: ReactNode
}) {
  const wasOpen = useRef(false)
  const focusReturnTarget = useRef<HTMLElement | null>(null)
  if (open && !wasOpen.current) {
    // External triggers are outside Dialog.Root, so preserve their focus target.
    focusReturnTarget.current =
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
  }
  wasOpen.current = open

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose?.()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.modalBackdrop} style={{ zIndex }} />
        <Dialog.Viewport className={styles.modalViewport} style={{ zIndex }}>
          <Dialog.Popup
            className={`public-theme ${styles.modalPanel}`}
            style={{ width: `min(${maxWidth}, 92vw)` }}
            aria-label={ariaLabel ?? (title ? undefined : 'Dialog')}
            finalFocus={focusReturnTarget}
          >
            {(title || onClose) && (
              <div className={styles.modalHeader}>
                {title && (ariaLabel ? <h2>{title}</h2> : <Dialog.Title>{title}</Dialog.Title>)}
                {onClose && (
                  <Dialog.Close className={styles.modalClose} aria-label="Close">
                    &times;
                  </Dialog.Close>
                )}
              </div>
            )}
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
