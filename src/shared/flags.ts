/**
 * Feature flags for parked or in-progress surfaces.
 */

/**
 * Sealed is parked: /api/sealed/play 500s at match launch, so the
 * sealed-to-game path dead-ends after deck build. Flip back on once the
 * launch path works end-to-end.
 */
export const SEALED_ENABLED = false

/**
 * The puzzle page is parked: the product ships login/constructed
 * first. Puzzle matches themselves still run (the GRE play route accepts a
 * puzzle param and the acceptance suites drive it); only the user-facing
 * entry point is hidden. Flip back on to restore the nav item and
 * /play/puzzle.
 */
export const PUZZLES_ENABLED = false

/** Local operator tool; production builds must not expose private match data. */
export const REPLAY_ENABLED = import.meta.env.DEV
