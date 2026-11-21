---
sessionId: session-261122-033013-pb9y
---

# Requirements

### Overview & Goals
Phase 3 of the optional 3D renderer: add pure, testable camera math (fit a perspective camera to the map, project world points, map screen points back to the ground) and a pure renderer-selection function. There is still no three.js scene, and the game keeps rendering with Pixi 2D.

### Scope
**In scope**
- New `web/src/render/three3d/camMath.ts` (pure math, no `three`, no DOM).
- New `web/src/render/select.ts` (`pickRenderer` is pure; `detectCaps` is a tiny DOM helper).
- `web/src/game/gamePage.ts`: call `pickRenderer` once at startup and log one info line when the result is `3d`.
- Tests: `web/tests/camMath.test.ts`, `web/tests/select.test.ts`, and an extended purity guard in `web/tests/frameView.test.ts`.
- `docs/3d-renderer.md`: new section "Phase 3 — camera math".

**Out of scope**
- Any three.js scene or a 3D `GameRenderer`.
- Changes to `web/src/sim/`, `session.ts`, scoring, kiosk, touch controls, level code, or `three3d/probe.ts` and its `?3d` hook in `main.ts`.
- New dependencies and a CHANGELOG entry.

### Functional Requirements
- **Coordinates:** world (x, y) maps to 3D (X = x, Y = 0, Z = y); 1 unit = 1 cm. The camera sits on the +Z side of the map centre, raised and looking down toward -Z. Screen-up means smaller world y and screen-right means larger world x, the same as in 2D.
- **Camera:** `CAMERA_FOV_DEG = 30` (vertical FOV) and `CAMERA_PITCH_DEG = 58` (degrees below the horizon).
- **Fit:** the camera uses the smallest distance at which all four ground corners land inside NDC `[-1+margin, 1-margin]` on both axes. The default margin is 0.04. The result is deterministic.
- **Selection rules, checked in order:**
  1. `2d=1` → 2d (`"forced"`).
  2. `3d=1` or a bare `3d` → 3d if WebGL2 is available, otherwise 2d (`"no webgl2"`).
  3. Anything else → 2d (`"default"`). `3d=0` counts as not requested.
- **Game page:** the Pixi 2D renderer is always created. When the pick is `3d`, exactly one `console.info` line says the 3D renderer is not implemented yet and 2D is used. `?2d=1` and the default case log nothing.

### Non-Functional Requirements
- `three` stays only in the lazy chunk. The entry bundle grows by at most ~2 kB gzip; only `select.ts` reaches the entry, because `camMath.ts` is not imported yet.
- `/?auto&seed=42` gives the same score card as in phase 2: 500 points, 3.7 s / 6.0 s, 2/3 kills.
- All text is in English.

# Technical Design

### Current Implementation
- `GameRenderer.screenToWorld` is in `web/src/render/renderer.ts`. The Pixi version in `web/src/render/pixi2d.ts` divides the panel size by `max(width, height)` and uses `clientToCanvas` (`web/src/game/input.ts`) for HiDPI.
- `startGame()` in `web/src/game/gamePage.ts` parses URL params (`parseKiosk(location.search)`) and then calls `createPixi2dRenderer(...)`.
- `main.ts` lazily imports `./render/three3d/probe` when `?3d` is present. This stays untouched.
- Guards: the purity regex in `frameView.test.ts` rejects `Math.random|Date|performance.now|window|document|pixi|three` imports. `three-lazy.test.ts` checks `main.ts`.

### Key Decisions
- **Fit by bisection, not a closed form.** `fitness(D)` is the largest corner value of `max(|ndcX|, |ndcY|) / (1 - margin)`, counted as `Infinity` when a corner is behind the camera. The upper bound starts at the map diagonal and doubles until it fits. Then a fixed 64-iteration bisection runs on `[0, hi]` and returns `hi`. This is deterministic, always valid, and tight to well within 0.02.
- **`depth` is the view-space distance along the camera's forward axis, in cm.** This is simpler than WebGL NDC z and is enough for ordering and culling. `project` returns null when depth ≤ 0.
- **`detectCaps` stays in `select.ts`, at the end of the file.** The purity test removes its function body before applying the regex (as the issue allows).
- **Query parsing goes through `URLSearchParams`**, like `parseKiosk`. `3d` is requested only when its value is `""` or `"1"`; `2d` is forced only when its value is `"1"`.

