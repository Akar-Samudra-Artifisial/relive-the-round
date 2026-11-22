# Junie session 07: 3D renderer, phase 0 (lazy three.js probe)

| Field | Value |
|---|---|
| Session id | `session-261122-021227-1dsv` |
| Junie task name | "Add Lazy-Loaded Three.js Renderer Probe" (`summary.json`) |
| Session created / updated | 2026-11-22 02:12 / 02:14 (UTC+8 assumed, from `summary.json`) |
| Model | `claude-opus-5-5`, effort `medium` (`settings.json`); lifecycle `COMPLETED` |
| Plan file | `.junie/plans/three-lazy-probe-phase0.md` |
| Outcome | Code committed in `57dc380` (2026-11-22 02:20 +0800) |

**How the session was identified.** `index.jsonl` lists one session with this task name for this project, and the first user turn in `transcript.md` is the phase 0 prompt (same text as [`prompt.md`](prompt.md)). The neighbouring session `261122-013134-psmw` is the touch-controls task (folder 06), so it is not phase 0.

## Prompt

Turn 1 (verbatim in [`prompt.md`](prompt.md)) asks for three.js as a lazily loaded chunk that is requested only when the URL has `?3d=1`, with no change for normal players. Key constraints:

> Do: 1. cd web && pnpm add -E three && pnpm add -E -D @types/three (exact versions, pnpm only). [...]
> Without ?3d=1 the three chunk must NOT be requested.

Turn 2, verbatim: `Implement the suggested plan`.

## Junie's plan

Junie entered Plan mode (`### Entering **Plan** Mode`), read `package.json`, `main.ts`, `sim.test.ts`, `verify-dist.mjs`, `tsconfig.json` and the CSP in `vercel.json`, and wrote a three-step plan:

1. Add the `three` dependency and the `probe.ts` module (named imports `REVISION` and `WebGLRenderer` only, `OffscreenCanvas` with a detached-canvas fallback, `forceContextLoss()` then `dispose()`).
2. Gate a dynamic `import()` behind `?3d` in `main.ts`, extend the sim purity regex, add `three-lazy.test.ts`.
3. Build, verify in a browser, measure gzip sizes, write `docs/3d-renderer.md` and one CHANGELOG line.

## What Junie did

| File | Change (from `### Edited`) |
|---|---|
| `web/src/render/three3d/probe.ts` (new) | +33 |
| `web/src/main.ts` | +9 (fire-and-forget dynamic import, `console.info` / `console.warn`) |
| `web/tests/sim.test.ts` | +3 -1 (sim files may not import `three`) |
| `web/tests/three-lazy.test.ts` (new) | +26 |
| `docs/3d-renderer.md` (new) | +33 ("Phase 0 — bundle") |
| `CHANGELOG.md` | +1 |
| `.junie/plans/three-lazy-probe-phase0.md` | step markers ticked (+2 -2, +2 -2, +1 -1) |

`pnpm add -E` pinned `three` and its types package to exactly `0.187.0`.

## Checks (from the transcript)

```text
Test Files  14 passed (14)
     Tests  155 passed (155)
TSC_OK
verify-dist: OK (6 level(s); no calib/raw data/local paths/UUIDs/e-mails/debug code)
```

Measured with `gzip -c file | wc -c` (Junie's task result):

| Chunk | Raw bytes | Gzip bytes |
|---|---:|---:|
| main `index-*.js` | 398,869 | 122,008 |
| `probe-*.js` (three.js) | 523,502 | 128,025 |

Browser check (Playwright script in Junie's temporary folder, run against `pnpm preview` on port 4177):

```text
/        js requests: index + Pixi chunks only; probe requested: False
/?3d=1   probe chunk loads, logs [3d probe] {revision: 187, webgl2: true}
```

Junie reported no CSP errors on either page.

## Human interaction

- Plan gate: the implementation started only after the user's second turn, `Implement the suggested plan`.
- Three "Yes" answers (`UserResponseEvent`) approved reading Junie's command-output file and creating the Playwright script in its temporary folder.

## Problems seen

- Three commands failed: the `with_server.py` wrapper from the webapp-testing skill failed twice, and an `ls` for browsers under `/Applications` failed. Junie then ran the script against the installed Google Chrome, because Playwright's own Chromium was not downloaded (stated in its task result).
- The build warns that the probe chunk is over 500 kB. Junie noted this as expected, since only `?3d=1` loads it.

## Outcome

```
57dc380 2026-11-22 02:20 +0800 feat: lazy-load three.js probe behind ?3d
 8 files changed, 158 insertions(+), 2 deletions(-)
 (CHANGELOG.md, docs/3d-renderer.md, web/package.json, web/pnpm-lock.yaml,
  web/src/main.ts, web/src/render/three3d/probe.ts, web/tests/sim.test.ts,
  web/tests/three-lazy.test.ts)
```
