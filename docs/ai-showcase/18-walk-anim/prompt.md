# Task 18 — Walk animation plumbing

Branch: `feat/walk-anim`. **Not a Junie session**: implemented by another AI coding tool from a plan
written by a planning agent and approved by the user.

## User request (translated from Indonesian)

"Can the characters get a walking animation when they move?"

## User decisions

- The legs actually step (not only the existing bob).
- 3D: skeletal animation via three.js `AnimationMixer`; 2D: a pre-rendered sprite sheet.
- Only the hips and legs animate.

## Prompt summary

Goal: the asset-independent part of the plan (steps 1-4), so rigged GLBs and walk sprite sheets can
be dropped in later. With no new assets present the game must look and behave exactly as now.

1. `render/actorMotion.ts`: a walk `cycle` (0..1) in `MotionSample`, advanced by distance
   (`WALK_CYCLE_CM` = 380 = 2 × the footstep sound's `STEP_CM`, asserted in a test); 0 under
   reduced motion, reset on a jump, frozen when the actor does not move (paused replay).
2. `render/spritePose.ts`: `walkFrame(cycle, speed01, n)` (0 idle, 1..n walk), a `frame` in
   `SpritePose`, no scale bob while a sheet is active.
3. `render/actorSprites.ts`: try `sprites/operator-walk.webp` / `sprites/enemy-walk.webp`
   (3 × 3 grid of 256 px cells, cell 0 idle) first, fall back silently to the static sprites;
   one shared source per sheet, `liftLevels` once per sheet, correct texture destruction.
4. 3D: an optional rig on `ActorModel` (`models/operator-rifle-rig.glb`, `models/enemy-rig.glb`,
   requires a `SkinnedMesh` and a `walk` clip, `idle` optional); per standing slot a
   `SkeletonUtils.clone` with the layer's role material, bob/lean/scale on a wrapper, walk time =
   cycle × duration, idle by wall-clock time, weights from `speed01`, `mixer.update(0)`; reduced
   motion holds idle at t = 0; downs keep the static fall; dispose with `stopAllAction` +
   `uncacheRoot`.

Hard constraints: do not touch the sim, `session.ts`, scoring, kiosk, touch controls, level code,
the 3D probe or `switchable.ts`; three.js only inside `render/three3d/`; do not create the asset
files; keep the quality-tier shadow recompile working for skinned materials. No commits; project
text in English; no local absolute paths.

Tests: cycle growth/wrap/reset/freeze/reduced motion, `walkFrame`, sheet slicing and texture
destruction, and a fake rig (bones, `SkinnedMesh`, two clips): names kept, distinct skeletons per
slot, no per-frame allocation, fallback without a walk clip, dispose cleanup.

Docs: a "Walk animation" section in `docs/3d-renderer.md`, a CHANGELOG line, this prompt.

Done when: `npx tsc --noEmit` is clean, `pnpm test` passes, `pnpm build:public` prints
`verify-dist: OK`, and the entry / three3d / three.module gzip sizes are reported.
