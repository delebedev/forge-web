import { readFileSync, writeFileSync } from 'node:fs'

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

if (stale.length > 0) {
  console.error(`Stale CSS module declarations:\n${stale.map((path) => `- ${path}`).join('\n')}`)
  console.error('Run: bun run css:types')
  process.exit(1)
}
