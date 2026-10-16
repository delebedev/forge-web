import { access, mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const SYSTEM_PROMPT = `Create a small, interesting Magic: The Gathering puzzle as Forge .pzl text.
Return only puzzle text, without a solution or Markdown. Use real exact card names.
The engine will validate the candidate and an ordinary game advisor will try to solve it.
Give the human a concrete reachable win this turn, useful choices, enough mana, and no hidden setup history.
Supported format:
[metadata]
Name:<short name>
Goal:Win
Turns:1
Difficulty:Easy
Description:<objective in plain language>

[state]
ActivePlayer=Human
ActivePhase=Main1
HumanLife=<positive integer>
AILife=<positive integer>
humanhand=<exact card names separated by semicolons>
humanbattlefield=<exact card names separated by semicolons>
humanlibrary=<exact card names separated by semicolons>
aihand=<exact card names separated by semicolons, or empty>
aibattlefield=<exact card names separated by semicolons, or empty>
ailibrary=<exact card names separated by semicolons>

You may also use humangraveyard, humanexile, aigraveyard, aiexile.
Only the card flags |Tapped and |SummonSick are supported. No token definitions, invented flags, custom abilities or comments.
Use repeated card names for multiple copies. Include a few cards in each library to avoid accidental deck loss.
Keep the entire position below 100 cards. Do not describe the solution in Description.`

type GenerationOptions = { prompt: string; apiKey: string; model: string; seed?: number }

export async function generatePuzzle(options: GenerationOptions, fetcher: typeof fetch = fetch) {
  if (!options.apiKey) {
    throw new Error('Set OPEN_ROUTER_API_KEY or OPENROUTER_API_KEY')
  }
  if (!options.prompt.trim()) {
    throw new Error('A generation prompt is required')
  }
  const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.25,
      max_tokens: 2000,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: options.prompt },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    throw new Error(`Puzzle generation failed: OpenRouter HTTP ${response.status}`)
  }
  const body = (await response.json()) as {
    id?: string
    model?: string
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenRouter returned no puzzle text')
  }
  const trimmed = content.trim()
  const puzzleText = (
    trimmed.match(/^```(?:pzl|ini|text)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed
  ).trim()
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    validation: 'not_run' as const,
    provider: 'openrouter',
    providerRequestId: body.id ?? null,
    model: body.model ?? options.model,
    requestedModel: options.model,
    prompt: options.prompt,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.25,
    seed: options.seed ?? null,
    puzzleText,
  }
}

async function requireAbsent(path: string): Promise<void> {
  try {
    await access(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  throw new Error(`Refusing to replace existing candidate artifact: ${path}`)
}

export async function writeGeneratedCandidate(
  output: string,
  candidate: Awaited<ReturnType<typeof generatePuzzle>>,
): Promise<void> {
  const sidecar = `${output}.generation.json`
  await Promise.all([requireAbsent(output), requireAbsent(sidecar)])
  await writeFile(output, `${candidate.puzzleText}\n`, { flag: 'wx' })
  try {
    await writeFile(sidecar, `${JSON.stringify(candidate, null, 2)}\n`, { flag: 'wx' })
  } catch (error) {
    await unlink(output).catch(() => undefined)
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await unlink(sidecar).catch(() => undefined)
    }
    throw error
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      prompt: { type: 'string' },
      out: { type: 'string' },
      model: {
        type: 'string',
        default: process.env['OPENROUTER_MODEL'] ?? 'google/gemini-2.5-flash',
      },
      seed: { type: 'string' },
    },
  })
  if (!values.prompt || !values.out) {
    throw new Error(
      'Usage: node tools/browser-driver/generate.ts --prompt "..." --out candidate.pzl [--model model] [--seed 42]',
    )
  }
  const seed = values.seed === undefined ? undefined : Number(values.seed)
  if (seed !== undefined && !Number.isSafeInteger(seed)) {
    throw new Error('Seed must be an integer')
  }
  const candidate = await generatePuzzle({
    prompt: values.prompt,
    apiKey: process.env['OPEN_ROUTER_API_KEY'] ?? process.env['OPENROUTER_API_KEY'] ?? '',
    model: values.model,
    seed,
  })
  const output = resolve(values.out)
  await mkdir(dirname(output), { recursive: true })
  await writeGeneratedCandidate(output, candidate)
  process.stdout.write(`Generated unvalidated candidate: ${output}\nModel: ${candidate.model}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
