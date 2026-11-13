# Playtest scratch log — Samrajya live 2P (production)

Session: Sun 1 Nov 2026. Production build 20261031060407, Worker cbce12b1.
Viewport: real app in a 390x844 frame (phone layout, mouse input, DPR 1.5 — no touch events).

- Player 1 (user): **Samrat** — Indus Valley Civilization (blue)
- Player 2 (me): **Aether** — Mesopotamian Civilization (red)

Room 7962 was created first, then replaced by **2785** (left 7962 lobby, joined 2785).

## Observed so far
1. Welcome screen: only Create Game / Join Game. No account, no login, no profile.
2. Join step 1: 4-digit code entry. After Next, button shows "Looking…" and Back is disabled while the room lookup runs (~1-2 s). Good.
3. Join step 2: name field + civilization picker. Taken civ is disabled and labelled ", taken".
4. Name is NOT remembered between join attempts (left room 7962, rejoined 2785 -> name field empty again). Civ also not remembered.
5. "Join Game" button is not disabled when the name field is empty (not tested whether it submits).
6. "Leave lobby" leaves immediately with no confirmation.
7. Lobby shows code, copy-link, roster with per-player READY, and a status line.

## Pending
- Waiting for Samrat to start the game.
