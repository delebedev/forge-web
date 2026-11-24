export interface Challenge {
  id: string
  name: string
  objective: string
}

/** Development fixtures listed on the challenges page. */
export const DEV_CHALLENGE_IDS = [
  'gre-game-over-bolt',
  'scry-wall-of-runes',
  'brainstorm-order',
  'sacrifice-cost-confirm',
  'distribution-arc-lightning',
  'mystical-teachings-grouped-search',
]

const PUZZLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const GOALS: Record<string, string> = {
  survive: 'Survive',
  'destroy specified permanents': 'Destroy the specified permanents',
  'destroy specified creatures': 'Destroy the specified creatures',
  'remove specified permanents from the battlefield':
    'Remove the specified permanents from the battlefield',
  'kill specified creatures': 'Kill the specified creatures',
  'put the specified permanent on the battlefield':
    'Put the specified permanent on the battlefield',
  'play the specified permanent': 'Play the specified permanent',
  'gain control of specified permanents': 'Gain control of the specified permanents',
  "win before opponent's next turn": "Win before the opponent's next turn",
}

/** Reads a puzzle's `[metadata]` section into its challenge name and objective. */
export function puzzleChallenge(id: string, text: string): Challenge {
  const metadata = new Map<string, string>()
  let inMetadata = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inMetadata = line.toLowerCase() === '[metadata]'
      continue
    }
    const separator = line.indexOf(':')
    if (inMetadata && separator > 0) {
      metadata.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
    }
  }
  const goal = GOALS[metadata.get('goal')?.toLowerCase() ?? ''] ?? 'Win'
  const turns = Number(metadata.get('turns'))
  const limit =
    Number.isInteger(turns) && turns > 0 ? ` within ${turns} ${turns === 1 ? 'turn' : 'turns'}` : ''
  const description = metadata.get('description')
  const objective = [`${goal}${limit}.`, description].filter(Boolean).join(' ')
  return { id, name: metadata.get('name') ?? id, objective }
}

/** A development puzzle served by the Vite dev server, or null when it is absent. */
export async function fetchDevPuzzle(
  id: string,
): Promise<{ challenge: Challenge; text: string } | null> {
  if (!PUZZLE_ID.test(id)) {
    return null
  }
  const response = await fetch(`/dev/puzzles/${id}.pzl`)
  if (!response.ok) {
    return null
  }
  const text = await response.text()
  return { challenge: puzzleChallenge(id, text), text }
}
