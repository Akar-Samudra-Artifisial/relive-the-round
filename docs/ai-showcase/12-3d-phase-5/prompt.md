# Junie task 12 — 3D renderer, phase 5 (actors, cones, tracers, spike)

IDE: WebStorm + Junie. Branch: `feat/3d-renderer` (phase 4 committed as `f8d13af`).

MEDIUM RISK phase: the 3D view becomes playable. Everything stays behind `?3d=1`; the default 2D
path must not change. Only the first panel is drawn (replay viewports come in phase 6), and no
shadows or quality tiers yet (phase 7).

## Prompt (paste into Junie)

```
Goal: phase 5 of the optional 3D renderer. Draw the dynamic layer of a FrameView in three.js
(player, enemies, downed markers, aim and view cones, tracers, spike with pulse and defuse ring)
so a round is fully playable with ?3d=1. The default 2D game must not change.
Read .junie/guidelines.md and docs/3d-renderer.md (phase 0-4 notes) first.

Context (current code, verify line numbers yourself):
- web/src/render/renderer.ts: SpikeView :10 {defuse, enemyDefuse?, pulseT: number | null};
  ActorView :23 {x, y, fx?, fy?, z?}; DownView :32 {x, y, side: "player" | "enemy", z?};
  TracerView :39 {shot, fade}; FrameView :45 {player: {x, y, aim: Vec2 | null} | null, enemies,
  downs, spike: (Vec2 & SpikeView) | null, tracers}; GameRenderer :66.
- web/src/render/actors.ts is the 2D reference, read all of it:
  local constants :14-24 (PLAYER_COLOR = THEME_NUM.cyan, ENEMY_COLOR = THEME_NUM.red, tracer
  colours 0xc8f8ff / 0xff9a5c, PLAYER_R 120, ENEMY_R 110, AIM_LEN 1100, AIM_HALF 0.16,
  VIEW_LEN 520, VIEW_HALF 0.32); cone :27; drawPlayer :47 (glow r*1.9 alpha 0.1, aim cone
  alpha 0.12, aim line, nose); drawEnemy :75 (view cone alpha 0.1 only when fx/fy != 0, facing
  tick); drawDown :86 (ring r100 + X); drawTracer :93 (halo + core, hit marker, fade clamped
  0..1); drawSpike :105 (DEFUSE_RADIUS zone, diamond, 1.2 s pulse ring to +420, progress ring at
  DEFUSE_RADIUS + 110 starting at 12 o'clock, green = own defuse, red = enemy); drawFrame :127
  (spike -> downs + enemies sorted by z -> player -> tracers).
- web/src/game/frameView.ts: liveFrame :40 already applies fog (segmentClear) and fills fx/fy;
  youFrame :62; proFrame :82 (no facing, no tracers). The renderer draws what it is given — it
  must not do its own visibility logic.
- web/src/render/three3d/three3d.ts: fields :19-27, draw :64 renders the scene and ignores frames,
  loop calls it every frame from gamePage.ts:845 with [lastLive] or replay.frames().
- web/src/render/three3d/mapScene.ts: axis (x, y) -> (X = x, Y = 0, Z = y) :17-18; layers
  floor Y 0, GRID_Y 1, ZONE_Y 2, LABEL_Y 3; renderOrder up to 5; WALL_HEIGHT 240; lines use
  depthWrite false. camMath.ts toGround/fromGround :34/:38.
- web/src/sim/constants.ts: DEFUSE_RADIUS 200 :59, ENEMY_HIT_RADIUS 90 :18.
- web/tests/mapScene.test.ts:60-73 axis test only checks the first vertex of one wall.

Implement exactly this:
1. web/src/render/actorStyle.ts (pure, no pixi/three/DOM): move the actor constants from
   actors.ts :14-24 there and export them; actors.ts imports them. 2D output must stay identical.
   Keep the 2D values even though the drawn view cone (520 cm, half 0.32 rad) differs from the
   sim rule (FOV_COS / VIEW_RANGE) — visual parity with 2D wins; add one comment saying so.
2. web/src/render/three3d/actorScene.ts — imports three, no WebGLRenderer, no DOM:
   class ActorLayer { readonly group: THREE.Group; update(frame: FrameView | null, nowMs: number):
   void; dispose(): void }.
   - Pooling: build shared geometries/materials once; keep pools of meshes per kind and only
     toggle .visible / set position, rotation, scale, opacity per update. After warm-up, update()
     must allocate no new geometries or materials (tests check this).
   - Player: cylinder body radius PLAYER_R, height 160, PLAYER_COLOR; flat glow disc r*1.9
     alpha 0.1 on the ground; when aim is set, a flat aim cone (AIM_LEN, AIM_HALF, alpha 0.12) and
     an aim line on the ground, plus a small nose marker at R + 90 pointing at the aim.
   - Enemies: cylinder radius ENEMY_R, height 150, ENEMY_COLOR; flat view cone (VIEW_LEN,
     VIEW_HALF, alpha 0.1) and facing tick only when fx/fy != 0 (same rule as 2D).
   - Downs: flat ring r100 + X on the ground, colour by side (same as drawDown).
   - Tracers: from shot origin to end at chest height (Y 120), halo + core with the 2D alphas times
     the clamped fade; hit marker (two discs like 2D) at the hit point when the shot hit.
   - Spike: zone disc DEFUSE_RADIUS, a small octahedron for the diamond hovering above the ground,
     pulse ring expanding to +420 over 1.2 s from pulseT, progress ring at DEFUSE_RADIUS + 110
     starting at 12 o'clock (world -y) going clockwise as seen from the camera; implement progress
     with a pre-built RingGeometry + setDrawRange, not by rebuilding geometry per frame. Green for
     own defuse, red for enemy defuse, exactly like drawSpike.
   - Ground decals use Y between 4 and 6 (above map layers), transparent, depthWrite false, and a
     renderOrder above the map's; bodies and tracers depth-test normally so walls can hide them.
   - Map world angles to three carefully: world y grows down and becomes +Z, so a world heading
     atan2(dy, dx) is a rotation about Y of -atan2(dy, dx). Check the sign in a test, do not guess.
   - dispose(): disposes every geometry and material it created.
3. three3d.ts: create one ActorLayer, add its group to the scene; draw(frames) calls
   layer.update(frames[0] ?? null, performance.now()) then renders. Use the same clock source the
   2D path uses for pulse/fade (the FrameView already carries fade; pulse uses nowMs). destroy and
   loadMap must not leak the layer (it survives loadMap; dispose on destroy).
4. Tests (no WebGL needed):
   - web/tests/actorScene.test.ts with hand-built FrameViews: visible mesh counts match the frame
     (1 player, N enemies, M downs, K tracers, spike or not); positions map world (x, y) to
     (x, *, y); a body heading (fx, fy) = (0, 1) points toward +Z (independent check, no camMath
     helpers); enemy cone hidden when fx = fy = 0; tracer core opacity equals 0.9 * clamp(fade,
     0, 1); spike progress 0.5 shows half the ring via drawRange; own vs enemy defuse colours;
     update(null) hides everything; calling update 50 times with changing frames creates no new
     geometry or material after the first call (spy on the constructors or count unique uuids);
     dispose calls dispose on every geometry and material.
   - web/tests/mapScene.test.ts (phase 4 reviewer note): the axis test iterates every vertex of
     every wall, not just the first.
   - Keep the existing purity and three-lazy guards passing; add actorStyle.ts to the purity guard.
5. docs/3d-renderer.md: replace the "Still missing" line of phase 4 and append
   "Phase 5 — actors" (layer ordering, pooling rule, angle mapping, cone parity note, what is
   still missing: replay viewports, shadows, quality tiers) plus the parity note.

Constraints:
- Do NOT modify web/src/sim/, web/src/game/session.ts, frameView.ts logic, scoring, kiosk logic,
  touch controls logic, level code, the phase 0 probe or gamePage.ts (unless a one-line wiring
  change is unavoidable — explain it in the plan). No new dependencies. English only.
- Entry chunk gzip must not grow by more than ~0.5 kB; three code stays in lazy chunks.
- No CSP changes, no CHANGELOG entry yet (phase 8).

Done when:
- cd web && npx tsc --noEmit, pnpm test (old + new), pnpm build:public ("verify-dist: OK") pass;
  report entry and three3d chunk sizes.
- Parity 2D: /?auto&seed=42 score card unchanged (500 points, 3.7 s / 6.0 s, 2/3 kills).
- 3D (headless Chrome 1280x800, pnpm dev): /?3d=1&auto&seed=42 finishes with the same score card
  as 2D, no console errors; screenshots mid-round showing the player with aim cone, an enemy with
  view cone, a tracer, and the spike with its defuse ring. Report the ?fps reading in 3D.
- Manual: with /?3d=1 the player body sits under the cursor-aim line, cones point the same way
  as in 2D for the same moment, and enemies behind walls are hidden by the walls, not drawn over
  them.
- Show me the plan first, then implement. Do not commit.
```

## Evidence to save in this folder

- `session.md` — summary of the Junie session (from `~/.junie/sessions`, strip local paths)
- `plan.png`, `run-*.png` — plan and test/build runs
- `actors-3d.png` — mid-round 3D frame with player, enemy, tracer and spike
- `corrections.md` — anything you had to correct or re-prompt
