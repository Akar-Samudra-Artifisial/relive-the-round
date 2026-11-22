# Junie session 08: 3D renderer, phase 1 (pure FrameView builders)

| Field | Value |
|---|---|
| Session id | `session-261122-022052-m7d8` |
| Junie task name | "Extract Shared FrameView Data for 2D and 3D Rendering" (`summary.json`) |
| Session created / updated | 2026-11-22 02:20 / 02:39 (UTC+8 assumed, from `summary.json`) |
| Model | `claude-opus-5-5`, effort `medium`; lifecycle `COMPLETED` |
| Plan file | `.junie/plans/frameview-phase1.md` |
| Outcome | Code committed in `27fc9b4` (2026-11-22 02:54 +0800) |

## Prompt

Turn 1 (verbatim in [`prompt.md`](prompt.md)) asks to extract what is drawn each frame into pure, tested data (`FrameView`) so Pixi and a later 3D renderer draw from the same source, with pixel output unchanged. Turn 2, verbatim: `Implement the suggested plan`.

## Junie's plan and questions

Junie read the game page, replay view and actor drawing, and found two places where the requested shape conflicted with "pixel output identical":

> 1. **Draw order.** Live play and the YOU replay panel draw downed enemies *mixed in with* live enemies, in enemy order [...] With separate `enemies[]` and `downs[]` lists, one fixed order [...] changes whic[h] [...]
> 2. **Live death frame.** On the tick the player dies, `drawDynamic` still draws the body (hp 0) for one frame before switching to the score screen.

It asked the user two questions in Plan mode ("How should FrameView keep today's layering?" and "What should liveFrame return for the player on the death tick?"). The answer text is not in `transcript.md`; the task result says both rules "were your choices": each enemy and down carries a draw index `z`, and only the replay panels swap a dead player for a down marker. Junie also noticed that the feature branch had diverged from `main`, so it planned to take the "before" baseline from a temporary `main` worktree.

## What Junie did

| File | Change (from `### Edited`) |
|---|---|
| `web/src/render/renderer.ts` (new, types only) | +77 (`FrameView`, `ActorView`, `DownView`, `TracerView`, `PanelSpec`, `GameRenderer`) |
| `web/src/game/frameView.ts` (new) | +94 (`liveFrame`, `youFrame`, `proFrame`) |
| `web/tests/frameView.test.ts` (new) | +190, then +20 -6 |
| `web/src/render/actors.ts` | +1 -8, +3 -1, -1, +21 -1 (`drawFrame`, shared draw path) |
| `web/src/game/gamePage.ts` | +8 -28, -1 |
| `web/src/game/replayView.ts` | +9 -40, +1 |
| `docs/3d-renderer.md` | "Phase 1 — FrameView" section |

## Checks (from the transcript)

One test failed first: the spike test assumed a spike on the synthetic level, but the game only shows a mid-round plant to a defending clutcher.

```text
FAIL  tests/frameView.test.ts > liveFrame > has no spike before the plant and the defuse fields after it
Test Files  1 failed (1)   Tests  1 failed | 10 passed (11)
```

Junie changed the test to use a defending copy of that level (`frameView.test.ts` +20 -6). Final run:

```text
Test Files  15 passed (15)
     Tests  167 passed (167)
verify-dist: OK (6 level(s); no calib/raw data/local paths/UUIDs/e-mails/debug code)
```

Parity check with a Playwright script in Junie's temporary folder, `/?auto&seed=42` in headless Chrome, on `main` (temporary worktree) and on the branch before and after the change:

- Same score card each time: 500 points, lost by death at 3.7 s (pro won in 6.0 s), 2/3 kills, 100% accuracy.
- Replay screenshots at 0, 50, 80 and 100% are pixel-identical.
- Live screenshots differ only by the same amount as two unchanged runs (frame timing).

Junie removed the temporary worktree at the end and left nothing committed.

## Human interaction

- Plan gate: implementation began after `Implement the suggested plan`.
- Two plan questions (above) and four "Yes" approvals for reading screenshots and files in Junie's temporary folder.

## Problems seen

Three commands are marked `### Failed` in the transcript: a `git diff main` combined with other reads, an `ls` for browsers under `/Applications`, and a plan-file tick script (a later tick of the same file shows as edited). The failure reasons were not examined here.

## Outcome

```
27fc9b4 2026-11-22 02:54 +0800 feat: extract pure FrameView builders for renderers
 8 files changed, 649 insertions(+), 77 deletions(-)
```

The commit message ends with "Implemented with Junie (WebStorm); plan in .junie/plans/frameview-phase1.md."
