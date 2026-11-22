import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { liftLevels } from "../spritePose";

/**
 * Character models for the 3D actor bodies (one mesh, one texture each; see docs/assets.md). The
 * renderer loads them once and shares geometry and texture across its panels; each `ActorLayer`
 * makes its own tinted materials. Until the models arrive (or when loading fails) the layers keep
 * the primitive cylinders.
 */

export type ActorModel = {
  readonly geometry: THREE.BufferGeometry;
  readonly map: THREE.Texture | null;
  /** Unscaled height (cm). */
  readonly height: number;
  /** Unscaled extent behind the origin (cm, ≥ 0): how far the back sticks out when lying down. */
  readonly back: number;
  /** Optional skinned rig for the standing bodies; downs always use `geometry`. */
  readonly rig?: ActorRig;
};

/**
 * A skinned character with a `walk` clip (and optionally `idle`). The scene stays the template:
 * layers clone it per standing slot (SkeletonUtils.clone) and replace the materials.
 */
export type ActorRig = {
  readonly scene: THREE.Object3D;
  readonly walk: THREE.AnimationClip;
  readonly idle: THREE.AnimationClip | null;
  /** Base colour texture of the skinned mesh (its UVs may differ from the static model's). */
  readonly map: THREE.Texture | null;
  /** Uniform scale that makes the rig RIG_HEIGHT_CM tall. */
  readonly unit: number;
  /** Offset (in rig units, before `unit`) that recentres x/z and puts the feet on y = 0. */
  readonly offset: THREE.Vector3;
};

export type ActorModels = { readonly operator: ActorModel; readonly enemy: ActorModel };

/** Rig height after `unit` (cm): the static models are authored ~180 cm tall. */
export const RIG_HEIGHT_CM = 180;

/** First URL is preferred; the next ones are fallbacks (relative to the Vite base). */
const OPERATOR_FILES = ["models/operator-rifle.glb", "models/operator.glb"];
const ENEMY_FILES = ["models/enemy.glb"];
/** Optional rigged models; missing or unusable files keep the static bodies, silently. */
const OPERATOR_RIG_FILE = "models/operator-rifle-rig.glb";
const ENEMY_RIG_FILE = "models/enemy-rig.glb";

/**
 * The rig of a loaded glTF, or null (after disposing it) when it has no SkinnedMesh or no clip
 * named `walk`. A clip named `idle` is optional.
 */
export function extractRig(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]): ActorRig | null {
  const walk = clips.find((c) => c.name.toLowerCase() === "walk") ?? null;
  const idle = clips.find((c) => c.name.toLowerCase() === "idle") ?? null;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  let skinned: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    skinned ??= m;
    // Bind-pose bounds: the posed SkinnedMesh bounds need bone matrices that are not computed yet.
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(part.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
  });
  const height = box.max.y - box.min.y;
  if (!skinned || !walk || !(height > 0)) {
    disposeObject(root, null);
    return null;
  }
  const first = (skinned as THREE.SkinnedMesh).material;
  const mat = Array.isArray(first) ? first[0] : first;
  const map = (mat as Partial<THREE.MeshStandardMaterial> | undefined)?.map ?? null;
  const offset = new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  return { scene: root, walk, idle, map, unit: RIG_HEIGHT_CM / height, offset };
}

/**
 * The static `ActorModel` of a rig: its skinned meshes baked in the idle pose at t = 0 (the walk
 * pose at t = 0 without an idle clip), in cm with the rig's `unit` and `offset`, feet on y = 0 and
 * facing +Z like the static models. Downed bodies draw it, so a falling actor keeps its look.
 * The texture is the rig's `map` (same UVs); the template scene is left untouched.
 */
export function bakeRig(rig: ActorRig): ActorModel {
  const root = cloneSkinned(rig.scene);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(rig.idle ?? rig.walk);
  action.play();
  action.time = 0;
  mixer.update(0);
  root.updateMatrixWorld(true);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  const s = rig.unit;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const g = m.geometry;
    const n = g.getAttribute("position").count;
    const base = pos.length / 3;
    const uvs = g.getAttribute("uv");
    for (let i = 0; i < n; i++) {
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).add(rig.offset);
      pos.push(v.x * s, v.y * s, v.z * s);
      uv.push(uvs ? uvs.getX(i) : 0, uvs ? uvs.getY(i) : 0);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    else for (let i = 0; i < n; i++) idx.push(base + i);
  });
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  root.traverse((o) => (o as THREE.SkinnedMesh).skeleton?.dispose());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const b = geometry.boundingBox!;
  return { geometry, map: rig.map, height: b.max.y - b.min.y, back: Math.max(0, -b.min.z), rig };
}

/** Darkest grey a rig palette texel may have after `liftLevels` (0..1), so role tints stay bright. */
export const RIG_FLOOR = 0.62;

/**
 * Replaces the image of `tex` with a `liftLevels` copy (grey `floor`..1), so the multiplied role
 * tint reads like the light-grey static models. No-op without a DOM canvas (tests) or image.
 */
