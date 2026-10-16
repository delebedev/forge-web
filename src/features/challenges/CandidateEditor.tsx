import { useSyncExternalStore } from 'react'
import { candidateToGreStartConfig } from '@engine/runtime/gre-launch'
import { greSession } from '@engine/runtime/gre-session'
import { candidateDraft as draft } from './candidate-draft'
import styles from './CandidateEditor.module.css'

const MAX_PUZZLE_CHARACTERS = 32_768
const TRIAL_LABELS: Record<string, string> = {
  Won: 'Engine solution observed',
  Lost: 'Advisor lost this attempt',
  Unsupported: 'Advisor does not support this decision',
  AdvisorUnavailable: 'Advisor could not choose a move',
  Stalled: 'Engine trial stopped making progress',
  DecisionBudgetExceeded: 'Decision budget reached',
  TimeBudgetExceeded: 'Time budget reached',
  Interrupted: 'Engine trial interrupted',
  EngineFailure: 'Engine trial failed',
}

export function CandidateEditor() {
  const state = useSyncExternalStore(draft.subscribe, draft.snapshot, draft.snapshot)
  const validation = state.validated?.validation
  const loaded = validation?.status === 'Loaded' && Boolean(state.validated?.candidateId)

  function play(): void {
    const candidateId = state.validated?.candidateId
    if (!candidateId || !validation || !loaded) {
      return
    }
    const goal = validation.goal ?? 'Win'
    const turns = validation.turns
    const objective = turns
      ? `${goal} within ${turns} ${turns === 1 ? 'turn' : 'turns'}.`
      : `${goal}.`
    greSession.start(
      candidateToGreStartConfig({
        candidateId,
        name: validation.name ?? 'Candidate puzzle',
        objective,
      }),
    )
  }

  return (
    <section className={styles.editor} aria-labelledby="candidate-title">
      <header>
        <h2 id="candidate-title">Try a candidate</h2>
        <p>
          Paste a generated or authored puzzle. Check the position, try the advisor, then play it on
          the same board.
        </p>
      </header>
      <label className={styles.label} htmlFor="candidate-text">
        Puzzle text
      </label>
      <textarea
        id="candidate-text"
        className={styles.input}
        value={state.text}
        onChange={(event) => draft.edit(event.target.value)}
        maxLength={MAX_PUZZLE_CHARACTERS}
        rows={12}
        spellCheck={false}
        placeholder={'[metadata]\nName:Your puzzle\nGoal:Win\nTurns:1\n\n[state]\n…'}
        aria-describedby="candidate-help"
      />
      <p id="candidate-help" className={styles.help}>
        Forge .pzl format. Validation checks supported state, real card names, and engine loading.
        It does not prove a solution.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={!state.text.trim() || Boolean(state.busy)}
          onClick={() => void draft.validate()}
        >
          {state.busy === 'validation' ? 'Validating…' : 'Validate puzzle'}
        </button>
        <button
          type="button"
          disabled={!loaded || Boolean(state.busy)}
          onClick={() => void draft.tryEngine()}
        >
          {state.busy === 'trial' ? 'Trying engine…' : 'Try engine'}
        </button>
        <button
          type="button"
          className={styles.play}
          disabled={!loaded || Boolean(state.busy)}
          onClick={play}
        >
          Play candidate
        </button>
      </div>
      <div className={styles.results} aria-live="polite">
        {state.error && (
          <p className={styles.error} role="alert">
            {state.error}
          </p>
        )}
        {validation && (
          <section aria-label="Engine validation">
            <strong>
              {loaded ? 'Position loaded by the engine' : `Validation: ${validation.status}`}
            </strong>
            {loaded && (
              <p>
                {validation.name} · {validation.inputCardCount} cards. Ready for a trial or manual
                play.
              </p>
            )}
            {(validation.issues?.length ?? 0) > 0 && (
              <ul>
                {validation.issues?.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </section>
        )}
        {state.trial && (
          <section aria-label="Engine trial result">
            <strong>{TRIAL_LABELS[state.trial.status] ?? state.trial.status}</strong>
            <p>
              {state.trial.decisions?.length ?? 0} decisions ·{' '}
              {(Number(state.trial.elapsedMillis) / 1000).toFixed(1)} seconds.
            </p>
            {state.trial.reason && <p>{state.trial.reason}</p>}
            <p>
              {state.trial.status === 'Won'
                ? 'The browser still needs its own playthrough.'
                : 'This attempt does not establish whether the puzzle is solvable. You can still play the validated position.'}
            </p>
            <details>
              <summary>Trial details</summary>
              <pre>{JSON.stringify(state.trial, null, 2)}</pre>
            </details>
          </section>
        )}
      </div>
    </section>
  )
}
