/** Email-code form shared by the public entry shell and design references. */

import { useEffect, useState, type FormEvent } from 'react'
import { trackLogin } from '@shared/analytics'
import { authStore } from '@shared/auth/auth'
import { useRouter } from '@app/router'
import { useAuthSnapshot } from '@shared/auth/hooks'
import { Button } from '@shared/ui/Button'
import { TextField } from '@shared/ui/Field'
import styles from './LoginPage.module.css'

const apiBase = import.meta.env['VITE_WEBDOOR_URL'] ?? location.origin

export function LoginPage({ preview = false }: { preview?: boolean }) {
  const router = useRouter()
  const auth = useAuthSnapshot()
  const afterLogin = router.query.get('returnTo') === '/roadmap' ? '/roadmap' : '/play/game'

  useEffect(() => {
    if (!preview && auth.ready && auth.isAuthenticated && !auth.guest) {
      router.navigate(afterLogin, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, auth.isAuthenticated, auth.guest, preview])

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const normalizedEmail = email.trim().toLowerCase()
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  const maskedEmail = maskEmail(normalizedEmail)
  const canSubmitEmail = !loading && emailIsValid
  const canSubmitCode = !loading && /^[0-9]{6}$/.test(code.trim())

  async function startLogin(e?: FormEvent): Promise<void> {
    e?.preventDefault()
    if (!canSubmitEmail) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/auth/request-code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      })
      if (!res.ok) {
        setError(startLoginMessage(res.status))
        return
      }
      setStep('code')
      setCode('')
    } catch {
      setError('Could not connect. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function verifyCode(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!canSubmitCode) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/auth/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, code: code.trim() }),
      })
      if (!res.ok) {
        trackLogin({
          method: 'email-code',
          success: false,
          reason: loginAnalyticsReason(res.status),
        })
        setError(verifyLoginMessage(res.status))
        return
      }
      await authStore.refresh()
      trackLogin({ method: 'email-code', success: true })
      router.navigate(afterLogin, true)
    } catch {
      trackLogin({ method: 'email-code', success: false, reason: 'network-error' })
      setError('Could not connect. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  function editEmail(): void {
    setStep('email')
    setCode('')
    setError(null)
  }

  return (
    <div className={styles.loginFormShell}>
      {step === 'email' ? (
        <form
          className={styles.loginForm}
          onSubmit={(event) => void startLogin(event)}
          aria-label="Request login code"
        >
          <label className={styles.field}>
            <span>Email</span>
            <TextField
              data-testid="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              disabled={loading}
              required
            />
            {normalizedEmail && !emailIsValid && (
              <small className={styles.fieldHelp}>
                Use a full email address, like you@example.com.
              </small>
            )}
          </label>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <Button data-testid="auth-start" type="submit" disabled={!canSubmitEmail}>
            {loading ? 'Sending code...' : 'Continue'}
          </Button>
        </form>
      ) : (
        <form
          className={styles.loginForm}
          onSubmit={(event) => void verifyCode(event)}
          aria-label="Verify login code"
        >
          <p className={styles.hint}>
            Enter the 6-digit code sent to <strong>{maskedEmail}</strong>.
          </p>
          <label className={styles.field}>
            <span>Login code</span>
            <TextField
              data-testid="auth-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              placeholder="123456"
              disabled={loading}
              required
            />
            <small className={styles.fieldHelp}>
              Six digits. Request a new code if it expired.
            </small>
          </label>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <Button data-testid="auth-verify" type="submit" disabled={!canSubmitCode}>
            {loading ? 'Signing in...' : 'Continue'}
          </Button>
          <div className={styles.secondaryActions}>
            <button type="button" onClick={() => void startLogin()} disabled={loading}>
              Send again
            </button>
            <button type="button" onClick={editEmail} disabled={loading}>
              Use another email
            </button>
          </div>
        </form>
      )}
      {import.meta.env.DEV && (
        <p className={styles.fieldHelp}>
          Local test account: player@example.test
          <br />
          Test code: 123456
        </p>
      )}
    </div>
  )
}

function maskEmail(normalizedEmail: string): string {
  const [local, domain] = normalizedEmail.split('@')
  if (!local || !domain) {
    return normalizedEmail
  }
  const visible =
    local.length <= 1 ? local : `${local[0]}${'*'.repeat(Math.min(3, local.length - 1))}`
  return `${visible}@${domain}`
}

function startLoginMessage(status: number): string {
  return status === 429
    ? 'Please wait a moment before requesting another code.'
    : status >= 500
      ? 'Sign-in is unavailable. Try again shortly.'
      : 'Enter a valid email address.'
}

function verifyLoginMessage(status: number): string {
  return status === 429
    ? 'Too many attempts. Request a new code.'
    : 'That code is invalid or expired.'
}

function loginAnalyticsReason(status: number): string {
  return status === 429 ? 'too-many-attempts' : 'invalid-code'
}
