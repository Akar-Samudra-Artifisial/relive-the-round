# 3D renderer, phase 8 (3D becomes the default) — NOT a Junie session

**This phase was not run in Junie.** Junie's credits were exhausted before it (see [`../13-3d-phase-6/session.md`](../13-3d-phase-6/session.md)). Phase 8 was implemented by a coding agent in another AI coding tool; the tool is not named anywhere in the repository. There is no Junie transcript, `summary.json` or `events.jsonl` for it, so nothing here is quoted from a Junie log.

[`prompt.md`](prompt.md) is headed "Junie task 15" and uses the earlier Junie prompt format, so it was prepared for Junie, but the work was not done there.

## Sources used

- `git show --stat` and the commit message of `fffb9e9` (2026-11-22 17:15 +0800).
- The "Phase 8 — 3D by default" section of `docs/3d-renderer.md`, `CHANGELOG.md` and `AI_SHOWCASE.md`.

The commit message has no "Implemented with Junie" line.

## What the commit contains

```
fffb9e9 2026-11-22 17:15 +0800 feat: make 3D renderer the default when WebGL2 is available
 9 files changed, 179 insertions(+), 20 deletions(-)
```

| File | Change |
|---|---|
| `web/src/render/select.ts` | `pickRenderer`: WebGL2 gives 3D by default; `?2d=1` or `?3d=0` forces 2D (and wins over `?3d=1`); no WebGL2 stays 2D silently |
| `web/src/render/quality.ts` | `initialTier` starts coarse pointers (phones, tablets) at `medium`, unless `?quality=` is set |
| `web/src/game/gamePage.ts` | 2 lines (`matchMedia("(pointer: coarse)")` passed to the tier choice) |
| `web/tests/select.test.ts`, `web/tests/quality.test.ts` | selection table for `""`, `?kiosk=1`, `?3d`, `?3d=1`, `?3d=0`, `?2d=1`, `?2d=0`, `?3d=1&2d=1` with and without WebGL2; coarse-pointer tier cases |
| `docs/3d-renderer.md` | "Phase 8 — 3D by default" section; the earlier phases' "default stays 2D" notes are superseded |
| `CHANGELOG.md`, `AI_SHOWCASE.md` | final 3D renderer entry; note that phases 0–8 shipped and 3D is the default |
| `docs/ai-showcase/15-3d-phase-8/prompt.md` | the prepared prompt |

All phase 7 safety nets stay: lazy `three3d` and `switchable` chunks, one `console.warn` on import or init failure, the runtime swap to 2D and the FPS watchdog.

## Verification recorded in the docs

Facts from the Phase 8 section of `docs/3d-renderer.md`:

- `tsc --noEmit` clean, 300/300 unit tests in 26 files, `verify-dist: OK`.
- Parity: `/?auto&seed=42` (now 3D) and `/?2d=1&auto&seed=42` (2D) give the same score card: 500 points, 3.7 s / 6.0 s, 2/3 kills.
- Browser checks on `pnpm dev`: `/` renders the 3D canvas (`data-engine="three.js r187"`) and requests the `three3d` chunk; `/?2d=1` renders Pixi and requests no three chunk; `/?3d=0` renders Pixi and requests only the phase 0 probe chunk; `__rtr.quality()` reports `high` on desktop, `low` with `?quality=low` and `medium` under a 390x844 touch emulation. No application errors in the console.
- Not browser-tested: the no-WebGL2 path (covered by `select.test.ts` only).
- Chunks a default visitor downloads: entry 404,258 B raw / 123,890 B gzip (+18 B gzip over phase 7); lazily `three3d` 22,535 / 8,204, `switchable` 1,644 / 831, `three.module` 570,492 / 140,692.

## Review and commit

- A separate review agent approved the phase with no blocking findings. Two minor notes: the phase 0 probe still loads on `?3d=0`, and the docs still had "pending browser check" lines, which have since been closed. The review report itself is not stored in the repository.
- The commit `fffb9e9` was created by the orchestrator directly, because the commit agent's `git commit` was rejected three times by the tool permission layer.
