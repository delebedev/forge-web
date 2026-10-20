---
name: Forge Web
description: A desktop tabletop with warm charcoal surfaces, card art and restrained clay actions.
colors:
  primary: "#eb947c"
  primary-hover: "#f5ad96"
  neutral-bg: "#1b1a19"
  neutral-surface: "#292725"
  neutral-text: "#efeee8"
  neutral-muted: "#b0ada7"
  neutral-line: "#efeee82b"
  neutral-field: "#efeee808"
  error: "#ffb4a6"
typography:
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "15px"
    lineHeight: 1.6
  title:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-.035em"
  card-name:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.15
  card-type:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.05
  card-stat:
    fontFamily: "Libre Baskerville, Georgia, serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.1
  card-rules:
    fontFamily: "Roboto Condensed, Arial Narrow, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.3
  life:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "38px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-.04em"
  action:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
rounded:
  control: "3px"
  surface: "4px"
  card: "5px"
spacing:
  tight: "8px"
  control: "12px"
  row: "16px"
  surface: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-bg}"
    typography: "{typography.action}"
    rounded: "{rounded.surface}"
    padding: "12px 22px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  choice:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.control}"
    padding: "12px"
  input:
    backgroundColor: "{colors.neutral-field}"
    textColor: "{colors.neutral-text}"
    rounded: "{rounded.surface}"
    padding: "13px 14px"
---

# Design System: Forge Web

## Overview

**Creative North Star: "The spatial tabletop"**

A spatial tabletop in warm charcoal. Card art supplies most of the color; off-white text and clay actions organize attention. The interface uses DM Sans throughout, open battlefield space and compact controls. Shared shell colors follow the same theme.

This records the implemented desktop system. PRODUCT.md owns product truth; .impeccable/gameplay.md owns the gameplay brief. The former green-and-gold, serif card-room direction is superseded.

**Key Characteristics:**

- Facing creature rows with supporting permanents behind them.
- An adaptive hand at the lower edge and a shared stack/decision column on the right.
- Visible state and exact choices, with hover and keyboard focus for deeper inspection.

## Colors

Primary clay marks an available commitment, active priority and combat links. Its lighter hover state adds feedback without changing the surface. Playable cards in hand use a 2px soft yellow ring (`--hand-playable-border`) to distinguish availability from clay actions and red card frames. Neutral charcoal is the canvas; the lighter neutral surface supports forms, dialogs and previews. Off-white carries essential text; muted warm gray carries secondary labels. Translucent text-colored lines and fields define boundaries without enclosing every region. Error coral remains distinct from normal muted status text.

**The Action Accent Rule.** Use clay for commitments, priority, combat and legal-action cues outside the hand. Use soft yellow for playable hand-card rings. Use off-white boundaries and explicit selection marks to distinguish selection from availability.

The board uses a quiet radial tonal gradient. Card faces, mana symbols, state colors and card backs keep their own semantics; the interface palette does not recolor them. Shared tokens live in `src/shared/public-theme.css` and apply to the root, `.public-theme` and `[data-board]`.

## Typography

DM Sans is both display and body type, with a sans-serif fallback. Google Fonts supplies weights 400–700. Interface hierarchy uses scale, weight and spacing rather than a separate display face. Composed card faces use locally bundled Libre Baskerville Bold for names, type lines and statistics, and Roboto Condensed Medium for rules and chapter prose. DM Sans carries card state and metadata. Card lettering stays local to the face rather than changing interface typography. Names, types and statistics scale with card width up to their documented sizes. Names shrink to fit the space left by the mana cost, down to 6px; only smaller available space uses an ellipsis. Short rules blocks center vertically within the available text area. Rules scale with card width up to 14px. Dense rules fit down to about 79% of that size with tighter leading and a 4px thumbnail floor, remaining scrollable when the small face cannot contain them. The 98px landing face is a thumbnail for inspection, not a prose reading surface.

