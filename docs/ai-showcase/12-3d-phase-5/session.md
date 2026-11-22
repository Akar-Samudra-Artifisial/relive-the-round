# Junie session 12: 3D renderer, phase 5 (actors, cones, tracers, spike in 3D)

| Field | Value |
|---|---|
| Session id | `session-261122-041053-qbxa` |
| Junie task name | "Implement Three.js Actor Layer for Phase Five Gameplay" (`summary.json`) |
| Session created / updated | 2026-11-22 04:10 / 04:14 (UTC+8 assumed, from `summary.json`) |
| Model | `claude-opus-5-5`, effort `medium`; lifecycle `COMPLETED` |
| Plan file | `.junie/plans/3d-phase5-actors.md` |
| Outcome | Code committed in `47c5923` (2026-11-22 09:45 +0800, later than the session) |

## Prompt

Turn 1 ([`prompt.md`](prompt.md)) asks the 3D renderer to draw the moving parts of each frame (player, enemies, downs, aim and view cones, tracers, spike with pulse and defuse ring) from `FrameView`, with a pooled layer that allocates nothing per frame. Turn 2, verbatim: `Implement the suggested plan`.

## What Junie did

| File | Change (from `### Edited`) |
|---|---|
| `web/src/render/actorStyle.ts` (new) | +20 (colours and sizes shared by 2D and 3D) |
| `web/src/render/actors.ts` | +16 -12 (imports the shared style; 2D drawing unchanged) |
| `web/src/render/three3d/actorScene.ts` (new) | +409 (`ActorLayer`: pools of 5 enemies, 6 downs, 24 tracers; defuse ring via draw range) |
| `web/src/render/three3d/three3d.ts` | +10 -4 (one layer, updated with `frames[0]`) |
| `web/tests/actorScene.test.ts` (new) | +332 (13 tests: counts, axis, heading sign, cones, tracer fade, defuse ring, pulse, no allocation over 50 updates, pool growth, dispose) |
| `web/tests/mapScene.test.ts` | +23 -14 (axis test covers every wall vertex) |
| `web/tests/frameView.test.ts` | +5 -6 (`actorStyle.ts` in the purity guard) |
| `docs/3d-renderer.md` | updated "Still missing" line plus a "Phase 5 — actors" section |

`gamePage.ts`, `frameView.ts` and the sim were not touched.

## Checks (from the transcript)

```text
Tests  257 passed (257)
verify-dist: OK (6 level(s); no calib/raw data/local paths/UUIDs/e-mails/debug code)
```

| Chunk | Raw | Gzip -9 |
|---|---:|---:|
| entry | 402,245 B | 123,027 B (+13 B vs phase 4) |
| three3d | 15,482 B | 6,180 B |
| three | 570,126 B | 140,621 B |

Headless Chrome at 1280x800 against the dev server already running on port 5177: `/?auto&seed=42` (2D) and `/?3d=1&auto&seed=42` (3D) give the same card (lost, 500 points, 3.7 s / 6.0 s, 2/3 kills) with no warnings or errors; `?fps` reads 56–60 in 3D; screenshots show cones, tracers, hit flashes and down markers as in 2D; on level 1 the green defuse arc grows clockwise from 12 o'clock.

## Caveats Junie reported

- Wall occlusion has only indirect evidence: the wall top cuts off an enemy's glow at a site wall and unit tests check that bodies use the depth test, but no screenshot shows an enemy body fully behind a wall.
- 3D bodies are lit cylinders without the 2D outline rims; overlapping downs and enemies are ordered by depth, not the 2D draw order; the spike is a hovering octahedron.
- Still missing: side-by-side replay panels, shadows and quality tiers, the CHANGELOG entry (phases 6–8).

## Human interaction

- Plan gate: `Implement the suggested plan`.
- 11 "Yes" answers approving Junie's tool actions (not itemised here).

## Problems seen

Two commands are marked `### Failed`: `pnpm dev --port 5177 --strictPort` and an `ls` for browsers under `/Applications` (reasons not examined here; the task result says the checks ran against the dev server already running on port 5177).

## Outcome

```
47c5923 2026-11-22 09:45 +0800 feat: render actors, cones, tracers and spike in 3D
 10 files changed, 1269 insertions(+), 38 deletions(-)
```
