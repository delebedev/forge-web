import { useSyncExternalStore } from 'react'
import { greSession } from '@engine/runtime/gre-session'
import { candidateDraft as draft } from './candidate-draft'
import styles from './CandidateEditor.module.css'

const MAX_PUZZLE_CHARACTERS = 32_768
export function CandidateEditor() {
  const state = useSyncExternalStore(draft.subscribe, draft.snapshot, draft.snapshot)
  const validation = state.validated
  const loaded = validation?.status === 'Loaded'

  function play(): void {
    if (!validation || !loaded) {
      return
    }
    const goal = validation.goal ?? 'Win'
    const turns = validation.turns
    const objective = turns
      ? `${goal} within ${turns} ${turns === 1 ? 'turn' : 'turns'}.`
      : `${goal}.`
    greSession.startBrowser({
      gameType: 'puzzle',
      challengeId: 'candidate',
      puzzleText: state.text,
      label: validation.name ?? 'Candidate puzzle',
      objective,
      returnPath: '/challenges',
    })
  }

  return (
    <section className={styles.editor} aria-labelledby="candidate-title">
      <header>
        <h2 id="candidate-title">Try a candidate</h2>
        <p>
          Paste an authored puzzle. Validate and play it in your browser. The first validation
          downloads the local engine.
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
          {state.busy ? 'Validating in browser…' : 'Validate puzzle'}
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
                {validation.name} · {validation.inputCardCount} cards. Ready for browser play.
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
      </div>
    </section>
  )
}
