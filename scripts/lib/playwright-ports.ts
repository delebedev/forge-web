const portVariables = {
  frontend: 'FORGE_WEB_PLAYWRIGHT_FRONTEND_PORT',
  backend: 'FORGE_WEB_PLAYWRIGHT_BACKEND_PORT',
  preview: 'FORGE_WEB_PLAYWRIGHT_PREVIEW_PORT',
} as const

export function managedPorts<T extends Partial<Record<keyof typeof portVariables, number>>>(
  defaults: T,
  env: Record<string, string | undefined> = process.env,
): T {
  const ports = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof T & keyof typeof portVariables)[]) {
    const name = portVariables[key]
    const value = env[name]
    if (value !== undefined) {
      if (!/^[0-9]+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
        throw new Error(`${name} must be an integer between 1024 and 65535`)
      }
      ports[key] = Number(value) as T[typeof key]
    }
  }
  const values = Object.values(ports)
  if (new Set(values).size !== values.length) {
    throw new Error('Managed Playwright frontend, backend and preview ports must be distinct')
  }
  return ports
}
