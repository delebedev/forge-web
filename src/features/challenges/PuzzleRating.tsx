import { useState, type FormEvent } from 'react'
import { authStore } from '@shared/auth/auth'
import { Button } from '@shared/ui/Button'
import { TextArea } from '@shared/ui/Field'
import { sendPuzzleRating } from './puzzle-api'
import styles from './PuzzleRating.module.css'

type Reaction = 'fun' | 'meh' | 'bad'

const REACTIONS: { value: Reaction; label: string; emoji: string }[] = [
  { value: 'fun', label: 'Fun', emoji: '😄' },
  { value: 'meh', label: 'So-so', emoji: '😐' },
  { value: 'bad', label: 'Not for me', emoji: '😕' },
]

export function PuzzleRating({ puzzleId, outcome }: { puzzleId: string; outcome: 'won' | 'lost' }) {
  const [reaction, setReaction] = useState<Reaction | null>(null)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!reaction || saving) {
      return
    }
    setSaving(true)
    setError('')
    try {
      if (!(await authStore.ensureSession())) {
        throw new Error('Could not start a feedback session. Try again.')
      }
      await sendPuzzleRating(puzzleId, {
        reaction,
        outcome,
        comment: comment.trim() || null,
        actions: [],
      })
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Feedback could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={styles.rating} onSubmit={(event) => void submit(event)}>
      <h3>Was this challenge fun?</h3>
      {saved ? (
        <p role="status">Thanks — your rating is saved.</p>
      ) : (
        <>
          <div className={styles.choices} role="group" aria-label="Rate this challenge">
            {REACTIONS.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={styles.choice}
                aria-pressed={reaction === choice.value}
                disabled={saving}
                onClick={() => setReaction(choice.value)}
              >
                <span aria-hidden="true">{choice.emoji}</span>
                {choice.label}
              </button>
            ))}
          </div>
          <label className={styles.comment}>
            <span className={styles.commentPrompt}>
              Anything you’d change? <small>(optional)</small>
            </span>
            <TextArea
              rows={2}
              maxLength={1000}
              value={comment}
              disabled={saving}
              onChange={(event) => setComment(event.currentTarget.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" size="compact" disabled={!reaction || saving}>
            {saving ? 'Saving…' : 'Send rating'}
          </Button>
        </>
      )}
    </form>
  )
}
