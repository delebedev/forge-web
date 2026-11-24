/**
 * Feature flags for parked or in-progress surfaces.
 */

/** Shows the Sealed tab beside Draft on the limited page. */
export const SEALED_ENABLED = true

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
