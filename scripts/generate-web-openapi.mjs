#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import openapiTS, { astToString } from 'openapi-typescript'
import prettier from 'prettier'
import { generateWireSchemas } from './web-wire-schemas.mjs'

const root = resolve(import.meta.dirname, '..')
const check = process.argv.includes('--check')
const inputArgument = process.argv.slice(2).find((arg) => arg !== '--check')
const input = resolve(root, inputArgument ?? 'server/build/generated/openapi/openapi.json')

if (!inputArgument) {
  const generation = spawnSync(resolve(root, 'leyline/gradlew'), [':server:generateOpenApi'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (generation.status !== 0) {
    process.exit(generation.status ?? 1)
  }
}
const document = JSON.parse(readFileSync(input, 'utf8'))
const artifacts = {
  'src/shared/api/types.ts': astToString(await openapiTS(document)),
  'src/shared/api/wire-schemas.ts': generateWireSchemas(document),
}
for (const [path, source] of Object.entries(artifacts)) {
  const file = resolve(root, path)
  const formatted = await prettier.format(source, {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  })
  if (check) {
    if (readFileSync(file, 'utf8') !== formatted) {
      throw new Error(`Stale HTTP contract artifact: ${path}. Run bun run api:types.`)
    }
  } else {
    writeFileSync(file, formatted)
  }
}
