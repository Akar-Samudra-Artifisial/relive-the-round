import * as THREE from "three";
import { THEME_NUM } from "../../ui/theme";

export interface RendererLights {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
}

export function createLights(): RendererLights {
  const hemi = new THREE.HemisphereLight(0xffffff, THEME_NUM.bg, 1.6);
  hemi.name = "hemi-light";
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.name = "sun-light";
  return { hemi, sun };
}

export function placeLights(lights: RendererLights, width: number, height: number): void {
  lights.sun.position.set(width * 0.35, Math.max(width, height), height * 1.4);
  lights.sun.target.position.set(width / 2, 0, height / 2);
}