Body text uses the frontmatter body role. Decision headings use title; life totals use life with tabular numerals. Stack names and action labels are compact (13–14px). Secondary game labels are smaller (10–13px). Outcome headings expand with available space (32–48px). These compact game labels are contextual, not a default body size for new pages.

**The Card Art Rule.** Let card art carry richness. Use compact interface text for identity and state; inspect the full face for rules text.

## Layout

Desktop acceptance covers 1280×720, 1440×900, 1440×1080 and 1920×1080 or larger. Container dimensions drive card sizing; smaller screens have not received mobile or portrait acceptance.

- Battlefield: opposing creature rows face across a thin midline inside a centered stage capped at 1180px. Each side has a rear support row, with land piles on the left and other permanents on the right. Attachments sit behind their host. Creature width adapts to lane count. Dense support groups become two-row grids and reduce the board's card scale.
- Seats: opponent life and public-zone counts sit at upper left, the near seat at lower left. Turn/phase and connection controls occupy the upper right. The opponent hand sits along the upper edge; the near hand fans from the lower edge.
- Hand: card width and overlap respond to available width and hand count. A bounded neighboring lane stays reserved for outside-hand offers even when empty, so priority changes do not recenter the hand. Hover or focus raises a card above neighbors. Keep each card individually inspectable and actionable; this is adaptive overlap, not a fixed seven-card layout or a guarantee for every possible hand size.
- Decisions: stack and ordinary prompts share a right column (292px). Its presence reserves battlefield space (320px). Stack entries scroll; the prompt body scrolls separately. With a prompt, the top stack spell uses its compact name/art row instead of the large preview. Mulligan remains a centered opening-hand panel.
- Shell: the shared public header remains compact (64px). Existing landing/login continuity, deck setup, library and editor compositions retain their local ownership while inheriting shared theme tokens.

**The Visible Commitment Rule.** Scroll decision choices inside their body. Keep the decision heading and commitment footer outside that scrolling area.

`src/features/gre/board/variants/classic/Board.module.css` owns board geometry. Component CSS Modules own cards, hands, stack, prompts, previews and drawers. Avoid another global board skin or broad descendant overrides.

## Elevation & Depth

Open space, tonal contrast and thin lines define the resting table. Card shadows and slight tap rotation distinguish physical objects. Previews, zone drawers and dialogs use soft shadows to rise above the table. Ordinary stack and prompt surfaces stay transparent; dialogs remain appropriate for outcomes and ambiguous action choices. Exact elevation and motion values are in `.impeccable/design.json`.

Motion follows presentation snapshots and protocol-derived moves. Card travel starts from the previous measured visible card position when available, with zone anchors as fallbacks. Missing endpoints produce no travel. Hidden moves use card backs. Battlefield controller changes move the visible card between its measured positions on each side. Draw, cast, resolution and zone changes have short semantic durations; tap, damage, counters, turn changes and signed life deltas add brief feedback. Presentation does not hold a pending decision or a full-state replacement. Reduced motion removes travel and life-delta effects, disables the related animations and uses no presentation dwell. Inspection remains available.

## Shapes

Controls use small corners; surfaces are softly squared and cards keep their own outline. The frontmatter records the recurring control, surface and card radii. A thin border or underline generally separates controls and lists. Card badges and mana symbols may be circular; this does not establish pill-shaped navigation as a global pattern.

## Components

### Actions and fields

Shared primary actions use clay with dark text, at least 48px high. Prompt choices are at least 44px high, with a subtle baseline and full boundary on hover/selection. Selected choices use a light outline, tinted surface and explicit state mark; disabled actions fade and do not accept submission. Inputs use the neutral field tint, a fine line, comfortable padding and visible labels. Keyboard focus on interactive controls uses an off-white outline (2px, offset 4px).

`src/shared/ui/Button.tsx` owns primary, secondary and danger button styles for public forms and deck management. Regular buttons have a 48px minimum height; compact deck controls have a 36px minimum. Gameplay actions and prompt choices keep their own components because their state and sizing come from the match interface.

