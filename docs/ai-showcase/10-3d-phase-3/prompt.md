# Junie task 10 — 3D renderer, phase 3 (camera math + renderer selection)

IDE: WebStorm + Junie. Branch: `feat/3d-renderer` (phase 2 committed as `9f4a99a`).

LOW RISK phase: pure math and a selection function, no three.js scene yet. It fixes the camera
model and the world → ground-plane convention that phases 4-6 build on, and gets them unit-tested
before any pixels depend on them.

## Prompt (paste into Junie)

```
Goal: phase 3 of the optional 3D renderer. Add the pure camera math (fit a perspective camera to
the map, project world points, and invert screen points back to the ground) and a pure renderer
selection function. No three.js scene yet, and the game must still render with the 2D renderer.
Read .junie/guidelines.md and docs/3d-renderer.md (phase 0-2 notes) first.

Context (current code, verify line numbers yourself):
- web/src/render/renderer.ts:74 GameRenderer.screenToWorld(clientX, clientY): Vec2 | null.
  Pixi implementation web/src/render/pixi2d.ts:75-87 (scale = panel size / max(width, height),
  HiDPI via clientToCanvas in web/src/game/input.ts:56).
- web/src/game/gamePage.ts:180 Controls already go through renderer.screenToWorld; ~133 calls
  mapInput(..., 1). Touch aim (web/src/game/touchControls.ts:85) uses stickAim and never touches
  the renderer — leave it alone.
- web/src/main.ts:24 `?3d` (URLSearchParams.has) lazily loads the phase 0 probe. Keep that probe
  untouched.
- Flag parsing pattern to copy: parseKiosk in web/src/game/kiosk.ts:24.
  prefersReducedMotion in web/src/ui/fonts.ts:26.
- World units are cm. Kiln and Cistern are 8000 x 8000 (web/src/maps/kiln.ts:12-13,
  cistern.ts:13-14). World y grows DOWN (kiln.ts:7).

Coordinate convention (write it at the top of camMath.ts and in the docs):
- 3D ground is the plane Y = 0. World (x, y) maps to 3D (X = x, Y = 0, Z = y). 1 unit = 1 cm.
- The camera sits on the +Z side of the map centre, raised and pitched down, looking toward -Z.
  So screen-up = smaller world y, screen-right = larger world x — the same orientation as 2D.

Implement exactly this:
1. web/src/render/three3d/camMath.ts — pure TypeScript, NO three import, NO DOM:
   - types Bounds {minX, minY, maxX, maxY}, Vec3 = [number, number, number],
     CameraFit {position: Vec3, target: Vec3, fovDeg, aspect, near, far, distance}.
   - export const CAMERA_FOV_DEG = 30, CAMERA_PITCH_DEG = 58 (angle below the horizon).
   - toGround(p: Vec2): Vec3 and fromGround(v: Vec3): Vec2 for the convention above.
   - fitCamera(bounds, aspect, opts?: {fovDeg?, pitchDeg?, margin? = 0.04}): CameraFit.
     Target = bounds centre on the ground. Camera direction fixed by pitch (no yaw/roll).
     Choose the smallest distance such that all four ground corners of the bounds project inside
     NDC [-1+margin, 1-margin] on BOTH axes for the given aspect (fovDeg is the vertical FOV, like
     THREE.PerspectiveCamera). A closed form or a short bisection is fine; it must be
     deterministic. near/far must enclose the whole map with slack (e.g. near = distance/100,
     far = distance*4).
   - project(cam, p: Vec3): {x, y, depth} | null — NDC x/y (y up, like WebGL), null if behind
     the camera.
   - groundPoint(cam, ndcX, ndcY): Vec2 | null — ray from the camera through the NDC point,
     intersected with Y = 0, returned as world (x, y). null if the ray is parallel to or points
     away from the ground.
   - ndcFromClient(clientX, clientY, rect: {left, top, width, height}): {x, y} — CSS px to NDC.
     Takes a plain rect (caller passes canvas.getBoundingClientRect()); no DOM access inside.
2. web/src/render/select.ts — pure:
   - type RendererKind = "2d" | "3d"; type RendererCaps = {webgl2: boolean};
   - pickRenderer(search: string, caps: RendererCaps): {kind: RendererKind, reason: string}.
     Rules, in order: `2d=1` -> 2d ("forced"); `3d=1` (or bare `3d`) -> 3d if caps.webgl2 else 2d
     ("no webgl2"); otherwise 2d ("default"). `3d=0` counts as not requested. Default stays 2d
     until phase 8.
   - detectCaps(): RendererCaps lives in a separate tiny function that creates a throwaway canvas
     and checks getContext("webgl2"); keep it out of pickRenderer so pickRenderer stays testable.
3. gamePage.ts: call pickRenderer(location.search, detectCaps()) once at startup. Both outcomes
   still construct the Pixi 2D renderer in this phase; when kind is "3d", console.info one line
   saying the 3D renderer is not implemented yet and 2D is used. No other behaviour change.
4. Tests:
   - web/tests/camMath.test.ts: toGround/fromGround round-trip; fitCamera on 8000x8000 bounds at
     aspects 16/9, 4/3, 1, 9/16: every corner projects inside [-1, 1] on both axes AND at least one
     corner is within 0.02 of the margin edge (the fit is tight, not just valid); the camera is on
     the +Z side, above the ground, pitched by CAMERA_PITCH_DEG; orientation check: a point with
     smaller world y projects higher on screen, larger world x projects further right;
     project -> groundPoint round-trip within 0.01 cm for the corners, centre and random points
     (fixed seed); groundPoint returns null for a ray above the horizon; ndcFromClient maps rect
     corners to (-1, 1) / (1, -1) and the centre to (0, 0); fitCamera is deterministic.
   - web/tests/select.test.ts: table test for "", "?3d", "?3d=1", "?3d=0", "?2d=1",
     "?3d=1&2d=1", "?kiosk=1&3d=1" with webgl2 true/false.
   - extend the purity guard in web/tests/frameView.test.ts: camMath.ts and select.ts (except
     detectCaps) must not import three or pixi.js and must not use document/window.
5. docs/3d-renderer.md: append "Phase 3 — camera math" with the coordinate convention, FOV/pitch,
   the fit rule and the selection rules, plus a one-line parity note.

Constraints:
- Do NOT modify web/src/sim/, web/src/game/session.ts, scoring, kiosk logic, touch controls logic,
  level code or the phase 0 probe (web/src/render/three3d/probe.ts). No new dependencies.
  English only.
- camMath.ts and select.ts must not import three — three stays only in the lazy chunk.
- The main entry bundle must not grow by more than ~2 kB gzip (pure math only).
- No CHANGELOG entry (no user-visible change).

Done when:
- cd web && npx tsc --noEmit, pnpm test (all old tests + new ones), pnpm build:public
  ("verify-dist: OK") pass. three is still absent from the entry chunk (tests/three-lazy.test.ts).
- Parity: /?auto&seed=42 score card unchanged vs phase 2 (500 points, 3.7 s / 6.0 s, 2/3 kills).
  /?3d=1 still plays in 2D and logs the "not implemented yet" line once; /?2d=1 is silent.
- Show me the plan first, then implement. Do not commit.
```

## Evidence to save in this folder

- `session.md` — summary of the Junie session (from `~/.junie/sessions`, strip local paths)
- `plan.png`, `run-*.png` — plan and test/build runs
- `corrections.md` — anything you had to correct or re-prompt
