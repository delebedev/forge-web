/** Records three complete landing-page spectator games and emits shareable MP4s. */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PLAYWRIGHT_CLI, playwrightEnv } from './lib/playwright-env'

const root = join(import.meta.dir, '..')
const stamp = new Date()
  .toISOString()
  .replaceAll(':', '-')
  .replace(/\.\d{3}Z$/, 'Z')
const outputDir = join(root, '.local', 'acceptance-runs', `${stamp}-spectator`)
mkdirSync(outputDir, { recursive: true })

const test = Bun.spawn({
  cmd: [
    'node',
    PLAYWRIGHT_CLI,
    'test',
    'e2e/spectator-video.spec.ts',
    '--project=chromium',
    '--workers=1',
  ],
  cwd: root,
  env: playwrightEnv('spectator-video', { SPECTATOR_VIDEO_OUTPUT_DIR: outputDir }),
  stdout: 'inherit',
  stderr: 'inherit',
})
const testExit = await test.exited
if (testExit !== 0) {
  process.exit(testExit)
}

for (let index = 0; index < 3; index += 1) {
  const frames = join(outputDir, `game-${index + 1}`, 'frames', '%06d.png')
  const mp4 = join(outputDir, `spectator-game-${index + 1}.mp4`)
  const encode = Bun.spawn({
    cmd: [
      'ffmpeg',
      '-y',
      '-framerate',
      '10',
      '-i',
      frames,
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
      mp4,
    ],
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const encodeExit = await encode.exited
  if (encodeExit !== 0) {
    process.exit(encodeExit)
  }
  console.log(mp4)
}