`src/shared/ui/Field.tsx` owns native text, multiline and select controls for login, deck management and deck-import dialogs. Labels and context-specific sizing stay with each form. `src/shared/ui/Modal.tsx` owns shared dialog focus, dismissal and focus return; dialog contents keep their feature-local layout.

**The Server Authority Rule.** Bind gestures and buttons to the exact supplied legal action or prompt candidate. Never infer legality from artwork, card names, visual state or a mana estimate.

Single-action cards can click or drag to submit that action. Cards with several legal actions open an explicit chooser. Board target selection mirrors the prompt's candidates; the inspectable list preserves exact target identity. Source-to-target links use a pale dashed stroke, combat assignments a clay solid stroke. Motion is visual feedback, not the authority for a command.

### Cards and inspection

Shared portrait widths live in `src/shared/cards/card-sizes.css`: 52px for the
non-hand action rail, 98px as a thumbnail sample, 132px as a hand sample,
160px for stack and public-zone cards, and 220px for default inspection and deck
hover cards. Hand widths remain adaptive (96–178px before overlap constraints);
stack width also fits board height. Board inspection retains its 154–238px
settings range. Battlefield tiles keep their landscape layout and adaptive lane
sizing. Dungeon diagram images have a separate inspection exception up to 360px.
Storybook uses these roles rather than separate 213px or 304px examples.


Battlefield cards are landscape art tiles with persistent names and power/toughness. Hand and preview cards show full faces when known. Counters, attachments, piles and tap state remain on the board. Hover and keyboard focus inspect card detail in a larger left-side preview; stack entries and matching target-list entries share this path. Missing art retains known name, type, cost and statistics where available. Never fabricate missing rules or hidden faces.

Player counter totals sit near the life display, labelled by counter type and separated by player. Zero totals disappear.

Emblems stack vertically as compact creator-image markers in the left margin, separated by owner. Hover, focus or click inspects the emblem effect without opening a zone drawer or inheriting creature characteristics or cast actions.

### Stack and decisions

The stack is a numbered list in resolution order, with ownership and a “Resolves next” label on the first entry. A spell can show its full face when space permits. Abilities stay text/source-thumbnail entries rather than impersonating spell cards; internal trigger-holder objects are omitted. Every displayed entry remains focusable for inspection.

Target prompts identify the source when supplied, show selected/required counts per target group and expose exact candidate names. Other decision kinds retain their own quantity, cost, order or availability information. A new interaction focuses the heading. Multi-choice commitments and cancellation sit in the fixed prompt footer; options that commit immediately remain option buttons. Waiting and validity state govern submission. Current resource text reports tapped lands only: the runtime does not project a true mana pool.

### Public zones and replay

Public-zone inspection opens a right-side drawer with a persistent title/count/close row and a scrolling card grid. It occupies only part of the board. Hidden libraries and opponent hands do not become public merely because an inspection surface exists.

Replay reuses the board and names seats near/far. Known cards, zones, stack and recorded decisions remain inspectable with inert game handlers. Playback gets its own reserved footer (64px), with play/pause, stepping, scrub position and next-stack navigation. It does not borrow the live game's action dock. Keep transport clear of the hand; preserve transcript visibility boundaries. The replay route remains governed by existing feature flags.

## Do's and Don'ts

- Do keep both life totals, current turn/phase and required decisions visible at the supported desktop sizes.
- Do preserve the board/list relationship for exact targets and use keyboard focus as an inspection path.
- Do keep component geometry in its owning CSS Module and shared color/type tokens in public-theme.css.
- Do retain useful text and known metadata when artwork is missing.
- Don't reintroduce green-and-gold felt, heritage display serifs, glass or decorative glow as the interface theme.
- Don't label tapped lands as floating mana or infer a true mana pool.
- Don't expose hidden card faces or make replay/spectator inspection perform game actions.
- Don't describe mobile, portrait or unbounded card counts as verified by this desktop pass.

## Sound

Board audio follows a quiet tabletop palette with short card handling, restrained
impacts and sparse attention cues. Board options owns sound enablement and volume.
[Board sounds](docs/board-sounds.md) owns event choices, grouping and asset replacement.
