# Visual assets

Record of every non-code visual asset in the web client, so its origin can be checked.

## Generated raster images (`web/public/assets/`)

Generated with the Runware API (`imageInference`), model `runware:100@1`, output WEBP, one result per
prompt, 3 generations in total. Prompts are generic and original: no game titles, brands, players,
logos or text, and no style or assets from any existing game. Files were re-encoded locally with
`cwebp` (quality 66–72; thumbnails resized to 640 px wide). They are served from the same origin
(CSP `img-src 'self'`).

Shared negative prompt: `text, letters, numbers, logo, watermark, signature, people, characters, weapons, UI, interface, brand`

| File | Use | Size (generated) | Seed | Prompt |
| --- | --- | --- | --- | --- |
| `menu-bg.webp` | Menu / attract / score backdrop | 1344×768 | 14077016 | Dark abstract tactical command room atmosphere, top-down blueprint of an empty industrial complex fading into darkness, faint cyan grid lines, subtle teal and amber glow, volumetric haze, cinematic, minimal, deep navy black background, high contrast, moody, no text |
| `thumb-kiln.webp` | Level card thumbnail, Kiln map | 1024×576 → 640×360 | 1514470965 | Top-down aerial view of an abandoned brick kiln factory courtyard at dusk, orange ember glow from furnace openings, dark concrete corridors, warm rust and amber tones, dramatic shadows, stylized digital painting, cinematic, no text |
| `thumb-cistern.webp` | Level card thumbnail, Cistern map | 1024×576 → 640×360 | 193019282 | Top-down aerial view of an ancient underground stone cistern with shallow water channels and arches, cool teal and cyan light reflecting on water, dark stone walkways, misty, stylized digital painting, cinematic, no text |

The thumbnails are mood images for the original Kiln and Cistern maps; they do not depict the playable
geometry.

No raster asset is used inside the game canvas: the map floor, grid, walls and actors are drawn
procedurally with Pixi Graphics (`web/src/render/mapView.ts`, `web/src/render/actors.ts`), so no
floor texture was generated.

## 3D models (`web/public/models/`)

Made for the planned Three.js renderer. Pipeline: one concept image per asset with the Runware API
(`imageInference`, model `runware:z-image@0`, 1024×1024 PNG, one result each), then image-to-3D with
Runware `3dInference`, model `microsoft:trellis-2@4b`, then local optimisation with glTF Transform
4.5.1 (`@gltf-transform/core`/`functions`, meshoptimizer 1.3.0 simplifier, sharp 0.35.5) in a
temporary script outside the repo. Prompts are generic and original: a nameless operator with no
logos, insignia or text, and a flat rugged case for the planted device (deliberately not a tall
cylinder). Tripo was not needed. The concept images are kept as 512 px WebP in `docs/assets/3d/`.

TRELLIS.2 settings (all four): `resolution: 1024`, `textureSize: 1024`, `decimationTarget: 5000`,
`textureFormat: PNG`, `remesh: true`, `seed: 7`, input = the concept image as JPEG (q90) data URI.

Optimisation (all four): flatten, dedup, weld; meshoptimizer simplify only down to the triangle
budget; the metallic-roughness texture is dropped (constant `metallic 0`, `roughness 0.85`); base
colour resized to 512×512 JPEG (q78); baked so the model is centred on x/z with its base on `y = 0`,
**units are cm** (same as the sim world units), +Y up. No extensions are used (`extensionsUsed:
none`): no Draco, meshopt, KTX2 or WebP, so the stock `GLTFLoader` loads them without decoders.
Each file is one mesh, one material, one texture.

| File | Concept seed | Triangles | Size | Bounds (cm, x × y × z) | Facing / notes |
| --- | --- | --- | --- | --- | --- |
| `operator.glb` | 4101 | 4,949 | 226.0 KB | 74.6 × 180 × 43.6 | Faces +Z. Light grey/off-white albedo with a dark visor, so `material.color` tints it per team. Neutral standing pose, no rig. |
| `device.glb` | 4102 | 1,984 | 155.6 KB | 40 × 15 × 28.4 | Lies flat, display on top (+Y), keypad end towards +X. Dark grey case with amber keys. The small antenna in the concept did not survive image-to-3D. |
| `crate.glb` | 4103 | 1,940 | 98.2 KB | 81.6 × 80 × 81.6 | Olive supply crate with steel corners; symmetric. |
| `barrel.glb` | 4104 | 1,938 | 91.8 KB | 59.8 × 90 × 60 | Rust-orange steel drum; symmetric. |

| `operator-rifle.glb` | 4201 | 3,830 | 159.9 KB | 49 × 180 × 102.6 | Operator holding a rifle; rifle muzzle points +Z (the raw TRELLIS model had it on +X, baked with a −90° Y rotation). Light grey albedo, dark visor. |
| `enemy.glb` | 4203 | 3,830 | 213.0 KB | 97.9 × 180 × 140.8 | Heavy armoured trooper with backpack (bulky, hooded helmet, wide pauldrons); SMG points +Z, backpack on −Z (no rotation needed). Dark grey gun in albedo. Top-down texture has dark blotches on the pauldrons (not visible in the concept). |

Sizes are `ls -l` of the final files; triangle counts are from `gltf-transform inspect`.

Concept prompts (`runware:z-image@0`, 1024×1024, no negative prompt):

- Operator: 3D game asset render of a generic tactical operator character standing upright in a
  neutral A-pose, full body from helmet to boots, three-quarter front view, matte light grey and
  off-white uniform, plain rounded helmet with dark visor covering the face, plate carrier vest with
  simple pouches, gloves, knee pads, combat boots, no weapon, no logos, no text, no insignia, clean
  readable silhouette, simple stylized shapes, soft even studio lighting, plain pure white
  background, centered, single character
