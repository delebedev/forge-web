import { describe, expect, it } from 'bun:test'
import { shouldAutoPresentWhatsNew } from './WhatsNewController'

const eligible = {
  developmentBuild: false,
  route: 'game',
  ready: true,
  authenticated: true,
  guest: false,
  accountId: 'account-a',
  activePlayerMatch: false,
  anotherDialogOpen: false,
  latestDate: '2026-09-06',
}

describe("What's new automatic presentation policy", () => {
  it('opens for a resolved real account in a safe Play or Decks lobby', () => {
    expect(shouldAutoPresentWhatsNew(eligible)).toBe(true)
    expect(shouldAutoPresentWhatsNew({ ...eligible, route: 'decks' })).toBe(true)
  })

  it('defers guests, unresolved sessions, active matches, dialogs, and empty feeds', () => {
    for (const change of [
      { guest: true },
      { ready: false },
      { authenticated: false },
      { accountId: null },
      { activePlayerMatch: true },
      { anotherDialogOpen: true },
      { latestDate: '' },
      { route: 'landing' },
      { developmentBuild: true },
    ]) {
      expect(shouldAutoPresentWhatsNew({ ...eligible, ...change })).toBe(false)
    }
  })
})
