import { trackDiscordClick, type DiscordPlacement } from './observability/analytics'

/** Never-expiring invite to the Forge Web community Discord server. */
export const DISCORD_INVITE_URL = 'https://discord.gg/geHVQdbMM3'

export function discordLinkProps(placement: DiscordPlacement) {
  return {
    href: DISCORD_INVITE_URL,
    target: '_blank',
    rel: 'noopener noreferrer',
    onClick: () => trackDiscordClick(placement),
  } as const
}