### Data Models / Contracts
```ts
// camMath.ts (header comment documents the coordinate convention)
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type Vec3 = [number, number, number];
export type CameraFit = { position: Vec3; target: Vec3; fovDeg: number; aspect: number; near: number; far: number; distance: number };
export const CAMERA_FOV_DEG = 30, CAMERA_PITCH_DEG = 58;
export function toGround(p: Vec2): Vec3;            // [x, 0, y]
export function fromGround(v: Vec3): Vec2;          // {x: v[0], y: v[2]}
export function fitCamera(b: Bounds, aspect: number, opts?: { fovDeg?: number; pitchDeg?: number; margin?: number }): CameraFit;
export function project(cam: CameraFit, p: Vec3): { x: number; y: number; depth: number } | null;
export function groundPoint(cam: CameraFit, ndcX: number, ndcY: number): Vec2 | null;
export function ndcFromClient(cx: number, cy: number, r: { left: number; top: number; width: number; height: number }): { x: number; y: number };

// select.ts
export type RendererKind = "2d" | "3d";
export type RendererCaps = { webgl2: boolean };
export function pickRenderer(search: string, caps: RendererCaps): { kind: RendererKind; reason: string };
export function detectCaps(): RendererCaps; // throwaway canvas, getContext("webgl2"), try/catch -> false
```

**Camera math**, with pitch `p`:
- Forward `f = (0, -sin p, -cos p)`, right `r = (1, 0, 0)`, up `u = r × f = (0, cos p, -sin p)`.
- `position = target - f·D`, which places the camera on +Z and above the ground.
- `near = D/100`, `far = D*4`.

**Projection.** With `v = p - pos`, `zc = v·f` and `t = tan(fov/2)`:
- `x = (v·r) / (zc·t·aspect)`
- `y = (v·u) / (zc·t)`

**Inverse (`groundPoint`).**
- Ray direction `dir = f + r·ndcX·t·aspect + u·ndcY·t`.
- If `dir.y >= 0`, return null (the ray is parallel to the ground or points away from it).
- Otherwise `s = -pos.y / dir.y` and the result is `fromGround(pos + dir·s)`.

**`ndcFromClient`:**
- `x = 2(cx - left)/width - 1`
- `y = 1 - 2(cy - top)/height`

### Proposed Changes
- `gamePage.ts`, in `startGame()` next to `parseKiosk`:
  ```ts
  const pick = pickRenderer(location.search, detectCaps());
  if (pick.kind === "3d") console.info("[renderer] 3D renderer is not implemented yet; using 2D");
  ```
  `createPixi2dRenderer` stays unconditional.
- Purity guard in `frameView.test.ts`, as a new test in `describe("frame view purity")`:
  - Load `camMath.ts` and `select.ts` raw.
  - For `select.ts`, assert that a `export function detectCaps` block exists, then strip it with a regex up to its closing `\n}`.
  - Apply the regex `\bwindow\b|\bdocument\b|pixi|from\s*["']three|import\s*\(?\s*["']three` (plus `Math.random`).
  - Separately assert that the full `select.ts` never imports three or pixi.
- Docs: append "Phase 3 — camera math" to `docs/3d-renderer.md` with the convention, FOV/pitch, fit rule, selection rules and the parity note.

### File Structure
- Added: `web/src/render/three3d/camMath.ts`, `web/src/render/select.ts`, `web/tests/camMath.test.ts`, `web/tests/select.test.ts`
- Modified: `web/src/game/gamePage.ts`, `web/tests/frameView.test.ts`, `docs/3d-renderer.md`

### Risks
- Comments that mention `window`, `document` or `three` would trip the purity regex, so comment wording in both files must avoid those words.
- Monotonic fitness: with a fixed pitch and corners on the ground, all projections shrink toward the centre as D grows, so bisection is sound. The doubling loop has an iteration cap for safety.

# Testing

### Validation Approach
- `cd web && npx tsc --noEmit`
- `pnpm test`: all old and new tests, including `three-lazy.test.ts` and the extended purity guard.
- `pnpm build:public` must print `verify-dist: OK`. Compare the entry chunk gzip size with the phase 2 figure in the docs; growth must be at most ~2 kB.
- Browser parity check on the dev server (port 5177) with a headless Playwright script (webapp-testing helper):
  - `/?auto&seed=42` score card shows 500 points, 3.7 s / 6.0 s, 2/3 kills.
  - `/?3d=1` logs the "not implemented yet" line exactly once and still draws a Pixi canvas.
  - `/?2d=1` logs no renderer line.

