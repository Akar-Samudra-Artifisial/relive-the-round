# 3D renderer, phase 7 (quality tiers, FPS watchdog, 2D fallback) — NOT a Junie session

**This phase was not run in Junie.** Junie's credits were exhausted during phase 6 (see [`../13-3d-phase-6/session.md`](../13-3d-phase-6/session.md)). Phase 7 was implemented by a coding agent in another AI coding tool; the tool is not named anywhere in the repository. There is no Junie transcript, `summary.json` or `events.jsonl` for it, so nothing here is quoted from a Junie log.

[`prompt.md`](prompt.md) is headed "Junie task 14" and was written in the same format as the earlier Junie prompts (it ends with a prompt block meant for Junie). It was prepared for Junie, but the work was not done there.

## Sources used

- `git show --stat` and the commit message of `fb4c1d9` (2026-11-22 12:20 +0800).
- The "Phase 7 — quality, watchdog, fallback" section of `docs/3d-renderer.md`.

The commit message has no "Implemented with Junie" line, unlike phases 1 and 2.

## What the commit contains

```
fb4c1d9 2026-11-22 12:20 +0800 feat: add 3D quality tiers, FPS watchdog and 2D fallback
 17 files changed, 1278 insertions(+), 27 deletions(-)
```

| Area | Files |
|---|---|
| Pure modules (new) | `web/src/render/quality.ts` (tiers high/medium/low, `?quality=`), `web/src/render/fpsWatchdog.ts` |
| Runtime fallback (new, lazy chunk) | `web/src/render/switchable.ts` (swaps 3D for Pixi 2D on WebGL context loss, load/draw errors or sustained low fps, keeps the round and replay running) |
| Renderer changes | `three3d.ts` (+93, quality tier, `webglcontextlost` listener), `lights.ts` (+33, shadow camera fit), `mapScene.ts`, `actorScene.ts`, `renderer.ts` (optional `setQuality`, `onFail` hooks), `gamePage.ts` (+101, watchdog feeding, swap handling) |
| Tests (new) | `quality.test.ts`, `fpsWatchdog.test.ts`, `switchable.test.ts` (277 lines) |
| Tests (changed) | `frameView.test.ts` (purity list), `mapScene.test.ts` (shadow test), `three-lazy.test.ts` |
| Docs | `docs/3d-renderer.md` (+141 net), `docs/ai-showcase/14-3d-phase-7/prompt.md` |

Design points recorded in the docs: shadows on the `high` tier only (`PCFShadowMap`, 2048 map, separate `ShadowMaterial` plane so the floor colour is unchanged); the watchdog warms up for 3 s, averages over 2 s, degrades after 3 s below 45 fps and treats a frame gap of 1 s or more as a pause; the watchdog samples only while the tab is visible and focused.

## Verification recorded in the docs

Facts from the Phase 7 section of `docs/3d-renderer.md`:

- `tsc --noEmit` clean, 296/296 unit tests in 26 files, `verify-dist: OK`.
- Chunks: entry 404,209 B raw / 123,872 B gzip (+761 B gzip over phase 6); `three3d` 22,535 / 8,203; `switchable` 1,644 / 831; `three.module` 570,492 / 140,692.
- Browser checks: see docs/3d-renderer.md Phase 7 checks. (At the time of the commit that section listed them as pending; they were being run afterwards, so read the docs for the current state.)

## Review

After implementation, a separate review agent (a new session) reviewed the change, and its findings were fixed before commit `fb4c1d9`. The review report itself is not stored in the repository.
