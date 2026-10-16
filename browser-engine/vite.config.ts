import { defineConfig, mergeConfig } from 'vite'
import { cpSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import base from '../vite.config'

const browserBase = {
  ...base,
  plugins: base.plugins?.filter(
    (plugin) => (plugin as { name?: string })?.name !== 'forge-web-seo',
  ),
}
const revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
  encoding: 'utf8',
}).trim()
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0

export default mergeConfig(
  browserBase,
  defineConfig({
    define: {
      'import.meta.env.VITE_BROWSER_ENGINE': JSON.stringify('1'),
      'import.meta.env.VITE_BROWSER_BUILD': JSON.stringify(`${revision}${dirty ? '-dirty' : ''}`),
    },
    publicDir: false,
    plugins: [
      {
        name: 'browser-engine-static-assets',
        closeBundle() {
          mkdirSync('dist-browser/browser-engine', { recursive: true })
          for (const directory of ['lib', 'catalog']) {
            cpSync(
              `public/browser-engine/${directory}`,
              `dist-browser/browser-engine/${directory}`,
              { recursive: true },
            )
          }
          cpSync('public/browser-engine/release.json', 'dist-browser/browser-engine/release.json')
          cpSync('browser-engine/decks', 'dist-browser/browser-engine/decks', { recursive: true })
          for (const name of ['engine-worker.js', 'runtime-preload.json']) {
            cpSync(`browser-engine/web/${name}`, `dist-browser/browser-engine/web/${name}`)
          }
          cpSync('public/sounds', 'dist-browser/sounds', { recursive: true })
          cpSync('dist-browser/browser-engine/web/match.html', 'dist-browser/index.html')
        },
      },
    ],
    build: {
      outDir: 'dist-browser',
      rollupOptions: { input: ['browser-engine/web/match.html'] },
    },
  }),
)
