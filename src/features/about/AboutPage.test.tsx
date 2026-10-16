import { afterEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RouterProvider } from '@app/router'
import { AboutPage } from './AboutPage'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

function about(origin: string): string {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin } },
  })
  return renderToStaticMarkup(
    <RouterProvider>
      <AboutPage />
    </RouterProvider>,
  )
}

test('local About invites contribution without embedding production feedback', () => {
  const html = about('http://localhost:5173')
  expect(html).toContain('href="https://github.com/delebedev/forge-web"')
  expect(html).toContain('Explore the source and contribute')
  expect(html).toContain('mailto:hello@forgeweb.app')
  expect(html).toContain('This copy does not send reports')
  expect(html).not.toContain('tally.so')
  expect(html).not.toContain('<iframe')
})

test('production About retains feedback without a GitHub account', () => {
  const html = about('https://forgeweb.app')
  expect(html).toContain('https://tally.so/r/obMXDX')
  expect(html).toContain('title="Contact Forge Web"')
})
