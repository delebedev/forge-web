import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { z } from 'zod'
import * as reporting from '@shared/reporting'
import { apiFetch } from './client'
import { readJson } from './decoding'

let report: ReturnType<typeof spyOn<typeof reporting, 'reportDiagnostic'>>
let request: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>
beforeEach(() => {
  report = spyOn(reporting, 'reportDiagnostic').mockImplementation(() => {})
  request = spyOn(globalThis, 'fetch')
})
afterEach(() => {
  request.mockRestore()
  report.mockRestore()
})

test('unexpected HTTP failures report the static operation and release without consuming the body', async () => {
  const body = { secret: 'private-hand-and-token' }
  const response = Response.json(body, {
    status: 500,
    headers: { 'X-Backend-Release': '123abcd', Authorization: 'private-authorization' },
  })
  request.mockResolvedValue(response)
  expect(await apiFetch('/api/decks/private-deck?token=private-query')).toBe(response)
  expect(await response.json()).toEqual(body)
  expect(report).toHaveBeenCalledTimes(1)
  expect(report.mock.calls[0]?.[2]).toMatchObject({
    failure_category: 'api-http',
    api_operation: 'GET /api/decks/{deckId}',
    http_status: 500,
    backend_release: '123abcd',
  })
  expect(JSON.stringify(report.mock.calls)).not.toContain('private')
})

test('expected HTTP outcomes remain quiet', async () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    request.mockResolvedValue(new Response('private validation body', { status }))
    expect((await apiFetch('/api/decks')).status).toBe(status)
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(report).not.toHaveBeenCalled()
})

test('unknown 503 and unknown routes report without leaking paths or response contents', async () => {
  request.mockResolvedValue(Response.json({ code: 'private-error' }, { status: 503 }))
  await apiFetch('/api/courses/result', { method: 'POST' })
  request.mockResolvedValue(new Response('private response', { status: 500 }))
  await apiFetch('/private/secret-id?token=private-query')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(report).toHaveBeenCalledTimes(2)
  expect(report.mock.calls.find((call) => call[2]['http_status'] === 500)?.[2]).toMatchObject({
    api_operation: 'unknown',
  })
  expect(JSON.stringify(report.mock.calls)).not.toContain('private')
})

test('network failure preserves the original throw while reporting safe context', async () => {
  const failure = new TypeError('Failed to fetch private URL and token')
  request.mockRejectedValue(failure)
  expect(
    await apiFetch('/api/decks/private-id?token=private-query').catch((error: unknown) => error),
  ).toBe(failure)
  expect(report).toHaveBeenCalledTimes(1)
  expect(report.mock.calls[0]?.[2]).toMatchObject({
    failure_category: 'api-network',
    api_operation: 'GET /api/decks/{deckId}',
  })
  expect(JSON.stringify(report.mock.calls)).not.toContain('private')
})

test('cancelled requests preserve their rejection without reporting', async () => {
  const failure = new DOMException('private cancellation', 'AbortError')
  request.mockRejectedValue(failure)
  expect(await apiFetch('/api/decks').catch((error: unknown) => error)).toBe(failure)
  expect(report).not.toHaveBeenCalled()
})

test('invalid JSON reports only the decoding phase and retained response context', async () => {
  const failure = new SyntaxError('private body fragment')
  const response = new Response('private body', { headers: { 'X-Backend-Release': '123abcd' } })
  const parse = spyOn(response, 'json').mockRejectedValue(failure)
  request.mockResolvedValue(response)
  try {
    expect(
      await readJson(await apiFetch('/api/decks/private-id'), z.object({})).catch(
        (error: unknown) => error,
      ),
    ).toBe(failure)
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]?.[2]).toMatchObject({
      failure_category: 'api-response',
      failure_phase: 'json',
      api_operation: 'GET /api/decks/{deckId}',
      http_status: 200,
      backend_release: '123abcd',
    })
    expect(JSON.stringify(report.mock.calls)).not.toContain('private')
  } finally {
    parse.mockRestore()
  }
})

