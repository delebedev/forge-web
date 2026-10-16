# ADR-005: Load Visible Card Art Eagerly

## Status

Accepted

## Context

Gameplay can become interactive before card artwork finishes loading. The
browser-local page did not open a connection to the card image origin early,
and visible hand and battlefield images opted into lazy loading.

Deck-aware prefetch would require prediction, queue ownership, and limits to
avoid loading many images that never become visible.

## Decision

Preconnect the browser-local page to the card image origin. Let visible
gameplay images use the browser's default eager loading and asynchronous
decoding.

Do not add deck-aware prefetching, a custom image queue, or persistent image
storage without measurements showing that native loading remains too slow.

## Consequences

- Visible artwork is requested as soon as React renders it.
- Connection setup can overlap browser-engine preparation.
- Hidden and merely possible cards are not downloaded.
- Image discovery still waits for card metadata. Revisit bounded prefetching
  only if request timing shows that delay remains material.
