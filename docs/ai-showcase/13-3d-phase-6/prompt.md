# Junie task 13 — 3D renderer, phase 6 (3D replay: YOU / PRO viewports in one canvas)

IDE: WebStorm + Junie. Branch: `feat/3d-renderer` (phase 5 committed as `47c5923`).

MEDIUM RISK phase: the replay screen gets two 3D views side by side (or stacked) rendered into ONE
WebGL canvas with scissor viewports. Everything stays behind `?3d=1`; the default 2D path must not
change. No shadows or quality tiers yet (phase 7).

## Prompt (paste into Junie)

```
Goal: phase 6 of the optional 3D renderer. Make Three3dRenderer honour every PanelSpec: one scissor
viewport per panel inside the single WebGL canvas, each with its own camera fit and its own actor
layer, plus the YOU / PRO header plates, so the replay screen works in 3D exactly like in 2D.
The default 2D game must not change.
Read .junie/guidelines.md and docs/3d-renderer.md (phase 0-5 notes) first.

Context (current code, verify line numbers yourself):
- web/src/render/renderer.ts:57-64 PanelSpec {x, y, size, title?, note?, accent?} in CSS px.
- web/src/render/pixi2d.ts is the 2D reference: HEADER_H = 32 :12; hudHeader :15-24 (surface
  plate, 10 px bevel, 4 px accent bar); fieldOrigin :27-29 (field starts 32 px lower when the panel
  has a title); rebuild :94-143 (per panel view at (x, y), field scaled size / max(w, h); title
  DISPLAY_FONT 18 px letterSpacing 3 at (16, 5); note MONO_FONT 11 px textDim uppercase, hidden when
  it would overflow size - 8); draw :65-73; screenToWorld :75-87 (first panel whose field contains
  the point wins, null otherwise).
- web/src/game/replayPlayer.ts: frames() :90-95 returns [youFrame, proFrame]; panels() :101-118
  (row or column layout, gap 16, size = min(panelW, panelH - 40), titles YOU / PRO, note, accent
  cyan / amber). web/src/game/replayModel.ts:9-29 PANEL_GAP, PANEL_CHROME, replayLayout.
- web/src/game/gamePage.ts: toReplay :476-509 (resize to the replay layout, loadMap, setPanels(
  view.panels(...))); closeReplay :375-383 (resize(size, size)) and showLiveMap :369-372 (single
  live panel); draw(frames) :845 with replay.frames() or [lastLive].
- web/src/render/three3d/three3d.ts: constructor :31-41 (setPixelRatio, setClearColor, setSize;
  autoClear untouched); resize :48-53; loadMap :55-61; setPanels :63-65 only stores; draw :67-70
  renders frames[0] over the whole canvas; screenToWorld :72-79 uses one fit for the whole canvas;
  updateCamera :97-110 fitCamera(map bounds, cssW / cssH).
- web/src/render/three3d/actorScene.ts: ActorLayer() :77 owns its geometries/materials (:79-124);
  setProgress :321-330 and setPulseRadius :333 mutate buffers, so layers must NOT share geometry.
  Lights currently live in the map group (mapScene.ts ~191).
- camMath.ts fitCamera(bounds, aspect, opts?) :80-84; ndcFromClient(clientX, clientY, rect) :141.
- labels.ts makeCanvasLabel :13 builds world-space text planes (depthTest false).

Implement exactly this:
1. web/src/render/panelLayout.ts (pure, no pixi/three/DOM):
   - export const HEADER_H = 32 and fieldRect(spec): {x, y, w, h} in CSS px (y + HEADER_H when the
     panel has a title, w = h = spec.size) — the same rule as pixi2d fieldOrigin.
   - export function glViewport(rect, cssH): {x, y, w, h} with y measured from the canvas bottom.
   - export function panelAt(specs, px, py): index of the first panel whose field contains the
     CSS point, or -1.
   pixi2d.ts imports HEADER_H and its field origin from here; its output must stay identical.
2. three3d.ts:
   - Keep one shared map group. Keep one ActorLayer per panel (create on setPanels when the count
     grows, dispose extras when it shrinks; keep at least one).
   - draw(frames): renderer.autoClear = false; clear the whole canvas once; for each panel i:
     show only layer i (update it with frames[i] ?? null), set the camera from that panel's fit
     (fitCamera(map bounds, 1) for a square field — cache fits per panel, recompute on resize /
     loadMap / setPanels), setViewport + setScissor(glViewport(fieldRect(spec), cssH)) with
     setScissorTest(true), render. Then render the header overlay (step 3) over the full canvas
     and turn the scissor test off. A single live panel without title must look exactly like
     phase 5 (same camera, whole canvas).
   - screenToWorld: CSS point from canvas.getBoundingClientRect(); i = panelAt(...); -1 -> null;
     else ndcFromClient against that panel's field rect and groundPoint with that panel's fit;
     null outside the map.
   - Move the lights out of the map group into the renderer scene so actors are lit before
     loadMap (phase 5 reviewer note); mapScene tests must still pass (update them if they count
     lights).
3. web/src/render/three3d/panelHud.ts (imports three, no WebGLRenderer): an orthographic overlay
   scene in CSS px that draws, for every titled panel, the header plate (surface colour, bevel,
   4 px accent bar) and the title/note text via a CanvasTexture (fonts already loaded by
   ensureFonts; same fonts/sizes/colours as pixi2d; hide the note when it would overflow, same
   rule). Rebuild only on setPanels/resize, never per frame; dispose everything on rebuild and
   destroy. Panels without title draw nothing.
4. actorScene.ts (phase 5 reviewer NITs): hoist the per-update closures (~:173-175) to bound
   methods; a defuse progress > 0 always shows at least one ring segment (2D draws a sliver).
5. Tests (no WebGL needed):
   - web/tests/panelLayout.test.ts: fieldRect with/without title; glViewport flips y (cssH 600,
     rect y 40 h 200 -> y 360); panelAt for the real replayPlayer row and column layouts (points in
     each field, in the gap, in a header, outside -> -1).
   - pixi2d parity guard: HEADER_H used by pixi2d is the one from panelLayout (source check is
     fine, pixi needs WebGL).
   - panelHud: building for [YOU, PRO] specs creates two plates and two title textures; a panel
     without title creates nothing; rebuild disposes the previous geometries/materials/textures
     (spy); no allocation when draw-time code runs (if any).
   - actorScene: two layers updated with different frames keep independent positions; progress
     0.001 shows >= 1 segment.
6. docs/3d-renderer.md: replace the phase 5 "Still missing" line and append "Phase 6 — replay
   viewports" (scissor flow, y flip, per-panel fits, HUD overlay, lights move) plus parity notes.

Constraints:
- Do NOT modify web/src/sim/, web/src/game/session.ts, frameView.ts, replayPlayer.ts,
  replayModel.ts, scoring, kiosk logic, touch controls logic, level code, the phase 0 probe or
  gamePage.ts. If gamePage really needs a change, stop and explain in the plan. No new dependencies.
  English only.
- Entry chunk gzip must not grow by more than ~0.5 kB; three code stays in lazy chunks; only files
  under web/src/render/three3d/ import three.
- No per-frame allocation of geometries, materials, textures or cameras.
- No CSP changes, no CHANGELOG entry yet (phase 8).

Done when:
- cd web && npx tsc --noEmit, pnpm test (old + new), pnpm build:public ("verify-dist: OK") pass;
  report entry and three3d chunk sizes.
- Parity 2D: /?auto&seed=42 score card unchanged (500 points, 3.7 s / 6.0 s, 2/3 kills) and the
  2D replay screen looks the same as before (screenshot).
- 3D (headless Chrome 1280x800 and 800x1200 for the stacked layout, pnpm dev):
  /?3d=1&auto&seed=42 finishes with the same score card; the replay shows YOU and PRO side by side
  (stacked at 800x1200) with headers, both fields animate, play / pause / scrub / speed work,
  closing the replay returns to the single live view; no console errors; screenshots of both
  layouts; report ?fps during the 3D replay.
- Manual: in the 3D replay, hovering each field maps to the ground under the cursor (screenToWorld
  returns null over headers and gaps).
- Show me the plan first, then implement. Do not commit.
```

## Evidence to save in this folder

- `session.md` — summary of the Junie session (from `~/.junie/sessions`, strip local paths)
- `plan.png`, `run-*.png` — plan and test/build runs
- `replay-3d-row.png`, `replay-3d-column.png` — 3D replay in both layouts
- `corrections.md` — anything you had to correct or re-prompt
