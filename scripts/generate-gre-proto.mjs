import fs from 'node:fs/promises'
import path from 'node:path'
import protobuf from 'protobufjs'

const rootDir = path.resolve(import.meta.dirname, '..')
const outputDir = path.join(rootDir, 'src/engine/generated')
const output = path.join(outputDir, 'messages.json')
const candidates = [
  process.env.LEYLINE_MESSAGES_PROTO,
  path.resolve(rootDir, 'leyline/engine/src/main/proto/messages.proto'),
  path.resolve(rootDir, 'leyline/proto/src/main/proto/messages.proto'),
  path.join(process.env.HOME ?? '', 'src/leyline/engine/src/main/proto/messages.proto'),
].filter(Boolean)

const proto = await firstExisting(candidates)
if (!proto) {
  throw new Error('messages.proto not found; set LEYLINE_MESSAGES_PROTO')
}

const root = await protobuf.load(proto)
await fs.mkdir(outputDir, { recursive: true })
await fs.writeFile(output, `${JSON.stringify(root.toJSON())}\n`)
console.log(`generated ${path.relative(rootDir, output)} from ${proto}`)

async function firstExisting(files) {
  for (const file of files) {
    try {
      await fs.access(file)
      return file
    } catch {
      // try next candidate
    }
  }
  return null
}
