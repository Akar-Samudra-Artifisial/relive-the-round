import * as THREE from "three";
import { THEME_NUM } from "../../ui/theme";

export interface RendererLights {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
}

/** Shadow map size (texels per side) on the high tier. */
export const SHADOW_MAP_SIZE = 2048;
/** Extra room (cm) around the map in the shadow camera, for wall tops and bodies near the edge. */
const SHADOW_MARGIN = 400;

export function createLights(): RendererLights {
  const hemi = new THREE.HemisphereLight(0xffffff, THEME_NUM.bg, 1.6);
  hemi.name = "hemi-light";
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.name = "sun-light";
  // Only the floor shadow plane receives shadows (walls and bodies never do), so there is no
  // self-shadowing acne; a small bias keeps the contact edge clean.
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0;
  sun.shadow.radius = 3;
  return { hemi, sun };
}

/**
 * Places the sun relative to the map and fits its orthographic shadow camera around the map:
 * a box of the map's half diagonal (plus a margin) on each side of the light axis.
 */
export function placeLights(lights: RendererLights, width: number, height: number): void {
  const { sun } = lights;
  sun.position.set(width * 0.35, Math.max(width, height), height * 1.4);
  sun.target.position.set(width / 2, 0, height / 2);
  sun.target.updateMatrixWorld();
  const radius = Math.hypot(width, height) / 2 + SHADOW_MARGIN;
  const distance = sun.position.distanceTo(sun.target.position);
  const cam = sun.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = Math.max(1, distance - radius);
  cam.far = distance + radius;
  cam.updateProjectionMatrix();
}
