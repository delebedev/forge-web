/** Extract bounded identifiers from Java cause chains without retaining exception messages. */
export function browserFailureDetails(error: unknown): {
  exceptionClass: string
  failingFrame?: string
  projection?: { grpId: number; field: string; value: number }
} {
  const seen = new Set<unknown>()
  let text = ''
  let name = 'unknown'
  while (error instanceof Error && !seen.has(error) && seen.size < 8) {
    seen.add(error)
    const stack = error.stack ?? ''
    const detail = stack.includes(error.message) ? stack : `${error.message}\n${stack}`
    text += `\n${detail}`.slice(0, 16_384)
    name = /^[\w.$]{1,120}$/.test(error.name) ? error.name : 'unknown'
    error = error.cause
  }
  const causes = [
    ...text.matchAll(
      /(?:^|\n)(?:[\w.$]+:[ \t]*)?(?:Caused by:[ \t]*)?((?:[\w$]+\.)+[\w$]*(?:Exception|Error))(?=:|\s|$)/g,
    ),
  ]
  const cause = causes.at(-1)
  const frame =
    cause &&
    text
      .slice(cause.index! + cause[0].length)
      .split('\n', 2)[1]
      ?.match(/^[ \t]*at[ \t]+(?:[\w.$@-]*\/){0,2}([\w$<>.-]+)\(/)
  const projection = text.match(
    /Card projection failed: grpId=(-?\d+) field=(types|subtypes|supertypes|colors) value=(-?\d+)/,
  )
  const numeric = projection && [Number(projection[1]), Number(projection[3])]
  return {
    exceptionClass: cause?.[1]?.slice(0, 120) ?? name,
    failingFrame: frame?.[1]?.slice(0, 200),
    projection: numeric?.every(
      (n) => Number.isInteger(n) && n >= -2_147_483_648 && n <= 2_147_483_647,
    )
      ? { grpId: numeric[0]!, field: projection![2]!, value: numeric[1]! }
      : undefined,
  }
}

/** Only browser/OS family and version leave the page; the full user agent stays local. */
export function browserFailureEnvironment(userAgent: string): Record<string, string> {
  const browsers = [
    ['Edge', /Edg(?:A|iOS)?\/([\d.]+)/],
    ['Opera', /OPR\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ] as const
  const systems = [
    ['Android', /Android ([\d.]+)/],
    ['iOS', /(?:CPU(?: iPhone)? OS|iPhone OS) ([\d_]+)/],
    ['macOS', /Mac OS X ([\d_]+)/],
    ['Windows', /Windows NT ([\d.]+)/],
    ['Linux', /Linux/],
  ] as const
  const browser = browsers.find(([, pattern]) => pattern.test(userAgent))
  const system = systems.find(([, pattern]) => pattern.test(userAgent))
  return {
    browser_family: browser?.[0] ?? 'unknown',
    browser_version: browser?.[1].exec(userAgent)?.[1]?.slice(0, 32) ?? 'unknown',
    os_family: system?.[0] ?? 'unknown',
    os_version: system?.[1].exec(userAgent)?.[1]?.replaceAll('_', '.').slice(0, 32) ?? 'unknown',
  }
}
