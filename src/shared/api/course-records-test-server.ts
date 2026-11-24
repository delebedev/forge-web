/** An in-memory `/api/course-records` for store tests, with the server's revision check. */
export function courseRecordServer() {
  const records = new Map<string, { revision: number; document: string }>()
  const requests: string[] = []
  let conflictNext = false
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://test').pathname
    const method = init?.method ?? 'GET'
    requests.push(`${method} ${path}`)
    if (path === '/api/course-records') {
      return Response.json([...records].map(([eventName, record]) => ({ eventName, ...record })))
    }
    const eventName = decodeURIComponent(path.replace('/api/course-records/', ''))
    const current = records.get(eventName)
    if (method === 'GET') {
      return current
        ? Response.json({ eventName, ...current })
        : new Response(null, { status: 404 })
    }
    if (method === 'DELETE') {
      records.delete(eventName)
      return new Response(null, { status: current ? 204 : 404 })
    }
    const body = JSON.parse(init!.body as string) as { revision: number; document: string }
    if (conflictNext || body.revision !== (current?.revision ?? 0)) {
      conflictNext = false
      return new Response('stale', { status: 409 })
    }
    const saved = { revision: body.revision + 1, document: body.document }
    records.set(eventName, saved)
    return Response.json({ eventName, ...saved })
  }) as typeof globalThis.fetch
  return {
    fetch,
    requests,
    put(eventName: string, document: object, revision = 1) {
      records.set(eventName, { revision, document: JSON.stringify(document) })
    },
    document(eventName: string) {
      const record = records.get(eventName)
      return record && { revision: record.revision, ...JSON.parse(record.document) }
    },
    /** The next save is rejected as if another browser had saved first. */
    conflictOnce() {
      conflictNext = true
    },
  }
}
