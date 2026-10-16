# Browser Automation Contract

What end-to-end tests are allowed to select on, and what the application
guarantees in return.

## Why this exists

Styling moves constantly and CSS Modules hash class names, so a selector like
`.hand .card` breaks for reasons that have nothing to do with behavior. A suite
that fails on restyling stops being an oracle and becomes noise.

Selectors here describe *what a thing is to a player*, not how it is rendered,
so they survive restyling and recomposition.

## Rules

1. **Prefer role and accessible name.** Anything a player operates or reads is
   reachable through `getByRole`, `getByLabel`, or `getByText`. If a control is
   hard to select this way, that is usually an accessibility defect worth fixing
   rather than routing around.
2. **Use `data-*` only for game identity.** Card instances, zone membership, and
   engine-level values have no accessible-name equivalent and must not be forced
   into one. Those get attributes from the table below.
3. **Never select on class names, tag structure, or nesting depth.** No
   `.hand .card`, no `div > span`, no `nth-child` positional chains. Ordinal
   selection within an already-identified set (`.first()`, `.nth(1)`) is fine.
4. **Extend the table, don't improvise.** A new attribute is a contract change:
   add it here in the same commit that introduces it.

## Vocabulary

| Attribute | Applied to | Value |
| --- | --- | --- |
| `data-card` | Any rendered card | Card name, for readable failures |
| `data-instance-id` | Any rendered card or targetable object | GRE instance id |
| `data-zone` | Zone container | `hand`, `battlefield`, `stack`, `graveyard`, `exile`, `sideboard`, `library`, `command` |
| `data-owner` | Zone container | `self` or `opponent` |
| `data-count` | Zone container | Number of objects in the zone |
| `data-player` | Player plate or rail | `self` or `opponent` |
| `data-life` | Life total display | Current life |
| `data-pt` | Creature power/toughness display | `<power>/<toughness>` |
| `data-tapped` | Card | `true` when tapped |
| `data-phased-out` | Card | `true` while phased out, omitted when phased in |
| `data-zone-count` | Hidden zone summary | Observable card count without exposing identities |
| `data-action-types` | Actionable card | Space-separated legal action types |
| `data-action-tuples` | Actionable card | Space-separated per-action `type:alternative[:ability]` tuples |
| `data-action-key` | Exact action control | Canonical `LegalAction` identity |
| `data-action-type` | Exact action control | GRE action type |
| `data-ability-grp-id` | Exact action control | Ability identity when present |
| `data-source-zone` | Action control | GRE `zoneType` of the action's source |
| `data-alternative-cost` | Exact action control | `true` when the action carries an alternative cost |
| `data-prompt` | Prompt container | Prompt kind, e.g. `select-targets`, `declare-attackers` |
| `data-damage-assigner-id` | Combat damage assigner | GRE instance id of the attacker assigning damage |
| `data-damage-recipient-id` | Combat damage recipient | GRE instance id of the blocker or defending player |
| `data-assigned-damage` | Combat damage recipient | Current staged damage amount |
| `data-group-zone-type` | Group destination control | GRE destination zone type |
| `data-group-sub-zone-type` | Group destination control | GRE destination sub-zone type |
| `data-replacement-effect-id` | Replacement choice control | GRE replacement effect id |
| `data-option-type` | Casting option control | GRE casting option type |
| `data-option-index` | Prompt option | Engine option index |
| `data-recipient` | Attack option | Damage recipient identity: `type:teamId:playerSystemSeatId:planeswalkerInstanceId` |
| `data-outcome` | Match outcome banner | `win`, `loss`, `draw` |
| `data-card-art` | Board root | `on` or `off`, from the viewer artwork preference |
| `data-board` | Board root | Present on the match board root |
| `data-turn` | Board root | Turn number |
| `data-priority` | Board root | Seat id holding priority |
| `data-stack` | Board root | Visible stack size |
| `data-phase` | Phase display | Current phase and step |
| `data-puzzle` | Puzzle chip | Puzzle id |

Every attribute above is emitted by a component today. Do not add a row
speculatively: a documented attribute that nothing renders makes any test
written against it match zero elements and pass without asserting anything.
Action and casting-option identities remain data-only so browser automation can
route the exact command without depending on localized player-facing labels.

Zones use accessible names as well (`aria-label="Your creatures"`), so a test
may select a zone either way. Prefer the role-based form when asserting what a
player sees, and the attribute form when asserting engine state.

Two names are reserved because they once meant two things: `data-zone` is a
named zone container only — an action button's numeric GRE `zoneType` is
`data-source-zone` — and a GRE instance id is always `data-instance-id`, never
`data-iid`.

## Challenges

Development challenges and direct puzzle links render the GRE product board.
Use the selectors above for their cards, zones, prompts, and outcome controls.
Puzzle-specific checks may additionally query the `Puzzle objective` region and
the `Restart` and `Return to Challenges` buttons.

## Applying it

Board leaves receive these attributes as props from their container rather than
deriving them, which keeps the contract stable when components are split or
recomposed.
