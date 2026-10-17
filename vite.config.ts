import react from '@vitejs/plugin-react'
import { seo } from './scripts/seo'
import { defineConfig, type Plugin } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'

function gitSha(): string {
  const raw =
    process.env['GIT_SHA'] ??
    (() => {
      try {
        return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
      } catch {
        return 'dev'
      }
    })()
  return raw.slice(0, 7)
}

const webPort = process.env['LEYLINE_WEBDOOR_PORT'] ?? '8080'
const webUrl = process.env['LEYLINE_WEBDOOR_URL'] ?? `http://127.0.0.1:${webPort}`
const allowedHosts =
  process.env['VITE_ALLOWED_HOSTS']
    ?.split(',')
    .map((host) => host.trim())
    .filter(Boolean) ?? []

/**
 * Serves `dev/transcripts/*.greplay.json` at `/transcripts/…` for the replay
 * tool, in dev only.
 *
 * They live outside `public/` on purpose: everything in `public/` is copied into
 * a production build, and a saved-game transcript is a development input, not
 * something to ship. `apply: 'serve'` keeps this out of the build entirely.
 */
function devTranscripts(): Plugin {
  return {
    name: 'forge-web-dev-transcripts',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/transcripts', (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0] ?? ''
        if (!/^[\w.-]+\.greplay\.json$/.test(name)) {
          return next()
        }
        const file = fileURLToPath(new URL(`./dev/transcripts/${name}`, import.meta.url))
        if (!existsSync(file)) {
          return next()
        }
        res.setHeader('Content-Type', 'application/json')
        createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  define: {
    __GIT_SHA__: JSON.stringify(gitSha()),
  },
  plugins: [react(), devTranscripts(), seo()],
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
      '@shell': fileURLToPath(new URL('./src/shell', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    sourcemap: process.env['FORGE_WEB_PRIVATE_SOURCEMAPS'] === 'true' ? 'hidden' : false,
    // Chunk splitting for better caching
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react')) {
            return 'react'
          }
          if (id.includes('node_modules/zod')) {
            return 'validation'
          }
          return undefined
        },
      },
    },
    // Enable CSS code splitting
    cssCodeSplit: true,
    // Target modern browsers for smaller bundles
    target: 'es2020',
    // Minification
    minify: 'esbuild',
  },
  server: {
    allowedHosts,
    proxy: {
      '/api': {
        target: webUrl,
      },
    },
  },
})
