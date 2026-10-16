export interface WhatsNewDay {
  date: string
  headline: string | null
  bullets: string[]
}

type FeedRequest = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'text'>>

const DAY_HEADING = /^## (\d{4}-\d{2}-\d{2})$/
const HEADLINE_HEADING = /^### (.+)$/
const BULLET = /^[-*] (.+)$/

/**
 * Parse the small authored feed format. Dates are calendar dates, authored as
 * ISO headings newest first. Unknown markdown is rejected by design.
 */
export function parseWhatsNew(markdown: string): WhatsNewDay[] {
  const days: WhatsNewDay[] = []
  let current: WhatsNewDay | null = null

  for (const rawLine of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const dayMatch = DAY_HEADING.exec(line)
    if (dayMatch) {
      const date = dayMatch[1]!
      validateDate(date)
      if (days.some((day) => day.date === date)) {
        throw new Error(`Duplicate What's new date: ${date}`)
      }
      if (days.at(-1) && days.at(-1)!.date <= date) {
        throw new Error("What's new dates must be newest first")
      }
      current = { date, headline: null, bullets: [] }
      days.push(current)
      continue
    }

    const headlineMatch = HEADLINE_HEADING.exec(line)
    if (headlineMatch) {
      if (!current) {
        throw new Error("What's new headline has no date")
      }
      if (current.headline) {
        throw new Error(`Duplicate What's new headline: ${current.date}`)
      }
      current.headline = headlineMatch[1]!.trim()
      continue
    }

    const bulletMatch = BULLET.exec(line)
    if (bulletMatch) {
      if (!current) {
        throw new Error("What's new bullet has no date")
      }
      current.bullets.push(bulletMatch[1]!.trim())
      continue
    }

    throw new Error(`Unsupported What's new line: ${line}`)
  }

  return days
}

function validateDate(date: string): void {
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, day!))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid What's new date: ${date}`)
  }
}

export async function loadWhatsNew(request: FeedRequest = fetch): Promise<WhatsNewDay[]> {
  try {
    const response = await request('/whats-new.md', { cache: 'no-store' })
    if (!response.ok) {
      return []
    }
    return parseWhatsNew(await response.text())
  } catch {
    return []
  }
}

export function formatWhatsNewDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year!, month! - 1, day!)),
  )
}
