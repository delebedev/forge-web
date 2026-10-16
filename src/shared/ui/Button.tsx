import type { ComponentProps } from 'react'
import { cx } from '@shared/react/cx'
import styles from './Button.module.css'

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'regular' | 'compact'
}

export function Button({
  variant = 'primary',
  size = 'regular',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        size === 'compact' && styles.compact,
        className,
      )}
    />
  )
}
