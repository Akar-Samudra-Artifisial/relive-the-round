# Junie session 10: 3D renderer, phase 3 (pure camera math and renderer selection)

| Field | Value |
|---|---|
| Session id | `session-261122-033013-pb9y` |
| Junie task name | "Implement Pure 3D Camera Math and Renderer Selection" (`summary.json`) |
| Session created / updated | 2026-11-22 03:30 / 03:32 (UTC+8 assumed, from `summary.json`) |
| Model | `claude-opus-5-5`, effort `medium`; lifecycle `COMPLETED` |
| Plan file | `.junie/plans/3d-phase3-camera-math.md` |
| Outcome | Code committed in `804000d` (2026-11-22 03:42 +0800) |

## Prompt

Turn 1 ([`prompt.md`](prompt.md)) asks for camera math with no three.js or page access, plus a pure renderer-selection function; the game keeps rendering with Pixi. Turn 2, verbatim: `Implement the suggested plan`.

## What Junie did

| File | Change (from `### Edited`) |
|---|---|
| `web/src/render/three3d/camMath.ts` (new) | +148 (30° FOV, 58° pitch, `fitCamera`, `project`, `groundPoint`, `ndcFromClient`) |
| `web/src/render/select.ts` (new) | +28 (`pickRenderer`, `detectCaps`) |
| `web/src/game/gamePage.ts` | +4 (picks once at startup; logs once when 3D is requested but not implemented) |
| `web/tests/camMath.test.ts` (new) | +116, then +6 -1 |
| `web/tests/select.test.ts` (new) | +23 (7 URLs, each with and without WebGL2) |
| `web/tests/frameView.test.ts` | +21 (purity guard covers the new files; only `detectCaps` exempt) |
| `docs/3d-renderer.md` | "Phase 3 — camera math" section |

## Checks (from the transcript)

```text
Tests  205 passed (205)
verify-dist: OK (6 level(s); no calib/raw data/local paths/UUIDs/e-mails/debug code)
```

- Main bundle grew by 184 B gzip (+471 B raw), measured against the same build with the committed `gamePage.ts`; three.js is not in it.
- Headless Chrome against the dev server that was already running on port 5177: `/?auto&seed=42` gives 500 points, 3.7 s / 6.0 s, 2/3 kills; `/?3d=1` logs the line once and still draws 2D; `/?2d=1` and `/` log nothing; no page errors.

## Deviations Junie reported

- **Horizon test changed.** The planned check `groundPoint(cam, 0, 1.5)` returns a point, not null: at 58° pitch the horizon sits about 5.97 screen half-heights above centre. Junie derived the horizon from FOV and pitch and tests rays just above (null) and just below (hit).
- **Reason label.** The plan did not name a reason for a 3D pick; `pickRenderer` returns `"requested"`.

## Human interaction

- Plan gate: `Implement the suggested plan`.
- One "Yes" answer in `transcript.md` (what it approved was not checked).

## Problems seen

Four commands are marked `### Failed`: a `cat >> docs/3d-renderer.md` append command (reason not examined), a Python import of Playwright (`ModuleNotFoundError: No module named 'playwright'`), `pnpm dev --port 5177 --strictPort` (`Error: Port 5177 is already in use`; the parity check then used the already running server) and a parity script run (the interpreter could not open the script file). The browser check later completed.

## Outcome

```
804000d 2026-11-22 03:42 +0800 feat: add pure camera math and renderer selection
 9 files changed, 674 insertions(+)
```
