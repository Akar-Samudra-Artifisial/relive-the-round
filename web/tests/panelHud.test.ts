import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { PanelSpec } from "../src/render/renderer";
import { PanelHud } from "../src/render/three3d/panelHud";

const specs: PanelSpec[] = [
  { x: 0, y: 0, size: 600, title: "YOU", note: "your round", accent: 0x00ffff },
  { x: 616, y: 0, size: 600, title: "PRO", note: "rebuilt from event data", accent: 0xffaa00 },
];

function countNamed(scene: THREE.Scene, name: string): number {
  let count = 0;
  scene.traverse((object) => {
    if (object.name === name) count++;
  });
  return count;
}

describe("PanelHud", () => {
  it("builds one header plate and text texture per titled panel", () => {
    const textures = [new THREE.Texture(), new THREE.Texture()];
    let textureIndex = 0;
    const factory = vi.fn((_spec: PanelSpec, _pixelRatio: number) => textures[textureIndex++]!);
    const hud = new PanelHud(factory);
    hud.rebuild(specs, 1280, 800, 2);

    expect(hud.isEmpty).toBe(false);
    expect(countNamed(hud.scene, "panel-hud-plate")).toBe(2);
    expect(countNamed(hud.scene, "panel-hud-text")).toBe(2);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenNthCalledWith(1, specs[0], 2);
    expect(factory).toHaveBeenNthCalledWith(2, specs[1], 2);
    const textMaps: THREE.Texture[] = [];
    hud.scene.traverse((object) => {
      if (object.name !== "panel-hud-text") return;
      const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
      textMaps.push(mesh.material.map!);
    });
    expect(textMaps).toEqual(textures);
    hud.dispose();
  });

  it("does not build anything for untitled panels", () => {
    const factory = vi.fn(() => null);
    const hud = new PanelHud(factory);
    hud.rebuild([{ x: 0, y: 0, size: 500 }], 500, 532, 1);
    expect(hud.isEmpty).toBe(true);
    expect(hud.scene.children).toHaveLength(0);
    expect(factory).not.toHaveBeenCalled();
  });

  it("disposes geometries, materials and textures when rebuilding", () => {
    const textures = [new THREE.Texture(), new THREE.Texture()];
    let textureIndex = 0;
    const hud = new PanelHud(() => textures[textureIndex++]!);
    hud.rebuild(specs, 1280, 800, 1);
    const resources = new Set<{ dispose: () => void }>();
    hud.scene.traverse((object) => {
      const node = object as Partial<THREE.Mesh>;
      if (node.geometry) resources.add(node.geometry);
      const material = node.material as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
      if (material) {
        resources.add(material);
        if (material.map) resources.add(material.map);
      }
    });
    const disposeSpies = [...resources].map((resource) => vi.spyOn(resource, "dispose"));
    expect(disposeSpies.length).toBeGreaterThan(10);

    hud.rebuild([{ x: 0, y: 0, size: 500, title: "LIVE" }], 500, 532, 1);
    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledOnce();
    hud.dispose();
  });
});