export function liftTexture(tex: THREE.Texture | null, floor: number = RIG_FLOOR): void {
  const img = tex?.image as CanvasImageSource & { width?: number; height?: number } | undefined;
  if (!tex || !img || typeof document === "undefined") return;
  const w = (img as HTMLImageElement).naturalWidth || img.width || 0;
  const h = (img as HTMLImageElement).naturalHeight || img.height || 0;
  if (!(w > 0 && h > 0)) return;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h);
  liftLevels(px.data, floor);
  ctx.putImageData(px, 0, 0);
  // Release a decoded bitmap (an <img> is freed by GC once unreferenced). The texture is not
  // uploaded yet, so swapping the source data and flagging it re-uploads from the canvas.
  const old = img as Partial<ImageBitmap>;
  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap && typeof old.close === "function") old.close();
  tex.image = canvas;
  tex.needsUpdate = true;
}

/** Disposes every geometry, material and texture under `root` except `keep`. */
function disposeObject(root: THREE.Object3D, keep: THREE.Texture | null): void {
  root.traverse((o) => {
    const m = o as Partial<THREE.Mesh>;
    m.geometry?.dispose();
    const mats = m.material === undefined ? [] : Array.isArray(m.material) ? m.material : [m.material];
    for (const x of mats) {
      for (const v of Object.values(x)) if (v instanceof THREE.Texture && v !== keep) v.dispose();
      x.dispose();
    }
  });
}

/** Disposes the template scene (geometry, materials, textures including `map`). */
export function disposeActorRig(r: ActorRig): void {
  disposeObject(r.scene, null);
}

/**
 * The first mesh under `root`, baked to its world transform, recentred on x/z with its base on
 * y = 0. Everything else from the glTF (other geometries, materials) is disposed; the base colour
 * texture is kept.
 */
export function extractModel(root: THREE.Object3D): ActorModel {
  root.updateMatrixWorld(true);
  let mesh: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error("model has no mesh");
  const found: THREE.Mesh = mesh;
  const geometry = found.geometry.clone();
  geometry.applyMatrix4(found.matrixWorld);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const b = geometry.boundingBox!;
  const first = Array.isArray(found.material) ? found.material[0] : found.material;
  const map = (first as Partial<THREE.MeshStandardMaterial> | undefined)?.map ?? null;
  disposeObject(root, map);
  return { geometry, map, height: b.max.y - b.min.y, back: Math.max(0, -b.min.z) };
}

export function disposeActorModels(m: ActorModels): void {
  for (const x of new Set([m.operator, m.enemy])) {
    x.geometry.dispose();
    x.map?.dispose();
    if (x.rig) disposeActorRig(x.rig);
  }
}

function makeLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  // Embedded images become blob: URLs. The default ImageBitmapLoader fetch()es them, which the CSP
  // (`connect-src 'self'`) blocks; an <img> load is allowed by `img-src blob:`.
  loader.register((parser) => {
    parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
    return { name: "rtr_img_element_textures" };
  });
  return loader;
}

async function loadFirst(loader: GLTFLoader, base: string, files: readonly string[]): Promise<ActorModel> {
  let last: unknown = null;
  for (const f of files) {
    try {
      const gltf = await loader.loadAsync(base + f);
      return extractModel(gltf.scene);
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(`no model loaded from ${files.join(", ")}`);
}

/** The rig in `file`, or null when it is missing or unusable (no warning: rigs are optional). */
async function loadRig(loader: GLTFLoader, base: string, file: string): Promise<ActorRig | null> {
  try {
    const gltf = await loader.loadAsync(base + file);
    return extractRig(gltf.scene, gltf.animations);
  } catch {
    return null;
  }
}

/** A rig as a full model: lifted palette, baked idle geometry for the downs. */
function rigModel(rig: ActorRig): ActorModel {
  liftTexture(rig.map);
  return bakeRig(rig);
}

/**
 * Loads the operator and enemy models from the app's base URL. A role whose rig loads (with a
 * walk clip) uses it for every body, standing and downed; only a role without a usable rig loads
 * its static model (the operator's is then required, the enemy falls back to the operator).
 */
export async function loadActorModels(base: string = import.meta.env.BASE_URL): Promise<ActorModels> {
  const loader = makeLoader();
  const [operatorRig, enemyRig] = await Promise.all([loadRig(loader, base, OPERATOR_RIG_FILE), loadRig(loader, base, ENEMY_RIG_FILE)]);
  let operator: ActorModel;
  try {
    operator = operatorRig ? rigModel(operatorRig) : await loadFirst(loader, base, OPERATOR_FILES);
  } catch (err) {
    if (enemyRig) disposeActorRig(enemyRig);
    throw err;
  }
  if (enemyRig) return { operator, enemy: rigModel(enemyRig) };
  try {
    return { operator, enemy: await loadFirst(loader, base, ENEMY_FILES) };
  } catch {
    // No dedicated enemy model: reuse the operator (tinted red by the layer).
    return { operator, enemy: operator };
  }
}
