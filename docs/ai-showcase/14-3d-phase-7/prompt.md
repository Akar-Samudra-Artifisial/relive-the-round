# Junie task 14 — 3D renderer, phase 7 (quality tiers, shadows, FPS watchdog, 2D fallback)

IDE: WebStorm + Junie. Branch: `feat/3d-renderer` (phase 6 committed as `74721b5`).

MEDIUM-HIGH RISK phase: the 3D renderer gets quality tiers (pixel ratio, antialias, shadows), an
FPS watchdog that steps quality down, and a runtime switch to the 2D renderer when WebGL fails
(context lost, loadMap/draw error, or the watchdog gives up). Everything stays behind `?3d=1`; the
default 2D path must not change. Cut order if this runs late: shadows first.

## Prompt (paste into Junie)

```
Goal: phase 7 of the optional 3D renderer. Add quality tiers (high / medium / low) with shadows on
high, an FPS watchdog that steps the tier down, and a runtime fallback that swaps the 3D renderer
for the Pixi 2D renderer when WebGL fails, without losing the round or the replay.
The default 2D game must not change.
Read .junie/guidelines.md and docs/3d-renderer.md (phase 0-6 notes) first.

Context (current code, verify line numbers yourself):
- web/src/game/gamePage.ts: create3dOr2d :145-153 (dynamic import, one console.warn :150, only
  the constructor is guarded); pickRenderer :161; ensureFonts :173; `const renderer` + appendChild
  :177-179; Controls binds listeners to renderer.canvas once :194; show() sets canvas visibility
  :241; showLiveMap :370-371; closeReplay :375-383; toReplay :476-511 (resize, loadMap, setPanels);
  fps counter :774-839 (fpsAcc, fpsEl :836; `?fps` or `auto` :158); frame loop :832-847, draw
  :845 (redraws lastLive, comment :843); loop.start() :873; __rtr dev probe :851
  (import.meta.env.DEV only).
- web/src/render/three3d/three3d.ts: WebGLRenderer({antialias: true, powerPreference:
  "high-performance"}) :36-37; setPixelRatio(renderResolution(dpr)) once in the constructor;
  destroy() calls forceContextLoss :153; no webglcontextlost handling; panelHud rebuilt at :193 and
  its textures depend on pixelRatio (panelHud.ts:32-36, :84).
- web/src/render/three3d/lights.ts:12 DirectionalLight, no castShadow. mapScene.ts: floor
  MeshBasic :141, walls MeshLambert :175. actorScene.ts bodies MeshLambert :119, :124, :161.
  Nothing in web/src sets castShadow / receiveShadow / shadowMap.
- web/src/render/pixi2d.ts:141-156 createPixi2dRenderer is async (antialias, renderResolution).
- web/src/game/input.ts:44-49 MAX_RESOLUTION = 2, renderResolution. frameLoop.ts:2 MAX_FRAME_MS
  100, createFrameLoop(onFrame(deltaMS, nowMs)) :35.
- web/src/render/select.ts pickRenderer :10-18, detectCaps :20-30.
- Guards: web/tests/three-lazy.test.ts:40-52 (three only under render/three3d/, gamePage only
  import()); web/tests/frameView.test.ts:202 purity regex, :208-232 pure-module list, :238-239
  pixi allowlist.

Implement exactly this:
1. web/src/render/quality.ts (pure, no pixi/three/DOM; add to the purity guard):
   - type QualityTier = "high" | "medium" | "low"; QUALITY table:
     high {maxPixelRatio 2, antialias true, shadows true}, medium {1.5, true, false},
     low {1, false, false}.
   - parseQuality(search): tier | null from `?quality=high|medium|low` (anything else null).
   - initialTier(search): parseQuality ?? "high".
   - lowerTier(t): high -> medium -> low -> null.
   - pixelRatioFor(tier, dpr) = min(renderResolution-equivalent of dpr, maxPixelRatio) (keep the
     same rounding rule as input.ts; import it if that keeps the module pure).
2. web/src/render/fpsWatchdog.ts (pure; add to the purity guard): createFpsWatchdog(opts?) with
   sample(deltaMS, nowMs): "ok" | "degrade" and reset(nowMs). Defaults: ignore the first 3000 ms
   after start/reset (warm-up); keep a 2000 ms rolling average; return "degrade" once when the
   average stays below 45 fps for 3000 ms, then reset itself; ignore clamped frames
   (deltaMS >= MAX_FRAME_MS, e.g. tab switch) so a hidden tab never degrades. Deterministic.
3. Three3dRenderer:
   - constructor(tier): antialias from the tier (only applied at creation); pixel ratio from
     pixelRatioFor.
   - setQuality(tier): setPixelRatio + setSize(cssW, cssH) + rebuild the panel HUD; toggle
     shadows (renderer.shadowMap.enabled, light.castShadow) and mark the affected materials
     needsUpdate once (not per frame). antialias does not change at runtime (document this).
   - Shadows (high only): PCFSoft shadow map 2048; the directional light's orthographic shadow
     camera fitted to the map bounds in loadMap; walls and actor bodies castShadow; floor colour
     must stay exactly the same, so receive shadows on a separate ShadowMaterial plane just above
     the floor (opacity ~0.35, below the grid/zone lines, no depthWrite); tune bias so there is no
     acne. Decals, tracers and HUD never cast.
   - Context loss: listen for "webglcontextlost" on the canvas (no preventDefault, we never
     restore) and call an onFail(reason) callback once. Remove the listener before
     destroy() calls forceContextLoss so destroy never reports a failure.
   - Add the optional `setQuality?(tier)` and `onFail?` hook to GameRenderer in renderer.ts
     (types only, keep it pure). Pixi2dRenderer does not need them.
4. web/src/render/switchable.ts (no pixi/three import; may touch the DOM):
   createSwitchableRenderer(primary, makeFallback: () => Promise<GameRenderer>, onSwap) returns a
   GameRenderer that forwards every call to the current renderer and remembers the last
   resize(cssW, cssH), loadMap(map, opts) and setPanels(specs). swapToFallback(reason): once only;
   create the fallback, replace the old canvas in the DOM (oldCanvas.replaceWith(newCanvas)), copy
   style.visibility, replay resize -> loadMap -> setPanels, destroy the old renderer, log ONE
   console.warn("[3d] falling back to 2D: <reason>"), then call onSwap(newRenderer). Calls that
   arrive while the swap is pending are recorded and replayed (draw is skipped until ready). If
   primary.loadMap or primary.draw throws, swap with that reason instead of throwing (loadMap is
   retried on the fallback). primary.onFail triggers the swap.
5. gamePage.ts (only these changes):
   - Build the renderer through createSwitchableRenderer when 3D is chosen (2D path unchanged:
     no wrapper, or a wrapper that is a pure pass-through).
   - onSwap: rebind the Controls pointer listeners to the new canvas (move the binding into a
     function), keep show()/visibility working, redraw lastLive. The round, timer, session, replay
     player and panels continue untouched.
   - Quality: initialTier(location.search); feed every frame's deltaMS to the watchdog only while
     the 3D renderer is active; on "degrade" call setQuality(lowerTier(tier)) and console.info
     "[3d] quality <old> -> <new>"; when lowerTier returns null, swapToFallback("low fps").
   - Dev only (inside the existing import.meta.env.DEV __rtr block): __rtr.loseContext() that
     triggers WEBGL_lose_context on the 3D canvas, and __rtr.quality() returning the current tier
     and renderer kind. verify-dist must still pass (no debug code in the public build).
6. Tests (no WebGL needed):
   - quality.test.ts: table values, parseQuality, initialTier, lowerTier chain, pixelRatioFor for
     dpr 1, 1.5, 2, 3.
   - fpsWatchdog.test.ts: warm-up ignored; steady 60 fps never degrades; steady 30 fps degrades
     exactly once after 3000 ms below threshold, then resets; clamped 100 ms frames ignored; a
     short dip (< 3000 ms) does not degrade.
   - switchable.test.ts with fake renderers and a fake canvas/parent: forwards calls; swap replays
     resize/loadMap/setPanels in that order; old renderer destroyed; canvas replaced and visibility
     copied; one warn; second swap is a no-op; primary.loadMap throwing swaps and loads on the
     fallback; primary.draw throwing swaps; onFail triggers swap; onSwap receives the new
     renderer.
   - Guards: quality.ts and fpsWatchdog.ts in the purity list; three still only under
     render/three3d/; switchable.ts imports neither pixi nor three.
7. docs/3d-renderer.md: replace the "Shadows and quality tiers remain Phase 7 work" line and
   append "Phase 7 — quality, watchdog, fallback" (tier table, watchdog numbers, shadow setup,
   swap flow and what is preserved, dev hooks, chunk sizes, check results).

Constraints:
- Do NOT modify web/src/sim/, web/src/game/session.ts, frameView.ts, replayPlayer.ts,
  replayModel.ts, scoring, kiosk logic, touch controls logic, level code or the phase 0 probe.
  gamePage.ts only as listed in step 5. No new dependencies. English only.
- Entry chunk gzip may grow by at most ~1 kB; three code stays in lazy chunks; only files under
  web/src/render/three3d/ import three.
- No per-frame allocation; setQuality and shadow toggles never run per frame.
- No CSP changes, no CHANGELOG entry yet (phase 8). 2D stays the default.

Done when:
- cd web && npx tsc --noEmit, pnpm test (old + new), pnpm build:public ("verify-dist: OK") pass;
  report entry and three3d chunk sizes (gzip).
- Parity: /?auto&seed=42 (2D) and /?3d=1&auto&seed=42 (3D) both give the same score card (500
  points, 3.7 s / 6.0 s, 2/3 kills).
- 3D (headless Chrome 1280x800, pnpm dev): ?quality=high shows wall/actor shadows and the floor
  colour is unchanged elsewhere; ?quality=medium and ?quality=low show no shadows; screenshots of
  high vs low; report ?fps for each tier in the round and in the replay.
- Watchdog: with CPU throttling (e.g. 6x) on ?3d=1&quality=high the console shows the tier steps
  and, if fps stays low, the 2D fallback; without throttling no step happens in a full round.
- Fallback: call __rtr.loseContext() mid-round -> one "[3d] falling back to 2D" warn, the round
  keeps running in 2D with mouse aim working, the score card appears normally; repeat on the
  replay screen -> the replay continues in 2D with YOU / PRO panels and working controls. No
  uncaught errors.
- Show me the plan first, then implement. Do not commit.
```

## Evidence to save in this folder

- `session.md` — summary of the Junie session (from `~/.junie/sessions`, strip local paths)
- `plan.png`, `run-*.png` — plan and test/build runs
- `quality-high.png`, `quality-low.png` — shadows vs no shadows
- `fallback-round.png`, `fallback-replay.png` — after `__rtr.loseContext()`
- `corrections.md` — anything you had to correct or re-prompt
