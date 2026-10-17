import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Changed specs run in full. These cases connect the unchanged layers on every PR.
export const representatives = {
  product: {
    'e2e/auth-passwordless.spec.ts': ['email code login persists after reload'],
    'e2e/decks.spec.ts': [
      'deck library import, editing and selection retain their controls at laptop size',
    ],
    'e2e/product-smoke.spec.ts': ['lobby imports a playable deck into the library and launches it'],
  },
  gre: {
    'e2e/gre-play.spec.ts': [
      'starts GRE game and plays first land',
      'declares an attacker and submits combat',
      'handles game over after lethal burn puzzle',
    ],
    'e2e/gre-recovery.spec.ts': ['Urborg and Takenuma survive priority and pay for a spell'],
    'e2e/gre-cost-choice.spec.ts': ['additional cost:'],
  },
  catalog: {
    'e2e/forge-catalog.spec.ts': ['casts Jungle Lion from the catalog and deals combat damage'],
  },
}

export const suites = {
  product:
    /(?:auth-passwordless|bootstrap|deck-import|decks|draft|product-smoke|react-challenge|whats-new)\.spec\.ts$/,
  gre: /gre-(?:play|prompts|mulligan|recovery|priority|sounds|cost-choice|equip-cost|repeatable-cost|alternate-life-cost|modal-cancel|search-owner|library-permissions|partner-decks|known-opponent-hand|warp|player-counters|mana-payment|protection-mixed|proliferate)\.spec\.ts$/,
  catalog: /forge-catalog\.spec\.ts$/,
}

export function representativeLocations(file, source, titles) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (ast.parseDiagnostics.length) {
    throw new Error(`Cannot parse ${file}`)
  }
  const found = new Map(titles.map((title) => [title, []]))
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'test'
    ) {
      const title = node.arguments[0]
      if (title && (ts.isStringLiteralLike(title) || ts.isTemplateExpression(title))) {
        const text = ts.isTemplateExpression(title) ? title.getText(ast) : title.text
        for (const expected of titles) {
          if (text === expected || (ts.isTemplateExpression(title) && text.includes(expected))) {
            found.get(expected).push(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return titles.flatMap((title) => {
    const lines = found.get(title)
    if (lines.length !== 1) {
      throw new Error(`Representative ${file}: ${title} matched ${lines.length} calls`)
    }
    return [`${file}:${lines[0]}`]
  })
}

export function selection(suite, breadth, changed, read = (file) => readFileSync(file, 'utf8')) {
  if (!suites[suite] || !['pr', 'full'].includes(breadth)) {
    throw new Error('Unknown browser selection')
  }
  if (breadth === 'full') {
    return []
  }
  const files = changed.filter((file) => file.startsWith('e2e/') && suites[suite].test(file))
  for (const file of files) {
    read(file)
  }
  const selectors = [...files]
  for (const [file, titles] of Object.entries(representatives[suite])) {
    if (!files.includes(file)) {
      selectors.push(...representativeLocations(file, read(file), titles))
    }
  }
  return [...new Set(selectors)]
}

export function changedPaths(base, cwd = '.') {
  if (!/^[0-9a-f]{40}$/.test(base ?? '')) {
    throw new Error('Missing comparison revision')
  }
  return execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, 'HEAD', '--'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .filter(Boolean)
}

const commands = {
  product: ['product:smoke'],
  gre: ['gre'],
  catalog: ['forge-catalog:smoke'],
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [suite, breadth, base, ...extra] = process.argv.slice(2)
  if (!commands[suite]) {
    throw new Error(`Unknown suite ${suite}`)
  }
  let selectors
  try {
    selectors = selection(suite, breadth, breadth === 'pr' ? changedPaths(base) : [])
  } catch (error) {
    // Missing history or a stale representative must expand coverage rather than certify no tests.
    console.warn(`Full ${suite} fallback: ${error.message}`)
    selectors = []
  }
  console.log(`${suite} selection: ${selectors.length ? selectors.join(', ') : 'full suite'}`)
  const args = ['run', ...commands[suite], ...selectors]
  if (suite === 'gre') {
    args.push('--grep-invert', '@mechanic|@qualification')
  }
  args.push(...extra)
  const result = spawnSync('bun', args, { stdio: 'inherit', env: process.env })
  if (result.error) {
    throw result.error
  }
  process.exit(result.status ?? 1)
}
