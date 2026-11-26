import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const check = process.argv.includes('--check')
const stale: string[] = []

for await (const cssPath of new Bun.Glob('src/**/*.module.css').scan('.')) {
  const declarationPath = `${cssPath}.d.ts`
  const classes = [...readFileSync(cssPath, 'utf8').matchAll(/\.([_a-zA-Z][\w-]*)/g)]
    .map((match) => match[1]!)
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort()
  const declaration = [
    'declare const styles: {',
    ...classes.map((name) => `  readonly ${JSON.stringify(name)}: string`),
    '}',
    '',
    'export default styles',
    '',
  ].join('\n')

  if (check) {
    let current = ''
    try {
      current = readFileSync(declarationPath, 'utf8')
    } catch {
      // Report missing declarations through the same stale-file path.
    }
    if (current !== declaration) {
      stale.push(declarationPath)
    }
  } else {
    writeFileSync(declarationPath, declaration)
  }
}

const orphans: string[] = []
if (check) {
  for await (const declarationPath of new Bun.Glob('src/**/*.module.css.d.ts').scan('.')) {
    if (!existsSync(declarationPath.slice(0, -'.d.ts'.length))) {
      orphans.push(declarationPath)
    }
  }
}

if (orphans.length > 0) {
  console.error(`Orphan CSS module declarations:\n${orphans.map((path) => `- ${path}`).join('\n')}`)
  console.error('Delete each declaration whose stylesheet no longer exists.')
}

if (stale.length > 0) {
  console.error(`Stale CSS module declarations:\n${stale.map((path) => `- ${path}`).join('\n')}`)
  console.error('Run: bun run css:types')
}

if (stale.length > 0 || orphans.length > 0) {
  process.exit(1)
}
