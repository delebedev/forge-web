import { PLAYWRIGHT_CLI, playwrightEnv } from './lib/playwright-env'
import { rmSync } from 'node:fs'

const selector = process.argv[2] ?? 'challenge/lethal-bolt'
if (!/^[a-zA-Z0-9._/-]+$/.test(selector)) {
  console.error(`Invalid puzzle scenario selector: ${selector}`)
  process.exit(1)
}
const slug = selector.replace(/[^a-zA-Z0-9._-]+/g, '-')
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const outputDir = `${import.meta.dir}/../.local/acceptance-runs/${timestamp}-${slug}`

const test = Bun.spawn({
  cmd: ['node', PLAYWRIGHT_CLI, 'test', 'e2e/mobile-challenge-video.spec.ts', '--project=iphone'],
  cwd: import.meta.dir + '/..',
  env: playwrightEnv('challenge-video', {
    CHALLENGE_VIDEO_OUTPUT_DIR: outputDir,
    CHALLENGE_VIDEO_SCENARIO: selector,
  }),
  stdout: 'inherit',
  stderr: 'inherit',
})

const testExit = await test.exited
if (testExit !== 0) {
  process.exit(testExit)
}

const frames: string[] = []
for await (const path of new Bun.Glob('frames/*.png').scan({ cwd: outputDir, absolute: true })) {
  frames.push(path)
}
if (frames.length < 2) {
  console.error(`Expected recorded frames, found ${frames.length} in ${outputDir}`)
  process.exit(1)
}

const mp4 = `${outputDir}/forge-web-mobile-${slug}-iphone.mp4`
const encode = Bun.spawn({
  cmd: [
    'ffmpeg',
    '-framerate',
    '10',
    '-i',
    `${outputDir}/frames/%06d.png`,
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

rmSync(`${outputDir}/frames`, { recursive: true, force: true })
console.log(mp4)
