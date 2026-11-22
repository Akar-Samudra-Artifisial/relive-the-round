# Junie task 11 — 3D renderer, phase 4 (static 3D map behind ?3d=1)

IDE: WebStorm + Junie. Branch: `feat/3d-renderer` (phase 3 committed as `804000d`).

MEDIUM RISK phase: first real three.js pixels. Everything stays behind `?3d=1`; the default 2D path
must be byte-for-byte the same game. Actors, tracers and the spike come in phase 5, replay panels in
phase 6, so with `?3d=1` this phase shows the map only (the round still runs underneath).

## Prompt (paste into Junie)

```
Goal: phase 4 of the optional 3D renderer. Add a three.js GameRenderer that draws the static map
(floor, grid, spawn zones, sites, extruded walls, labels) with the phase 3 camera, loaded lazily
only when pickRenderer picks "3d". The default 2D game must not change.
Read .junie/guidelines.md and docs/3d-renderer.md (phase 0-3 notes) first.

Context (current code, verify line numbers yourself):
- web/src/render/renderer.ts:45-75 FrameView, PanelSpec, GameRenderer {kind, canvas,
  resize(cssW, cssH), loadMap(map, {cssPxPerUnit?}), setPanels, draw(frames),
  screenToWorld(clientX, clientY): Vec2 | null, destroy()}.
- web/src/render/pixi2d.ts: the 2D reference. createPixi2dRenderer ~147-162 (resolution =
  renderResolution(devicePixelRatio) capped at 2, antialias, background THEME_NUM.bg);
  draw ~65-73 rebuilds on dirty then renders once; screenToWorld ~75-87 returns null outside the
  panel field.
- web/src/render/mapView.ts:7-13 palette (FLOOR 0x070b10, GRID_MINOR 400 / GRID_MAJOR 2000,
  WALL_FILL 0x111b25, ATTACK_TINT THEME_NUM.red, DEFENSE_TINT THEME_NUM.green) and drawMap
  ~72-129: floor rect, minor/major grid, spawn zones (tint 0.07 + dashed outline), sites (amber
  0.08 fill, dashed outline, corner brackets), walls (cyan halo, WALL_FILL + cyan edge), site
  letters (DISPLAY_FONT 380, amber, alpha 0.55) and spawn labels (MONO_FONT, spawnLabelSize).
- web/src/maps/types.ts:13-23 MapDef {width, height, walls: Polygon[], sites, spawns}. Polygons are
  flat [x0, y0, x1, y1, ...] in cm, y grows down.
- web/src/render/three3d/camMath.ts: toGround/fromGround (world (x, y) -> (X = x, Y = 0, Z = y)),
  CAMERA_FOV_DEG 30, CAMERA_PITCH_DEG 58, fitCamera(bounds, aspect), project, groundPoint,
  ndcFromClient.
- web/src/render/select.ts pickRenderer/detectCaps. web/src/game/gamePage.ts ~150-152 computes
  rendererPick and only logs; ~168 always awaits createPixi2dRenderer({width: size, height: size});
  ~360-361 loadMap + setPanels for the live round; ~475-491 resize/loadMap/setPanels for replay.
- web/src/main.ts:24-29 phase 0 probe on `?3d` — leave it exactly as is.
- web/tests/three-lazy.test.ts guards that three never lands in the entry chunk.

Implement exactly this:
1. web/src/render/palette.ts (pure, no pixi/three): move the map palette constants out of
   mapView.ts (FLOOR, GRID_MINOR, GRID_MAJOR, WALL_FILL, ATTACK_TINT, DEFENSE_TINT) and export them;
   mapView.ts imports them from there. 2D output must stay identical.
2. web/src/render/three3d/mapScene.ts — imports three, NO WebGLRenderer, NO DOM except an injected
   label factory:
   - export const WALL_HEIGHT = 240 (cm; tune later, keep it one constant).
   - buildMapScene(map: MapDef, opts?: {makeLabel?: (text, style) => THREE.Object3D | null}):
     THREE.Group named "map" containing:
     floor plane exactly map.width x map.height at Y = 0 (FLOOR colour);
     grid as two THREE.LineSegments (minor + major, same spacing/colours/alpha as 2D) at Y = 1;
     spawn zones and sites as flat ShapeGeometry meshes (same tint + alpha, transparent,
     depthWrite false) at Y = 2, outlines as LineSegments (dashed like 2D is fine via
     LineDashedMaterial or pre-split segments — pick one, explain);
     walls: one ExtrudeGeometry per polygon, extruded to WALL_HEIGHT, WALL_FILL material
     (MeshLambertMaterial or MeshStandardMaterial), plus cyan top/edge lines via EdgesGeometry;
     merge per material if it is simple, otherwise keep one mesh per wall.
     Mind the axis flip: Shape is built in XY and must end up on XZ with world y -> +Z (rotate -90°
     about X and check the sign with a test, do not guess).
   - lights: one HemisphereLight + one DirectionalLight, no shadows yet (phase 7).
   - labels: when makeLabel is given, add site letters and spawn labels as flat planes lying on the
     ground at the polygon centroid (polygonCentroid from sim/geom), same text/colours/alpha; when
     omitted (tests), skip labels. The browser factory draws text on a CanvasTexture using
     DISPLAY_FONT/MONO_FONT (fonts are already loaded by ensureFonts before the renderer starts).
   - disposeMapScene(group): disposes every geometry, material and texture under it.
3. web/src/render/three3d/three3d.ts — class Three3dRenderer implements GameRenderer (kind "3d"):
   - WebGLRenderer({antialias: true, powerPreference: "high-performance"}), setPixelRatio(
     renderResolution(devicePixelRatio)), clear colour THEME_NUM.bg, output colour space sRGB.
   - loadMap rebuilds the map group (dispose the old one); resize sets size + recomputes the
     camera with fitCamera({0, 0, map.width, map.height}, cssW / cssH) and applies position,
     target (lookAt), fov, near, far to a THREE.PerspectiveCamera.
   - setPanels: this phase renders ONLY panels[0] into the whole canvas (multi-panel replay is
     phase 6); store the specs anyway.
   - draw(frames): render the scene once. Ignore actors this phase (phase 5).
   - screenToWorld: ndcFromClient(clientX, clientY, canvas.getBoundingClientRect()) ->
     groundPoint(camera fit, ...) -> null if outside [0, width] x [0, height]. This is what makes
     mouse aim work in 3D; Controls must not change.
   - destroy: disposeMapScene, renderer.dispose(), renderer.forceContextLoss(), remove the canvas.
   - export async function createThree3dRenderer(opts: {width, height}): Promise<Three3dRenderer>.
4. gamePage.ts: if rendererPick.kind === "3d", `await import("../render/three3d/three3d")` and
   create the 3D renderer; on ANY error (import or WebGL init) console.warn once and fall back to
   createPixi2dRenderer. Remove the phase 3 "not implemented yet" log. Keep the 2D path code and
   timing unchanged. The static import of three must not appear anywhere outside
   web/src/render/three3d/.
5. Tests (three can be imported in vitest; no WebGL needed because mapScene has no renderer):
   - web/tests/mapScene.test.ts on the real Kiln map: the floor bounding box is exactly
     [0, width] x [0, height] on X/Z at Y = 0; wall count matches map.walls; wall bounding box top
     is WALL_HEIGHT and bottom 0; a wall vertex at world (x, y) appears at (x, *, y) — not
     (x, *, -y); every mesh/line has its material colour from palette.ts / THEME_NUM;
     disposeMapScene calls dispose on every geometry and material (spy).
   - extend web/tests/camMath.test.ts (reviewer notes from phase 3): non-square bounds
     (8000 x 3000 and 3000 x 8000) and extreme aspects (3, 1/3) still fit tight; independent
     analytic checks — the target projects to NDC (0, 0), and the camera-to-target direction makes
     exactly CAMERA_PITCH_DEG with the ground plane, computed in the test without camMath helpers.
   - extend web/tests/three-lazy.test.ts (or add a source check): only files under
     web/src/render/three3d/ import "three", and gamePage only reaches three3d.ts via import().
6. docs/3d-renderer.md: append "Phase 4 — static map" (scene layout, axis flip, wall height,
   fallback rule, what is still missing) and the parity note.

Constraints:
- Do NOT modify web/src/sim/, web/src/game/session.ts, scoring, kiosk logic, touch controls logic,
  level code or the phase 0 probe (web/src/render/three3d/probe.ts). No new dependencies (three
  0.187.0 is already installed; do not add three/examples addons unless strictly needed — say so
  in the plan if you want one). English only.
- Entry chunk gzip must not grow by more than ~1.5 kB; all three.js code stays in lazy chunks.
- The 3D renderer must not touch the CSP: no eval, no inline workers, no remote fonts/textures.
- No CHANGELOG entry yet (3D is still opt-in and incomplete; CHANGELOG comes in phase 8).

Done when:
- cd web && npx tsc --noEmit, pnpm test (all old tests + new ones), pnpm build:public
  ("verify-dist: OK") pass; report entry and three chunk sizes.
- Parity 2D: /?auto&seed=42 score card unchanged (500 points, 3.7 s / 6.0 s, 2/3 kills).
- 3D smoke (headless Chrome 1280x800, pnpm dev): /?3d=1&auto&seed=42 shows the tilted map
  (walls, sites, labels readable), no console errors, the round still finishes with the same score
  card as 2D (the sim does not depend on the renderer); screenshot it. /?3d=1 with WebGL2 disabled
  (or detectCaps stubbed false) falls back to 2D silently except the one warn.
- Manual: with /?3d=1 moving the mouse over the map aims toward the ground point under the cursor
  (check with ?fps or the dev __rtr probe that aimWorld follows the cursor).
- Show me the plan first, then implement. Do not commit.
```

## Evidence to save in this folder

- `session.md` — summary of the Junie session (from `~/.junie/sessions`, strip local paths)
- `plan.png`, `run-*.png` — plan and test/build runs
- `map-3d.png` — first 3D frame of the map
- `corrections.md` — anything you had to correct or re-prompt
