# Junie task 09 — 3D renderer, phase 2 (Pixi behind GameRenderer, own frame loop, ReplayPlayer)

IDE: WebStorm + Junie. Branch: `feat/3d-renderer` (phase 1 committed as `27fc9b4`).

HIGH RISK phase: it rewires the game loop. It lands as its own commit and is checked with the same
`/?auto&seed=42` parity run as phase 1 before anything else is built on top.

## Prompt (paste into Junie)

```
Goal: phase 2 of the optional 3D renderer. Move all Pixi code behind the GameRenderer interface,
drive game + replay from our own requestAnimationFrame loop instead of the Pixi ticker, and turn
ReplayView into a renderer-agnostic ReplayPlayer. Behaviour and drawing must not change.
Read .junie/guidelines.md and docs/3d-renderer.md (phase 0 + 1 notes) first.

Context (current code, verify line numbers yourself):
- web/src/render/renderer.ts:45-75 FrameView, PanelSpec, GameRenderer {kind, canvas,
  resize(cssW, cssH), loadMap(map, {cssPxPerUnit?}), setPanels(panels), draw(frames),
  screenToWorld(clientX, clientY), destroy()}. Types only; web/tests/frameView.test.ts:193-199
  guards it (no pixi/three/DOM) — keep it that way.
- web/src/game/gamePage.ts:
  - Pixi Application created at ~161, app.init ~163-170 (resolution: renderResolution(dpr) capped
    at 2 from input.ts:44-49, autoDensity, antialias, background THEME_NUM.bg). Resized only in
    closeReplay ~364 and toReplay ~470. Map drawn with drawMap ~340-344 (root.scale = scale).
  - app.ticker.add ~764-820: fps meter, session.advance(ticker.deltaMS) ~805 (session.ts: fixed
    DT 1/30 accumulator, MAX_STEPS_PER_ADVANCE 5), autopilot per tick, input read per frame,
    drawDynamic ~848-852 (liveFrame -> drawFrame), updateHud ~854-874.
  - Pixi renders AFTER our callback (TickerPlugin render at UPDATE_PRIORITY.LOW). The Pixi Ticker
    clamps deltaMS to 100 ms (maxElapsedMS).
  - Controls ~79-132 convert pointer px with clientToCanvas (input.ts:56-64) and mapInput divides by
    scale (input.ts:29-41). show() ~225-238 toggles app.canvas.style.visibility.
  - Tracers, pulses and deadlines use performance.now() (~390, 443, 495, 776, 789, 798, 811-813).
  - Dev-only __rtr probe ~822-837 and ?auto autopilot (~142, 336, 437, 446) depend on the loop.
- web/src/game/replayView.ts: class ReplayView (Pixi Container + Graphics, hudHeader text panels
  YOU/PRO with notes, attach(ticker), time/isPlaying, setTime, play, pause, setSpeed, destroy;
  update does next = t + deltaMS/1000*speed and calls onEnd at the end). gamePage guards destroy
  during update with replayEnded (~483-484); keep that pattern.
- web/src/render/mapView.ts drawMap(map, opts): Container; web/src/render/actors.ts drawFrame(g, f).

Implement exactly this:
1. web/src/game/frameLoop.ts:
   - pure helper frameDelta(prevMs: number | null, nowMs: number, maxMs = 100): number
     (first frame -> 0, negative -> 0, clamp to maxMs, same semantics as the Pixi ticker clamp);
   - createFrameLoop(onFrame: (deltaMS: number, nowMs: number) => void,
     deps = { raf: requestAnimationFrame, caf: cancelAnimationFrame, now: () => performance.now() })
     -> { start(), stop(), readonly running }. Deps are injectable so it is testable without a DOM.
2. web/src/render/pixi2d.ts: class Pixi2dRenderer implements GameRenderer (kind "2d"), created with
   an async factory (Pixi app.init is async), same init options as today. It owns the Application,
   the map container (via mapView.drawMap), one Graphics per panel for dynamic drawing (via
   actors.drawFrame), and the replay panel headers (moved from replayView hudHeader, same text,
   positions, overflow hiding). draw(frames) draws frames[i] into panel i, then calls app.render().
   The Pixi ticker must NOT drive rendering any more: init with autoStart: false and keep the
   ticker stopped (do not render twice per frame). screenToWorld uses clientToCanvas + the current
   scale/panel so Controls no longer touch Pixi. destroy() destroys the app and frees the context.
3. web/src/game/replayPlayer.ts: class ReplayPlayer with NO Pixi/DOM: holds world + timeline,
   time, speed, playing; update(deltaMS) advances exactly like ReplayView did and fires
   onTime/onEnd the same way; frames(): FrameView[] returns [youFrame(...), proFrame(...)] for the
   current time; panels(width, height, layout?) returns the PanelSpec[] ReplayView used. Delete
   ReplayView (or keep a thin wrapper only if strictly needed — prefer delete).
4. gamePage.ts: create the renderer through the factory, replace app.ticker.add and
   view.attach(app.ticker) with ONE frame loop whose callback runs, in this order: fps meter,
   session.advance(deltaMS) / autopilot / input exactly as today, replay player update, build
   frames (liveFrame or replayPlayer.frames()), renderer.draw(frames), updateHud. Resizes go through
   renderer.resize + setPanels. After this phase gamePage.ts must not import "pixi.js" at all.
   Keep performance.now() as the clock for tracers/pulses/deadlines (pass nowMs from the loop where
   it was performance.now() inside the tick; elsewhere leave it as is). Keep `import
   "pixi.js/unsafe-eval"` in main.ts (CSP).
5. Tests:
   - web/tests/frameLoop.test.ts: frameDelta (first frame, normal, clamp at 100, clock going
     backwards); createFrameLoop with fake raf/now (start/stop, deltas passed, no callbacks after
     stop, start twice does not double-schedule).
   - web/tests/replayPlayer.test.ts on the synthetic fixture level: time advances by
     deltaMS/1000*speed, pause stops time, setTime clamps, onEnd fires once at the end, frames()
     at 0 / middle / end equals youFrame/proFrame called directly.
   - extend the purity guard: frameLoop.ts (except the default deps) and replayPlayer.ts must not
     use pixi/three/document; add a source check that only web/src/render/pixi2d.ts,
     mapView.ts and actors.ts (and main.ts for unsafe-eval) import "pixi.js".
6. docs/3d-renderer.md: append "Phase 2 — renderer seam" (files, loop order, why autoStart is off)
   and a parity table like phase 1.

Constraints:
- Do NOT modify web/src/sim/, web/src/game/session.ts, scoring, kiosk logic, touch controls logic,
  level code or the phase 0 probe (web/src/render/three3d/). No new dependencies. English only.
- Same visuals: colors, sizes, HiDPI resolution cap, replay headers, fog, tracers.
- No CHANGELOG entry (no user-visible change).

Done when:
- cd web && npx tsc --noEmit, pnpm test (all old tests + new ones), pnpm build:public
  ("verify-dist: OK") pass.
- Parity, same method as phase 1 (headless Chrome 1280x800, pnpm dev): /?auto&seed=42 final score
  card identical to the phase 1 commit (500 points, 3.7 s / 6.0 s, 2/3 kills); replay screenshots
  at 0/50/80/100 % pixel-identical; live screenshots differ at most by normal frame-timing noise.
  Record the table in docs/3d-renderer.md.
- Manual: a full round with keyboard+mouse, a replay with play/pause/scrub/speed, ?kiosk=1 attract
  loop and ?touch=1 still work; no CSP errors in pnpm preview.
- Show me the plan first, then implement. Do not commit.
```

## Evidence to save in this folder

- `session.md` — summary of the Junie session (from `~/.junie/sessions`, strip local paths)
- `plan.png`, `run-*.png` — plan and test/build runs
- `corrections.md` — anything you had to correct or re-prompt
- `parity.png` — score card on phase 1 vs phase 2
