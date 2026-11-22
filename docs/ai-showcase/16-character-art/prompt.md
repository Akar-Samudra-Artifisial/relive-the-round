# Junie task 16 — Character models and sprites

IDE: WebStorm + Junie. Branch: `feat/character-art` (on top of the finished 3D renderer).

MEDIUM RISK: the actor bodies change in both renderers. Cylinders (3D) and circles (2D) become
character models and top-down sprites generated with Runware (see `docs/assets.md`), animated
procedurally. The primitives stay as the fallback, so a missing or broken asset never breaks a
round.

## Prompt (paste into Junie)

```
Goal: replace the primitive actor bodies (cylinders in 3D, circles in 2D) with character models
and sprites plus procedural animation, keeping the current primitives as the fallback.
Read .junie/guidelines.md, docs/3d-renderer.md and docs/assets.md first.

Context (current code, verify line numbers yourself):
- Assets (one mesh / material / texture, no glTF extensions, cm, +Y up, base on y = 0, faces +Z,
  ~180 cm, light grey for tinting): web/public/models/operator-rifle.glb (YOU + PRO),
  web/public/models/enemy.glb. Sprites: web/public/sprites/operator.webp, enemy.webp (256x256,
  top-down, alpha, facing +X, light grey). Load them same-origin via import.meta.env.BASE_URL;
  the CSP allows img-src 'self' data: blob: and connect-src 'self' only.
- 2D: web/src/render/actors.ts (drawPlayer / drawEnemy / drawDown, drawFrame), actorStyle.ts
  (PLAYER_R, ENEMY_R, colours), pixi2d.ts (drawFrame call, panel scale).
- 3D: web/src/render/three3d/actorScene.ts (cylinder bodies, Lambert materials, overlays, aim /
  nose, enemy cone + tick, downs, world mapping), three3d.ts (renderer lifecycle, `failed`,
  shadows / quality recompile that only handles Lambert).
- FrameView (renderer.ts): positions, enemy facing fx/fy, player aim; no velocity. In the replay
  the enemy `z` shifts on a kill. replayPlayer panels: YOU cyan, PRO amber accent, but the body
  is always cyan today.
- Guards: tests/actorScene.test.ts (mesh names player-body / enemy-body, counts, no per-frame
  allocation, dispose); tests/three-lazy.test.ts (three only under render/three3d/).

Implement exactly this:
1. web/src/render/actorMotion.ts (pure, no three / pixi): per-actor state keyed by identity
   (player; enemy z). Reset on a missed frame or a jump > 3 x RUN_SPEED per second. Heading =
   aim / facing if present, else movement direction, else the last heading. Speed from the
   position delta, smoothed. Downs fall 0 -> 1 over 250 ms, yaw from a position hash.
   prefers-reduced-motion snaps. Outputs heading, speed01, bob, lean, fallT.
2. 3D: render/three3d/actorModels.ts with GLTFLoader (static import inside the lazy chunk). Load
   once per renderer; primitives until loaded, then layer.setModels(models); failure -> one
   console.warn, primitives stay; resolve after destroy() / failed -> dispose at once. Shared
   geometry / texture owned by the renderer; each layer owns per-role MeshLambertMaterials.
   Hierarchy slot -> pivot (yaw from heading) -> mesh (bob, lean). One MODEL_SCALE constant.
   Downs lie flat with a darker material; ring and X stay. Tint YOU cyan, PRO amber (panel
   accent), enemy red. Keep the aim cone / view cone; hide the nose / tick when models show.
3. 2D: render/actorSprites.ts. Panel layers: map, Graphics under (spike, glow, cones, rings),
   pooled sprites, Graphics over (tracers). drawFrame split into under / over passes with
   bodies: false when sprites are ready; failure keeps the old Graphics path. Rotation = heading,
   bob = scale +-3 %, downs darker at alpha 0.5, tint per role. One SPRITE_SCALE constant.
4. Tests: actorMotion, sprite placement math, actorScene additions (model swap keeps names, yaw
   from heading, shared geometry not disposed by the layer, PRO tint).
5. Docs: docs/3d-renderer.md "Character models" section (loading, fallback, motion, scale,
   sizes); CHANGELOG.md Added + Changed (PRO body amber).

Constraints:
- Do NOT modify web/src/sim/, docs/assets.md or web/public/. three only under render/three3d/.
- Code and tests must work without the asset files. No new dependencies. English only.
- No CSP changes. No local filesystem paths in any tracked file.

Done when:
- cd web && npx tsc --noEmit, pnpm test, pnpm build:public ("verify-dist: OK (6 level(s)...)")
  pass; report entry, three3d and three.module chunk sizes (gzip -9) and any new chunk.
- Browser: 3D and ?2d=1 show characters turning with the aim, downs falling; the replay shows a
  cyan YOU and an amber PRO; with the assets removed both renderers fall back to the primitives
  with one warning. No console errors.
- Show me the plan first, then implement. Do not commit.
```

## Evidence to save in this folder

- `session.md`: the Junie session export (plan, commands and results).
- Screenshots: 3D and 2D gameplay with the characters, the two-panel replay (YOU cyan, PRO amber).
- `corrections.md`: human corrections during the session (for example the CSP `blob:` texture
  loading and keeping Pixi `Assets` out of the entry chunk).
