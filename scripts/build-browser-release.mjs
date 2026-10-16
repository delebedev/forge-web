import { createHash } from 'node:crypto'
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = join(root, 'public/browser-engine')
const objects = join(output, 'objects')

rmSync(objects, { recursive: true, force: true })

mkdirSync(join(output, 'web'), { recursive: true })
for (const name of ['engine-worker.js', 'runtime-preload.json']) {
  cpSync(join(root, 'browser-engine/web', name), join(output, 'web', name))
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function revision(directory) {
  return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
}

const assets = files(output)
  .filter((path) => !path.endsWith('/release.json'))
  .map((path) => {
    const bytes = readFileSync(path)
    const hash = sha256(bytes)
    const asset = {
      path: relative(output, path),
      url: `/browser-engine/objects/${hash}/${path.split('/').at(-1)}`,
      bytes: statSync(path).size,
      sha256: hash,
    }
    if (path.endsWith('.gz')) {
      const content = gunzipSync(bytes)
      return { ...asset, contentBytes: content.byteLength, contentSha256: sha256(content) }
    }
    return asset
  })
  .sort((left, right) => left.path.localeCompare(right.path))

for (const asset of assets) {
  const target = join(output, asset.url.replace('/browser-engine/', ''))
  mkdirSync(join(target, '..'), { recursive: true })
  cpSync(join(output, asset.path), target)
}

const classpath = JSON.parse(readFileSync(join(output, 'lib/classpath.json'), 'utf8'))
const catalog = JSON.parse(readFileSync(join(output, 'catalog/manifest.json'), 'utf8'))
const startupAssets = [
  'web/engine-worker.js',
  'web/runtime-preload.json',
  'catalog/card-images.json.gz',
  'lib/classpath.json',
  ...classpath.map((name) => `lib/${name}`),
  'catalog/manifest.json',
  ...[catalog.archive, catalog.index, catalog.cardNames]
    .filter(Boolean)
    .map((entry) => `catalog/${entry.file}`),
]
for (const path of startupAssets) {
  if (!assets.some((asset) => asset.path === path)) {
    throw new Error(`Missing startup asset: ${path}`)
  }
}

const release = {
  schemaVersion: 2,
  frontendCommit: revision(root),
  leylineCommit: revision(join(root, 'leyline')),
  forgeCommit: revision(join(root, 'leyline/forge')),
  assets,
  startupAssets,
}
const releaseId = sha256(JSON.stringify(release))
writeFileSync(
  join(output, 'release.json'),
  `${JSON.stringify({ ...release, releaseId }, null, 2)}\n`,
)
console.log(releaseId)
