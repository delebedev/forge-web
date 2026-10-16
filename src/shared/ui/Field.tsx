import type { ComponentProps } from 'react'
import { cx } from '@shared/react/cx'
import styles from './Field.module.css'

export function TextField({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cx(styles.control, className)} />
}

export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx(styles.control, styles.textarea, className)} />
}

export function SelectField({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={cx(styles.control, className)} />
}