test('schema mismatch retains its original error and omits Zod messages and offending values', async () => {
  const schema = z.object({ name: z.literal('private expected deck name') })
  const response = Response.json({ name: 'private offending hand' })
  const originalParse = schema.parse.bind(schema)
  let thrown: unknown
  const parse = spyOn(schema, 'parse').mockImplementation((data) => {
    try {
      return originalParse(data)
    } catch (error) {
      thrown = error
      throw error
    }
  })
  request.mockResolvedValue(response)
  try {
    let received: unknown
    try {
      await readJson(await apiFetch('/api/decks/private-id'), schema)
    } catch (error) {
      received = error
    }
    expect(received).toBe(thrown)
    expect(received).toBeInstanceOf(z.ZodError)
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]?.[2]).toMatchObject({ failure_phase: 'schema' })
    expect(JSON.stringify(report.mock.calls)).not.toContain('private')
  } finally {
    parse.mockRestore()
  }
})

test('response decoding does not duplicate an already reported HTTP failure', async () => {
  request.mockResolvedValue(new Response('private body', { status: 500 }))
  const response = await apiFetch('/api/decks')
  expect(await readJson(response, z.object({})).catch((error: unknown) => error)).toBeInstanceOf(
    SyntaxError,
  )
  expect(report).toHaveBeenCalledTimes(1)
  expect(report.mock.calls[0]?.[2]).toMatchObject({ failure_category: 'api-http' })
})

test('raw fetch decoding uses an explicit unknown operation when no request metadata exists', async () => {
  expect(
    await readJson(Response.json({}), z.string()).catch((error: unknown) => error),
  ).toBeInstanceOf(z.ZodError)
  expect(report.mock.calls[0]?.[2]).toMatchObject({ api_operation: 'unknown' })
})

test('raw fetch response URLs retain only a known route pattern with an unknown method', async () => {
  const response = Response.json({})
  Object.defineProperty(response, 'url', {
    value: 'https://private-host/api/decks/private-deck?token=private-token',
  })
  expect(await readJson(response, z.string()).catch((error: unknown) => error)).toBeInstanceOf(
    z.ZodError,
  )
  expect(report.mock.calls[0]?.[2]).toMatchObject({
    api_operation: 'unknown',
    api_route: '/api/decks/{deckId}',
  })
  expect(JSON.stringify(report.mock.calls)).not.toContain('private')
})

test('oversized or invalid admission responses remain observable without consuming caller data', async () => {
  for (const body of [
    JSON.stringify({ code: 'match_capacity', message: 'private'.repeat(1024) }),
    'private invalid JSON',
  ]) {
    const response = new Response(body, {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'X-Backend-Release': 'private-header' },
    })
    request.mockResolvedValue(response)
    await apiFetch('/api/courses/result', { method: 'POST' })
    expect(await response.text()).toBe(body)
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(report).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(report.mock.calls)).not.toContain('private')
})

test('an expected admission code on an unrelated endpoint cannot hide a service failure', async () => {
  request.mockResolvedValue(Response.json({ code: 'match_capacity' }, { status: 503 }))
  await apiFetch('/api/decks')
  expect(report).toHaveBeenCalledTimes(1)
})

test('aborting response consumption remains quiet and retains the original rejection', async () => {
  const failure = new DOMException('private cancellation', 'AbortError')
  const response = new Response('private body')
  const parse = spyOn(response, 'json').mockRejectedValue(failure)
  try {
    expect(await readJson(response, z.string()).catch((error: unknown) => error)).toBe(failure)
    expect(report).not.toHaveBeenCalled()
  } finally {
    parse.mockRestore()
  }
})

test('a reporting failure cannot reject an API response', async () => {
  report.mockImplementation(() => {
    throw new Error('diagnostic unavailable')
  })
  const response = new Response('private body', { status: 500 })
  request.mockResolvedValue(response)
  expect(await apiFetch('/api/decks')).toBe(response)
  expect(await response.text()).toBe('private body')
})

test('a reporting failure cannot replace the original network or decoding error', async () => {
  report.mockImplementation(() => {
    throw new Error('diagnostic unavailable')
  })
  const networkFailure = new TypeError('private network error')
  request.mockRejectedValue(networkFailure)
  expect(await apiFetch('/api/decks').catch((error: unknown) => error)).toBe(networkFailure)
  const response = new Response('private body')
  const decodingFailure = new SyntaxError('private decoding error')
  const parse = spyOn(response, 'json').mockRejectedValue(decodingFailure)
  try {
    expect(await readJson(response, z.string()).catch((error: unknown) => error)).toBe(
      decodingFailure,
    )
  } finally {
    parse.mockRestore()
  }
})
