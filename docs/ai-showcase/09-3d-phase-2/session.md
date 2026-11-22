# Junie session 09: 3D renderer, phase 2 (Pixi behind GameRenderer, own frame loop)

| Field | Value |
|---|---|
| Session id | `session-261122-025816-1bcl` |
| Junie task name | "Move Pixi Rendering Behind Renderer Interface and Add Replay Player" (`summary.json`) |
| Session created / updated | 2026-11-22 02:58 / 03:02 (UTC+8 assumed, from `summary.json`) |
| Model | `claude-opus-5-5`, effort `medium`; lifecycle `COMPLETED` |
| Plan file | `.junie/plans/renderer-seam-phase-2.md` |
| Outcome | Code committed in `9f4a99a` (2026-11-22 03:27 +0800) |

This is the phase the prompt calls HIGH RISK: it rewires the game loop. It was gated by the same `/?auto&seed=42` parity run as phase 1 ([`prompt.md`](prompt.md) has the full text).

## Prompt

Turn 1 asks to move all Pixi code behind `GameRenderer`, drive game and replay from our own `requestAnimationFrame` loop instead of the Pixi ticker, and replace `ReplayView` with a renderer-agnostic player. Turn 2, verbatim: `Implement the suggested plan`.

## What Junie did

| File | Change (from `### Edited`) |
|---|---|
| `web/src/game/frameLoop.ts` (new) | +75 (`frameDelta` with the same 100 ms clamp, `createFrameLoop` with injectable hooks) |
| `web/src/render/pixi2d.ts` (new) | +163 (Pixi renderer, `autoStart: false`, `screenToWorld`) |
| `web/src/game/replayPlayer.ts` (new) | +120 (no Pixi or DOM code) |
| `web/src/game/gamePage.ts` | +51 -52, then +41 -32 (one loop, pointer aim via renderer) |
| `web/src/game/challengeLanding.ts` | +1 -1 (`ReplaySpeed` moved) |
| `web/src/game/replayView.ts` | deleted |
| `web/tests/frameLoop.test.ts`, `replayPlayer.test.ts` (new) | +126, +108 |
| `web/tests/frameView.test.ts` | +7 -3, +27, +2 -1 (only allowlisted files may import `pixi.js`; `gamePage.ts` must not; `replayView.ts` must be gone) |
| `docs/3d-renderer.md` | +111 ("Phase 2 — renderer seam", parity tables) |

## Checks (from the transcript)

The import-guard test failed once (`frameView.test.ts` "the game page is Pixi-free and the old replay view is gone") and was fixed. Final results in Junie's task result:

```text
npx tsc --noEmit            clean
pnpm test                   186 passed
uv run pytest               51 passed
pnpm build:public           verify-dist: OK
```

Parity: Junie wrote a temporary comparison script (`parity.mjs`, with a Vite config for a separate checkout of the phase 1 commit), served both versions from the same address, and drove headless Chrome at 1280x800:

- Score card identical: 500 points, 3.7 s / 6.0 s, 2/3 kills, 0 HP, 100%.
- Score screen, replay paused at 0/50/80/100% and the screen after leaving the replay: 0 differing pixels.
- Live ticks 40 and 80 differ by 2,463 and 1,064 pixels, against 2,460 and 1,138 between two runs of the unchanged baseline, so frame timing, not drawing.
- Smoke tests without console errors: keyboard and mouse round, all replay controls, kiosk attract loop, touch mode, `pnpm preview` under the strict CSP.

Junie's own caveat: "The checks used real browser input but were automated, not hand-played. A short hands-on round before merging would still be worth doing." It also noted that the two versions must be served from the same address, because the share QR code on the score screen encodes it.

## Human interaction

- Plan gate: `Implement the suggested plan`.
- 14 "Yes" answers approved Junie's tool actions (the approved actions were not itemised here).

## Problems seen

Three commands are marked `### Failed` in the transcript: a combined `cat`, and two `vite` start attempts for the parity setup (`npx vite --config parity.config.mjs --port 5191 --strictPort`, `npx vite --port 5193 --strictPort`). The failure reasons were not examined here; the parity run later completed.

## Outcome

```
9f4a99a 2026-11-22 03:27 +0800 refactor: move Pixi behind GameRenderer with own frame loop
 12 files changed, 1200 insertions(+), 270 deletions(-)
```

The commit message ends with "Implemented with Junie (WebStorm); plan in .junie/plans/renderer-seam-phase-2.md."
