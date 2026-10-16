# Forge Web

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Magic players playing against AI, watching live games, and inspecting game replays on desktop and laptop browsers.

## Product Purpose

An existing browser game powered by Forge through the pinned Leyline runtime. The game itself is the primary product surface.

## Capabilities and Constraints

Preserve constructed and Commander play, deck import and editing, email-code authentication, spectator continuity, development replay inspection, connection recovery, and all supported decisions. The server owns game rules and legality. Components submit exact legal actions and prompt choices through the shared game store. Never fabricate legal targets, playable cards, or hidden information.

## Operating Context

Design for mouse and keyboard at 1280×720, 1440×900, 1440×1080 and 1920×1080 or larger. Mobile and portrait work are outside this redesign. Card art and actual game state are existing product content.

## Product Principles

- Gameplay clarity and correct behavior come first.
- Decisions use the server's actual information.
- Preserve spatial context and progressive disclosure.
- Verify rendered behavior through real games and deterministic gameplay scenarios.

## Accessibility & Inclusion

Retain keyboard shortcuts and visible focus. Essential game state must remain knowable without hovering. Preserve legible text, contrast and comfortable pointer targets.
