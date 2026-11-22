# Junie session 11: 3D renderer, phase 4 (static 3D map behind ?3d=1)

| Field | Value |
|---|---|
| Session id | `session-261122-034625-1ef3` |
| Junie task name | "Implement the lazy Three.js static map renderer for Phase 4" (`summary.json`) |
| Session created / updated | 2026-11-22 03:46 / 03:49 (UTC+8 assumed, from `summary.json`) |
| Model | `claude-opus-5-5`, effort `medium`; lifecycle `COMPLETED` |
| Plan file | `.junie/plans/three3d-phase4-static-map.md` |
| Outcome | Code committed in `f8d13af` (2026-11-22 04:08 +0800) |

## Prompt

Turn 1 ([`prompt.md`](prompt.md)) asks for a lazily loaded three.js renderer that draws the static map with the phase 3 camera when the URL has `?3d=1`, falling back to 2D on any failure. Turn 2, verbatim: `Implement the suggested plan`.

## What Junie did

| File | Change (from `### Edited`) |
|---|---|
| `web/src/render/palette.ts` (new) | +25 (map colours moved out of `mapView.ts`) |
| `web/src/render/mapView.ts` | +12 -17, -1 (imports the palette; 2D drawing unchanged) |
| `web/src/render/three3d/mapScene.ts` (new) | +246 (floor, grid, spawn zones, sites, 240 cm walls, `disposeMapScene`) |
| `web/src/render/three3d/labels.ts` (new) | +49 (label textures) |
| `web/src/render/three3d/three3d.ts` (new) | +110 (`Three3dRenderer`, ground-plane raycast for `screenToWorld`) |
| `web/src/game/gamePage.ts` | +2 -3, +11 (lazy 3D load, one warning, then 2D) |
| `web/tests/mapScene.test.ts` (new) | +179 |
| `web/tests/camMath.test.ts` | +42 (wide/tall maps, extreme aspect ratios, comparison with a real three.js camera) |
| `web/tests/three-lazy.test.ts` | +29 (only the 3D folder imports three) |
| `docs/3d-renderer.md` | "Phase 4 — static map" section |

## Checks (from the transcript)

```text
Tests  244 passed (244)   (web)       51 ETL tests passed
verify-dist: OK (6 level(s); no calib/raw data/local paths/UUIDs/e-mails/debug code)
```

| Chunk | Raw | Gzip |
|---|---:|---:|
| Main entry | 402,205 B | 123,014 B |
| 3D renderer | 7,378 B | 3,393 B |
| three.js | 564,392 B | 138,722 B |

The entry grew by 466 B raw / 165 B gzip against phase 3 (budget 1.5 kB). Headless Chrome at 1280x800:

- `/?auto&seed=42` in 2D and in 3D shows the same card: 500 points, 3.7 s / 6.0 s, 2/3 kills; no console errors in 3D.
- Aim: shots left within 1.5° of five cursor targets (the weapon's spread).
- Fallback: with WebGL2 disabled the game goes to 2D silently; a blocked 3D load or failed setup logs one warning and plays in 2D.

## Deviation and caveats Junie reported

- One change beyond the plan: labels draw on top of walls, as in 2D, because "DEF SPAWN" sat on a wall and site letters were partly hidden by cover boxes.
- three.js prints its own console error next to the single warning on a failed setup.
- Known gaps: 1 px lines only, no 2D wall glow, slightly different wall shading, first replay panel only, no actors yet.
- No CHANGELOG entry in this session.

## Human interaction

- Plan gate: `Implement the suggested plan`.
- 11 "Yes" answers approving Junie's tool actions (not itemised here).

## Problems seen

Two commands are marked `### Failed`: a combined `cat`/`git status` (reason not examined) and `pnpm dev --port 5177 --strictPort` (the earlier phases' dev server was the likely cause; not examined here).

## Outcome

```
f8d13af 2026-11-22 04:08 +0800 feat: render static 3D map behind ?3d=1
 12 files changed, 1168 insertions(+), 21 deletions(-)
```
