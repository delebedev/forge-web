import './app.css'
import '@shared/cards/mana.css'
import '@shared/public-theme.css'
import { initReporting, reportBootstrapFailure } from '@shared/reporting'
import { initSessionReplay } from '@shared/session-replay'
import type { mountApp as MountApp } from './mount'

initReporting()
initSessionReplay()

async function bootstrap(): Promise<void> {
  const target = document.getElementById('app')
  if (!target) {
    throw new Error('Missing #app mount target')
  }

  let mountApp: typeof MountApp
  try {
    mountApp = (await import('./mount')).mountApp
  } catch (error) {
    reportBootstrapFailure(error)
    target.innerHTML = `<main class="public-theme bootstrap-recovery" aria-labelledby="bootstrap-title">
      <div role="alert">
        <h1 id="bootstrap-title">Forge Web could not load</h1>
        <p>Check your connection, then refresh to try again.</p>
      </div>
      <button type="button" class="public-primary">Refresh page</button>
    </main>`
    target.querySelector('button')?.addEventListener('click', () => location.reload())
    return
  }
  mountApp(target)
  if (import.meta.env.DEV) {
    const { installGreDebugBridge } = await import('@shared/debug/gre-debug-bridge')
    installGreDebugBridge()
  }
}

void bootstrap()
