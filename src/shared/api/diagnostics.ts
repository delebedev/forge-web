import { reportDiagnostic } from '@shared/reporting'
import { responseSchemas } from './wire-schemas'

const routes = Object.keys(responseSchemas).map((operation) => {
  const [method, path] = operation.split(' ')
  return { operation, method, path: path!, segments: path!.split('/') }
})
const responseContexts = new WeakMap<Response, { operation: string; handled: boolean }>()

function routeFor(path: string, method?: string) {
  let pathname: string
  try {
    pathname = new URL(path, 'http://api.invalid').pathname
  } catch {
    return undefined
  }
  const candidates = routes.filter((route) => !method || route.method === method.toUpperCase())
  const exact = candidates.find((route) => route.path === pathname)
  if (exact) {
    return exact
  }
  const segments = pathname.split('/')
  return candidates.find(
    (route) =>
      route.segments.length === segments.length &&
      route.segments.every(
        (segment, index) =>
          segment === segments[index] ||
          (segment.startsWith('{') && segment.endsWith('}') && segments[index] !== ''),
      ),
  )
}

function responseTags(response: Response) {
  const context = responseContexts.get(response)
  const release = response.headers?.get('X-Backend-Release') ?? ''
  return {
    api_operation: context?.operation ?? 'unknown',
    ...(context ? {} : { api_route: routeFor(response.url)?.path ?? 'unknown' }),
    http_status: response.status,
    backend_release: /^[a-f0-9]{7,40}$/.test(release) ? release : 'unknown',
  }
}

export function reportApiNetworkFailure(path: string, method: string): void {
  reportDiagnostic(undefined, 'API network request failed', {
    failure_category: 'api-network',
    api_operation: routeFor(path, method)?.operation ?? 'unknown',
  })
}

export async function observeApiResponse(
  response: Response,
  path: string,
  method: string,
): Promise<void> {
  const operation = routeFor(path, method)?.operation ?? 'unknown'
  const context = { operation, handled: response.status >= 400 }
  responseContexts.set(response, context)
  if (!(response.status >= 500)) {
    return
  }
  reportDiagnostic(undefined, 'API HTTP request failed', {
    failure_category: 'api-http',
    ...responseTags(response),
  })
}

export function reportApiResponseFailure(response: Response, phase: 'json' | 'schema'): void {
  const context = responseContexts.get(response)
  if (context?.handled || (response.status >= 400 && response.status < 500)) {
    return
  }
  const tags = responseTags(response)
  if (context) {
    context.handled = true
  } else {
    responseContexts.set(response, { operation: 'unknown', handled: true })
  }
  reportDiagnostic(undefined, 'API response decoding failed', {
    failure_category: 'api-response',
    failure_phase: phase,
    ...tags,
  })
}