### Key Scenarios (`camMath.test.ts`)
- `toGround`/`fromGround` round-trip.
- `fitCamera` on 8000×8000 bounds at aspects 16/9, 4/3, 1 and 9/16:
  - All corners project inside [-1, 1].
  - At least one corner on one axis is within 0.02 of `1 - margin`.
- The camera has Z > target Z and Y > 0, and `atan2(dy, dz)` equals `CAMERA_PITCH_DEG`.
- Orientation: a smaller world y projects to a larger NDC y; a larger world x projects to a larger NDC x.
- `project` → `groundPoint` round-trip within 0.01 cm for the corners, the centre and 50 random points (`seedRng(42)` / `nextFloat` from `sim/rng.ts`).
- `groundPoint(cam, 0, 1.5)`, a ray above the horizon, returns null.
- `ndcFromClient`: the top-left rect corner gives (-1, 1), the bottom-right gives (1, -1), and the centre gives (0, 0).
- Two `fitCamera` calls with the same arguments return deep-equal results.

### Key Scenarios (`select.test.ts`)
Table test with expected `{kind, reason}`:

| Query | webgl2 = true | webgl2 = false |
| --- | --- | --- |
| `""` | 2d / default | 2d / default |
| `?3d` | 3d | 2d / no webgl2 |
| `?3d=1` | 3d | 2d / no webgl2 |
| `?3d=0` | 2d / default | 2d / default |
| `?2d=1` | 2d / forced | 2d / forced |
| `?3d=1&2d=1` | 2d / forced | 2d / forced |
| `?kiosk=1&3d=1` | 3d | 2d / no webgl2 |

# Delivery Steps

### ✓ Step 1: Implement pure camera math with tests
`camMath.ts` fits, projects and inverts the camera, and `camMath.test.ts` verifies it.

- Create `web/src/render/three3d/camMath.ts`:
  - Header comment with the coordinate convention.
  - Types `Bounds`, `Vec3`, `CameraFit`; constants `CAMERA_FOV_DEG`, `CAMERA_PITCH_DEG`.
  - Functions `toGround`, `fromGround`, `fitCamera` (bisection with doubling upper bound), `project`, `groundPoint`, `ndcFromClient`.
  - No three or DOM imports.
- Add `web/tests/camMath.test.ts`:
  - Round-trip, tight fit at 4 aspects, camera placement and pitch, orientation.
  - `project` → `groundPoint` round-trip with seeded points; above-horizon null.
  - `ndcFromClient` corners and centre; determinism.
- Run `npx tsc --noEmit` and `pnpm test`.

### ✓ Step 2: Add renderer selection and hook it into the game page
`pickRenderer` and `detectCaps` exist and are tested; the game page logs once for `3d` and still renders with Pixi 2D.

- Create `web/src/render/select.ts`:
  - `RendererKind`, `RendererCaps`.
  - `pickRenderer` using `URLSearchParams` and the rule order forced → 3d/no webgl2 → default.
  - `detectCaps` last in the file, with a throwaway canvas and try/catch.
- Add `web/tests/select.test.ts` as a table test covering 7 queries × webgl2 true/false.
- In `web/src/game/gamePage.ts` `startGame()`:
  - Call `pickRenderer(location.search, detectCaps())` once.
  - Log one `console.info` line when the result is `3d`.
  - Keep `createPixi2dRenderer` unconditional.
- Extend the purity guard in `web/tests/frameView.test.ts`:
  - `camMath.ts` and `select.ts` (with the `detectCaps` body stripped) must not use window/document, pixi or three.
  - The full `select.ts` must never import three or pixi.

### ✓ Step 3: Document phase 3 and verify build and parity
The docs describe phase 3, and the build, bundle size and in-game parity checks all pass.

- Append "Phase 3 — camera math" to `docs/3d-renderer.md`:
  - Convention, FOV/pitch, fit rule, selection rules.
  - One-line parity note and the entry chunk size.
- Run `npx tsc --noEmit`, `pnpm test` and `pnpm build:public` (expect `verify-dist: OK`).
- Confirm the entry gzip grew by at most ~2 kB and three is absent from it.
- Run a headless Playwright check on the dev server:
  - `/?auto&seed=42` score card is unchanged (500 points, 3.7 s / 6.0 s, 2/3 kills).
  - `/?3d=1` logs the line once and plays in 2D.
  - `/?2d=1` logs no renderer line.
- No commit and no CHANGELOG entry.