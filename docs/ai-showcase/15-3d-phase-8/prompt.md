# Junie task 15 — 3D renderer, phase 8 (3D becomes the default)

IDE: WebStorm + Junie. Branch: `feat/3d-renderer` (phase 7 committed as `fb4c1d9`).

LOW-MEDIUM RISK phase: flip the default. Browsers with WebGL2 get the 3D renderer without any URL
param; `?2d=1` (or `?3d=0`) forces the Pixi 2D renderer; browsers without WebGL2 keep 2D silently.
All the safety nets from phase 7 (lazy chunk, import/init fallback, runtime swap, FPS watchdog)
stay as they are. This is the last phase: docs and CHANGELOG get their final entry.

## Prompt (paste into Junie)

```
Goal: phase 8 (last) of the 3D renderer. Make 3D the default renderer when WebGL2 is available,
keep `?2d=1` as the way to force 2D, and document the finished feature.
Read .junie/guidelines.md and docs/3d-renderer.md (phase 0-7 notes) first.

Context (current code, verify line numbers yourself):
- web/src/render/select.ts: pickRenderer :10-18 (rules today: `2d=1` -> 2d "forced"; `3d=1` or
  bare `3d` -> 3d "requested" if webgl2 else 2d "no webgl2"; anything else, incl. `3d=0`, -> 2d
  "default"); file comment :4 says "The default stays 2D until the 3D renderer is complete";
  detectCaps :20-30.
- web/tests/select.test.ts: table test with webgl2 true/false.
- web/src/game/gamePage.ts: create3dOr2d :156-175 (lazy import of three3d + switchable, one
  console.warn on failure, 2D fallback); pickRenderer call :183; initialTier :199; renderer
  creation :202-205; watchdog only when switchable :206; quality step log :875.
- web/src/render/quality.ts: initialTier(search) = parseQuality ?? "high".
- web/src/main.ts:22 phase 0 probe on `?3d` — leave it exactly as is.
- Guards: web/tests/three-lazy.test.ts (three only under render/three3d/, entry chunk never
  imports three, gamePage only via import()); web/tests/frameView.test.ts purity list.
- Docs mentioning "opt-in" / "?3d=1" / "default stays 2D": docs/3d-renderer.md (phase 3 :218,
  phase 6 :414, :437, phase 7 :463-465 and the phase 7 check list), AI_SHOWCASE.md:107-110.

Implement exactly this:
1. select.ts pickRenderer, rules in order:
   - `2d=1` -> 2d ("forced"); `3d=0` -> 2d ("forced").
   - webgl2 available -> 3d ("default"); `3d=1` / bare `3d` keep working and also give 3d
     (reason "requested").
   - no webgl2 -> 2d ("no webgl2").
   Update the file comment. detectCaps unchanged.
2. select.test.ts: update the table (""/"?kiosk=1" -> 3d default with webgl2, 2d "no webgl2"
   without; "?3d=0" and "?2d=1" and "?3d=1&2d=1" -> forced 2d in both; "?3d" / "?3d=1" -> 3d
   requested / 2d no webgl2; "?2d=0" behaves like no param).
3. Starting tier: coarse pointers (phones/tablets) start at "medium" instead of "high" unless
   `?quality=` is given. Do it purely: initialTier(search, opts?: { coarse?: boolean }) in
   quality.ts (parseQuality ?? (coarse ? "medium" : "high")); gamePage passes
   matchMedia("(pointer: coarse)").matches. Add cases to quality.test.ts. The watchdog still steps
   down from there.
4. gamePage.ts: no other behaviour change. The 3D path is still lazy; 2D (forced or no webgl2) is
   the same code path as today with no wrapper and no watchdog.
5. Guards: three-lazy.test.ts must still pass unchanged in spirit (entry chunk has no three; three
   only under render/three3d/). If a guard asserts "2D is the default" adjust only that assertion.
6. Docs:
   - docs/3d-renderer.md: append "Phase 8 — 3D by default" (selection rules table, coarse-pointer
     tier, what a default visitor now downloads: entry gzip + lazy three3d/switchable chunks with
     sizes from the build, how to force 2D, check results) and mark the earlier "default stays 2D"
     lines as superseded (do not rewrite history, add "(until phase 8)").
   - AI_SHOWCASE.md: one sentence that phases 0-8 shipped and 3D is now the default.
   - CHANGELOG.md [Unreleased] (English, Keep a Changelog style like the existing lines):
     Added: one line for the 3D renderer (tilted three.js view, actors/tracers/spike, two-panel
     replay, quality tiers with shadows, FPS watchdog, automatic 2D fallback). Changed: one line
     that 3D is the default with WebGL2 and `?2d=1` forces 2D. Update the phase 0 probe line only
     if it is now misleading.

Constraints:
- Do NOT modify web/src/sim/, web/src/game/session.ts, frameView.ts, replayPlayer.ts,
  replayModel.ts, scoring, kiosk logic, touch controls logic, level code, the phase 0 probe,
  three3d/ rendering code or switchable.ts. No new dependencies. English only.
- Entry chunk gzip must not grow by more than ~200 B; three stays in lazy chunks.
- No CSP changes. No local filesystem paths in any tracked file.

Done when:
- cd web && npx tsc --noEmit, pnpm test (old + new), pnpm build:public ("verify-dist: OK (6
  level(s)...)") pass; report entry, three3d and switchable chunk sizes (gzip).
- Parity: /?auto&seed=42 (now 3D) and /?2d=1&auto&seed=42 (2D) give the same score card (500
  points, 3.7 s / 6.0 s, 2/3 kills).
- Browser (headless Chrome 1280x800, pnpm dev): / renders the 3D canvas without any param
  (canvas data-engine "three.js r187"), the three3d chunk is requested; /?2d=1 and /?3d=0 render
  Pixi 2D and request no three chunk; with WebGL2 disabled / plays 2D with no warning. A phone
  emulation (coarse pointer) starts at "medium" (__rtr.quality()). No console errors.
- Show me the plan first, then implement. Do not commit.
```

## Evidence to save in this folder

- `session.md` — summary of the session (strip local paths)
- `default-3d.png`, `forced-2d.png` — `/` vs `/?2d=1`
- `corrections.md` — anything you had to correct or re-prompt
