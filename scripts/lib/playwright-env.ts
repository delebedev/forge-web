/**
 * Environment for spawning Playwright from a Bun script.
 *
 * `[run] bun = true` in bunfig.toml symlinks a Bun shim named `node` onto the
 * front of PATH, and Playwright's TypeScript config loader fails under it. Drop
 * the shim directory so the test process and everything it starts — the Vite
 * dev server, the product server — resolve real Node.
 *
 * The result is a minimal allowlist rather than a filtered copy of the parent
 * environment: suites boot their own servers with explicit configuration, and
 * inherited Leyline or auth variables would silently change what is under test.
 */
export function playwrightEnv(
  suite: string,
  extra: Record<string, string | undefined> = {},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      CI: process.env.CI,
      GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
      GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT,
      FORGE_WEB_SERVER_DIST: process.env['FORGE_WEB_SERVER_DIST'],
      FORGE_WEB_FRONTEND_DIST: process.env['FORGE_WEB_FRONTEND_DIST'],
      FORGE_WEB_PLAYWRIGHT_FRONTEND_PORT: process.env['FORGE_WEB_PLAYWRIGHT_FRONTEND_PORT'],
      FORGE_WEB_PLAYWRIGHT_BACKEND_PORT: process.env['FORGE_WEB_PLAYWRIGHT_BACKEND_PORT'],
      FORGE_WEB_PLAYWRIGHT_PREVIEW_PORT: process.env['FORGE_WEB_PLAYWRIGHT_PREVIEW_PORT'],
      PRIORITY_DEMO_VIDEO: process.env['PRIORITY_DEMO_VIDEO'],
      FORGE_CI_REPORT_DIR: process.env['FORGE_CI_REPORT_DIR'],
      HOME: process.env.HOME,
      JAVA_HOME: process.env.JAVA_HOME,
      PATH: process.env.PATH?.split(':')
        .filter((entry) => !entry.includes('/bun-node-'))
        .join(':'),
      SHELL: process.env.SHELL,
      TMPDIR: process.env.TMPDIR,
      USER: process.env.USER,
      FORGE_PROVIDER_DIR: process.env.FORGE_PROVIDER_DIR,
      FORGE_WEB_PLAYWRIGHT_SUITE: suite,
      ...extra,
    }).filter((entry): entry is [string, string] => entry[1] != null),
  )
}

/** Playwright's CLI entry, run through real Node rather than the Bun shim. */
export const PLAYWRIGHT_CLI = 'node_modules/@playwright/test/cli.js'