- Device: 3D game asset render of a compact rugged field device lying flat on the ground, low flat
  rectangular hard-shell case with rounded corners, short stubby antenna on one corner, small blank
  dark display screen and a small keypad on the top face, metal latches on the sides, dark gunmetal
  grey body with a small amber indicator light, three-quarter top-down view, no text, no logos, clean
  silhouette, soft even studio lighting, plain pure white background, centered, single object
- Crate: 3D game asset render of a single sturdy supply crate, cube-shaped box made of dark olive
  painted plywood panels with steel corner brackets and edge reinforcement, three-quarter view, no
  text, no stencils, no logos, clean silhouette, soft even studio lighting, plain pure white
  background, centered, single object
- Barrel: 3D game asset render of a single upright steel oil drum barrel, worn rust-orange paint
  with two horizontal ribs, closed lid, slightly scuffed, three-quarter view, no text, no labels, no
  logos, clean silhouette, soft even studio lighting, plain pure white background, centered, single
  object

Character pass (branch `feat/character-art`, same pipeline and TRELLIS settings, `seed: 7`; triangle
budget 3,950 → 3,830 after simplify; the concept prompts were written for this pass):

- Operator with rifle (concept seed 4201): same prompt as the Operator above but "holding a rifle in
  both hands pointing straight forward at chest height, rifle clearly visible with a long barrel and
  stock" instead of "no weapon".
- Enemy (concept seed 4203, final): 3D game asset render of a generic heavy armored trooper character
  standing upright, strict side profile view facing right, whole body turned to the right, full body
  from helmet to boots, bulky silhouette with oversized rounded shoulder pauldrons, tall angular
  hooded helmet with a narrow dark visor slit, large backpack on the back, thick armored arms and legs,
  holding a short compact submachine gun with a long curved magazine in both hands pointing straight
  to the right, matte light grey and off-white armor, no logos, no text, no insignia, clean readable
  silhouette, simple stylized shapes, soft even studio lighting, plain pure white background,
  centered, single character. Attempt 1 (seed 4202, three-quarter view, same prompt otherwise) was
  discarded: the gun pointed diagonally and the torso faced sideways to it.

Top-down sprites (`web/public/sprites/operator.webp`, `enemy.webp`, 256×256, transparent): each final
GLB rendered offline from straight above with a three.js orthographic camera in headless Chrome
(ambient 1.6 + top directional 1.6, material colour forced white, so `sprite.tint` works). Model +Z
points to image +X (rifle to the right). Scale 0.8 cm/px for both (256 px = 204.8 cm), centred on the
footprint bounding box. Operator footprint 128×62 px, enemy 176×124 px. Sprite WebP quality 90.
The files are stored as rendered; at load time the 2D renderer lifts their grey levels to 0.62..1
(`liftLevels` in `web/src/render/spritePose.ts`) so the role tint stays bright and dark patches vanish.

Attempts and cost, character pass (actual `cost`, USD):

| Asset | Concept | 3D | Total |
| --- | --- | --- | --- |
| operator-rifle | 0.0104 | 0.0149 | 0.0253 |
| enemy attempt 1 (discarded) | 0.0104 | 0.0268 | 0.0372 |
| enemy attempt 2 (final) | 0.0119 | 0.0208 | 0.0327 |
| **Total** | 0.0327 | 0.0625 | **0.0952** |

Attempts and cost (actual `cost` returned by the API, USD): one attempt per asset, no retries.

| Asset | Concept (`runware:z-image@0`) | 3D (`microsoft:trellis-2@4b`) | Total |
| --- | --- | --- | --- |
| operator | 0.0104 | 0.0149 | 0.0253 |
| device | 0.0104 | 0.0312 | 0.0416 |
| crate | 0.0104 | 0.0551 | 0.0655 |
| barrel | 0.0104 | 0.0253 | 0.0357 |
| **Total** | 0.0416 | 0.1265 | **0.1681** |

Licences (checked 2026-11-22):

- TRELLIS.2: code and weights are MIT
  (<https://github.com/microsoft/TRELLIS.2/blob/main/LICENSE>,
  <https://huggingface.co/microsoft/TRELLIS.2-4B>, `license: mit`). The licence places no
  restriction on generated output.
- Z-Image: Apache-2.0 (<https://huggingface.co/Tongyi-MAI/Z-Image>). Assumption, not verified: the
  Runware AIR `runware:z-image@0` serves these Tongyi-MAI weights; Runware does not list a licence
  per model.
- Use through Runware is also subject to the Runware terms (<https://runware.ai/terms>); output
  ownership clauses there were not re-read for this pass.

## Score card and social preview

- Score card PNG (`web/src/game/cardImage.ts`): drawn client-side on a 2D canvas with the theme
  colours, the logo mark (same SVG paths via `Path2D`) and the self-hosted fonts.
- `web/public/og-image.png` (1200×630): generated by `pnpm -C web og-image`
  (`web/scripts/make-og-image.mjs`, dependency-free, deterministic). The PNG is committed because
  crawlers need a static file and the generator needs no runtime dependency. It does not use the
  Runware backdrop: decoding WebP in Node would need an extra dependency.

## Logo and favicon

The mark (a bevelled frame around a crosshair whose ring is a replay arrow) is hand-written SVG: inline
`<symbol id="rtr-mark">` in `web/index.html` and `web/public/favicon.svg`. The wordmark is set in
Chakra Petch.

## Fonts

Self-hosted from npm, SIL Open Font License 1.1, latin subset only, bundled by Vite:

- Chakra Petch 500/600/700 (`@fontsource/chakra-petch` 5.3.0): display and UI text.
- JetBrains Mono 400/700 (`@fontsource/jetbrains-mono` 5.3.0): numbers, labels, stats.
