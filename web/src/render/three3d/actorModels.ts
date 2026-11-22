import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
};

export type ActorModels = { readonly operator: ActorModel; readonly enemy: ActorModel };

/** First URL is preferred; the next ones are fallbacks (relative to the Vite base). */
const OPERATOR_FILES = ["models/operator-rifle.glb", "models/operator.glb"];
const ENEMY_FILES = ["models/enemy.glb"];

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
  root.traverse((o) => {
    const m = o as Partial<THREE.Mesh>;
    m.geometry?.dispose();
    const mats = m.material === undefined ? [] : Array.isArray(m.material) ? m.material : [m.material];
    for (const x of mats) {
      for (const v of Object.values(x)) if (v instanceof THREE.Texture && v !== map) v.dispose();
      x.dispose();
    }
  });
  return { geometry, map, height: b.max.y - b.min.y, back: Math.max(0, -b.min.z) };
}

export function disposeActorModels(m: ActorModels): void {
  for (const x of new Set([m.operator, m.enemy])) {
    x.geometry.dispose();
    x.map?.dispose();
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

/** Loads the operator and enemy models from the app's base URL. */
export async function loadActorModels(base: string = import.meta.env.BASE_URL): Promise<ActorModels> {
  const loader = makeLoader();
  const operator = await loadFirst(loader, base, OPERATOR_FILES);
  try {
    const enemy = await loadFirst(loader, base, ENEMY_FILES);
    return { operator, enemy };
  } catch {
    // No dedicated enemy model: reuse the operator (tinted red by the layer).
    return { operator, enemy: operator };
  }
}
