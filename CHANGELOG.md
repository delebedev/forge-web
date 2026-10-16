# Changelog

Curated project milestones, newest first. For current feature status, see
`docs/catalog.yaml`. Player-facing updates are published independently from
the production environment. Current known issues live in
`src/features/whats-new/known-issues.md` as plain bullet lines.
Remove resolved issues; edits to this list do not trigger the daily popup.

## 2026-07-26 — React client

- Replaced the Svelte client with React 19 across every route.
- Reorganized the application into feature-first packages behind a single
  React root.

## 2026-07-25 — Anonymous Challenges

- Added public, shareable `/challenges` puzzles with guest sessions and the
  standard GRE play surface.
- Added a reusable iPhone puzzle runner for Leyline acceptance scenarios.

## 2026-07-08 — Leyline web integration

- Promoted the Leyline-backed HTTP and GRE runtime to `main`.
- Moved draft and sealed course flow to REST with direct registered-match joins.
- Hardened match startup, reconnects, spectators, and browser acceptance.

## 2026-06-27 — Frontend workspace

- Flattened the Svelte application to the repository root.
- Added one-command bootstrap for the pinned Leyline backend and frontend
  dependencies.

## 2026-06-04 — Priority and stack interaction

- Added priority stops, deliberate stack interaction, card ordering prompts,
  combat arrows, and keyboard controls.
