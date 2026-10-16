import assert from 'node:assert/strict'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const challengesDir = resolve(root, 'public/challenges')
const output = resolve(root, 'src/features/challenges/browser-challenges.generated.json')

function metadata(text: string): Map<string, string> {
  const section = text.match(/\[metadata\]\s*([\s\S]*?)\s*\[state\]/)?.[1]
  assert(section, 'Puzzle is missing [metadata] or [state]')
  return new Map(
    section
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf(':')
        assert(separator > 0, `Invalid metadata line: ${line}`)
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
}

const challenges = readdirSync(challengesDir)
  .filter((file) => file.endsWith('.pzl'))
  .sort()
  .map((file) => {
    const fields = metadata(readFileSync(resolve(challengesDir, file), 'utf8'))
    const turns = Number(fields.get('Turns'))
    assert(Number.isInteger(turns) && turns > 0, `${file} needs positive integer Turns`)
    const name = fields.get('Name')
    const objective = fields.get('Description')
    assert(
      name && fields.get('Goal') && objective,
      `${file} needs Name, Goal, Turns, and Description`,
    )
    return { id: basename(file, '.pzl'), name, objective, turns }
  })

assert(challenges.length > 0, 'At least one bundled challenge is required')
const manifest = `${JSON.stringify(challenges, null, 2)}\n`
if (process.argv.includes('--check')) {
  assert.equal(readFileSync(output, 'utf8'), manifest, 'Run bun run challenge:manifest')
} else {
  writeFileSync(output, manifest)
}
