import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test } from '@playwright/test'

test('eight concurrent matches advance and release their slots for a second wave', async ({
  baseURL,
}, info) => {
  const { stdout } = await promisify(execFile)(
    'node',
    ['--experimental-strip-types', 'scripts/check-match-capacity.ts'],
    { env: { ...process.env, FORGE_WEB_BASE_URL: baseURL }, timeout: 240_000 },
  )
  await info.attach('capacity', { body: stdout, contentType: 'application/json' })
})
