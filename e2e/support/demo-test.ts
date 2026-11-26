import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test as base } from './gre-test'

export const recordDemos = process.env['PRIORITY_DEMO_VIDEO'] === '1'
export const readyForVideo = new WeakSet<Page>()

// Preserve real elapsed time while recording the visible gameplay surface.
export const test = base.extend<{ demoVideo: void }>({
  demoVideo: [
    async ({ page }, use, info) => {
      if (!recordDemos) {
        await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 204 }))
        await use()
        return
      }
      const frames = info.outputPath('frames')
      mkdirSync(frames, { recursive: true })
      let running = true
      const times: number[] = []
      const capture = (async () => {
        while (running) {
          if (readyForVideo.has(page)) {
            const index = times.length
            times.push(Date.now())
            await page.screenshot({
              path: join(frames, `${String(index).padStart(6, '0')}.png`),
              scale: 'css',
            })
          }
          await delay(100)
        }
      })()
      let videoFailure: Error | undefined = undefined
      try {
        await use()
      } finally {
        running = false
        await capture
        if (times.length > 0) {
          const concat = join(frames, 'frames.txt')
          const ended = Date.now()
          writeFileSync(
            concat,
            times
              .map(
                (time, index) =>
                  `file '${String(index).padStart(6, '0')}.png'\nduration ${((times[index + 1] ?? ended) - time) / 1000}`,
              )
              .join('\n') + `\nfile '${String(times.length - 1).padStart(6, '0')}.png'\n`,
          )
          const video = info.outputPath('demo.mp4')
          const result = spawnSync('ffmpeg', [
            '-y',
            '-loglevel',
            'error',
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            concat,
            '-fps_mode',
            'vfr',
            '-c:v',
            'libx264',
            '-preset',
            'fast',
            '-crf',
            '20',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart',
            video,
          ])
          if (result.status !== 0) {
            videoFailure = new Error(result.stderr.toString())
          } else {
            await info.attach('demo', { path: video, contentType: 'video/mp4' })
          }
        }
      }
      if (videoFailure) {
        throw videoFailure
      }
    },
    { auto: true },
  ],
})
