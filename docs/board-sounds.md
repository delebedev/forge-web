# Board sounds

The board uses a quiet tabletop palette: short card handling and restrained impacts.
The actual draw sounds when a turn's card arrives. No music or ambience.
Frequent actions should remain comfortable over a whole match.

## Cue direction and initial clips

The manifest is `src/shared/sound-cues.ts`. Relative gain and repeat limits live
beside each cue. Files are under `public/sounds/kenney/`.

| Cue | Player-visible event | Initial Kenney source clips |
| --- | --- | --- |
| draw | Cards drawn, one cue per group, fixed clip | Casino: card-slide-3 |
| place | Land played, permanent enters, token arrives | Casino: card-place-1, -2, -3 |
| cast | Spell enters the stack | Casino: card-shove-1, -2 |
| ability | New ability enters the stack | Interface: select_007 |
| select | Target, attacker or blocker selection changes | Interface: tick_001 |
| combat | Selected attackers or blockers finish their declaration | Casino: card-shove-3 |
| tap | Permanent visibly taps, including mana payment | Interface: click_002 |
| damage | Damage shown or life decreases | Interface: drop_004 |
| gain | Life increases | Interface: pluck_001 |
| remove | Discard, destruction, sacrifice, exile, bounce or mill | Casino: card-slide-4, -5 |
| win | Confirmed victory | Interface: confirmation_001 |
| lose | Confirmed defeat | Interface: close_001 |

Clips are intentionally generic. Card color, identity and hidden metadata do not
select sounds. Draws and removals from hidden zones use the same card sounds.
Turn changes, opening prompts, counter bookkeeping, untap steps, hovering,
inspection, phase changes, routine passing and ordinary resolution are silent.
Resolution uses its visible result when that result has a cue. Draw/unknown outcomes are silent.

## Timing and controls

Game cues follow the presentation snapshot that the board displays. Selection
feedback reads the shared prompt, so board and decision-column inputs agree.
Initial hydration, full-state replacement, backwards movement, reconnect,
hidden tabs and leaving the board cancel pending playback. Spectator previews
and match replay inspection have no sound subscription.

Repeated cues within a short burst merge. A batch has at most four voices;
per-cue repeat limits prevent rapid taps, mass draws and removals from becoming
noise. Outcomes replace other queued sounds. Draw always uses one clip; placement,
casting and removal rotate through a small set of variants. Sounds never delay
game input.

Board options contains Sounds, Sound volume and Test sound. The shell mute
button reads the same preference. Preferences persist in the browser. Default
volume is 35%; a stored preference is retained. Browser audio is unlocked by a
pointer or keyboard gesture. Events before unlock are dropped, and a delayed
asset load cannot play an old cue after 250 ms. Missing audio is nonfatal.

## Assets and replacement

Sources: [Kenney Casino Audio 1.1](https://kenney.nl/assets/casino-audio) and
[Kenney Interface Sounds 1.0](https://kenney.nl/assets/interface-sounds).
Both packs are CC0. Their original license notices are stored next to the clips.
The selected Ogg files were converted to mono 44.1 kHz, 96 kbps MP3 for browser
compatibility, trimmed at the start, capped at 900 ms, and faded if they reach
that cap. No Forge sound assets are used.

To replace a sound, change its `files` entry in the manifest, or replace that MP3
in place. Tune `gain` for relative loudness and `cooldown` for repeat frequency.
Preserve the replacement's source and license notice. No event routing changes
are needed. Use Test sound to check the overall volume, then audition a turn,
combat, a multi-card draw and a mass-removal action. The player listening pass
chooses the final timbre and balance; the initial clips are editable defaults.
