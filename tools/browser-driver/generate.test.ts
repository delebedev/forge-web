import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePuzzle, writeGeneratedCandidate } from './generate'

test('retains an unvalidated candidate and generation settings without credentials', async () => {
  const fetcher = (async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    expect(body.seed).toBe(42)
    expect(body.messages[1].content).toBe('A two-spell lethal puzzle')
    return Response.json({
      id: 'request-1',
      model: 'chosen/model',
      choices: [{ message: { content: '```pzl\n[metadata]\nName:Candidate\n```' } }],
    })
  }) as typeof fetch
  const result = await generatePuzzle(
    { prompt: 'A two-spell lethal puzzle', apiKey: 'test-key', model: 'chosen/model', seed: 42 },
    fetcher,
  )
  expect(result.puzzleText).toBe('[metadata]\nName:Candidate')
  expect(result.validation).toBe('not_run')
  expect(result.seed).toBe(42)
  expect(JSON.stringify(result)).not.toContain('test-key')
})

test('provider failure and empty output cannot masquerade as a generated candidate', async () => {
  const options = { prompt: 'Puzzle', apiKey: 'test-key', model: 'chosen/model' }
  expect(
    generatePuzzle(
      options,
      (async () => new Response('', { status: 429 })) as unknown as typeof fetch,
    ),
  ).rejects.toThrow('HTTP 429')
  expect(
    generatePuzzle(options, (async () =>
      Response.json({ choices: [] })) as unknown as typeof fetch),
  ).rejects.toThrow('no puzzle text')
})

test('does not strand a candidate when its generation sidecar already exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-web-candidate-'))
  const output = join(directory, 'candidate.pzl')
  const sidecar = `${output}.generation.json`
  await writeFile(sidecar, 'existing provenance\n')
  try {
    const candidate = await generatePuzzle(
      { prompt: 'Puzzle', apiKey: 'test-key', model: 'chosen/model' },
      (async () =>
        Response.json({
          choices: [{ message: { content: '[metadata]\nName:Candidate' } }],
        })) as unknown as typeof fetch,
    )
    expect(writeGeneratedCandidate(output, candidate)).rejects.toThrow('Refusing to replace')
    expect(readFile(output, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(sidecar, 'utf8')).toBe('existing provenance\n')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
