import { readdir, readFile } from 'node:fs/promises'

const base = new URL(process.env.FORGE_WEB_DEV_URL ?? 'http://127.0.0.1:8080')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Dev provisioning requires a loopback server URL')
}
const email = process.env.FORGE_WEB_DEV_EMAIL ?? 'player@example.test'
const code = process.env.FORGE_WEB_DEV_CODE ?? '123456'
let cookie = ''
async function api(path, data) {
  const response = await fetch(new URL(path, base), {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}: ${await response.text()}`)
  }
  const session = response.headers.getSetCookie().find((value) => value.startsWith('web_session='))
  if (session) {
    cookie = session.split(';')[0]
  }
  return response.status === 204 ? null : response.json()
}

await api('/api/auth/request-code', { email })
const { playerId } = await api('/api/auth/verify', { email, code })
if (!playerId || !cookie) {
  throw new Error('Dev login did not return a player and session')
}
const existing = await api('/api/decks')
const directory = new URL('../dev/decks/', import.meta.url)
const pending = []
for (const file of (await readdir(directory, { recursive: true }))
  .filter((file) => file.endsWith('.txt'))
  .sort()) {
  const name = file.split('/').at(-1).slice(0, -4)
  if (existing.some((deck) => deck.name === name)) {
    console.log(`Kept: ${name}`)
    continue
  }
  const text = await readFile(new URL(file, directory), 'utf8')
  const parsed = await api('/api/cards/parse-decklist', { text })
  const cards = (rows) => rows.map(({ grpId, quantity }) => ({ grpId, quantity }))
  const commandZone = cards(parsed.commandZone ?? [])
  const total =
    parsed.mainboard.reduce((total, card) => total + card.quantity, 0) +
    commandZone.reduce((total, card) => total + card.quantity, 0)
  const expected = commandZone.length ? 100 : 60
  if (total !== expected) {
    throw new Error(`${name}: expected ${expected} cards, got ${total}`)
  }
  pending.push({
    playerId,
    name,
    format: commandZone.length ? 'Commander' : 'Timeless',
    mainDeck: cards(parsed.mainboard),
    sideboard: cards(parsed.sideboard),
    commandZone,
  })
}
// Resolve every list before writing any decks so missing cards fail before provisioning.
for (const deck of pending) {
  await api('/api/decks', deck)
  console.log(`Created: ${deck.name}`)
}
console.log(`Ready: ${email} at ${base.origin}`)
