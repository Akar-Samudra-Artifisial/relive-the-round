import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { KILN } from "../src/maps/kiln";
import { ATTACK_TINT, DEFENSE_TINT, FLOOR, WALL_FILL } from "../src/render/palette";
import { createLights, placeLights } from "../src/render/three3d/lights";
import { buildMapScene, disposeMapScene, type LabelStyle, WALL_HEIGHT } from "../src/render/three3d/mapScene";
import { polygonCentroid } from "../src/sim/geom";
import { THEME_NUM } from "../src/ui/theme";

const map = KILN;

function byName<T extends THREE.Object3D>(root: THREE.Object3D, name: string): T {
  const o = root.getObjectByName(name);
  if (!o) throw new Error(`missing ${name}`);
  return o as T;
}

function all<T extends THREE.Object3D>(root: THREE.Object3D, name: string): T[] {
  const out: T[] = [];
  root.traverse((o) => {
    if (o.name === name) out.push(o as T);
  });
  return out;
}

function bbox(o: THREE.Mesh | THREE.LineSegments): THREE.Box3 {
  o.geometry.computeBoundingBox();
  return o.geometry.boundingBox!;
}

type Mat = THREE.Material & { color: THREE.Color };
const mat = (o: THREE.Object3D): Mat => (o as THREE.Mesh).material as Mat;

describe("3D map scene", () => {
  const scene = buildMapScene(map);

  it("is a group named map", () => {
    expect(scene.name).toBe("map");
  });

  it("floor covers exactly [0, width] x [0, height] at Y = 0", () => {
    const b = bbox(byName<THREE.Mesh>(scene, "floor"));
    expect(b.min.x).toBeCloseTo(0, 6);
    expect(b.max.x).toBeCloseTo(map.width, 6);
    expect(b.min.z).toBeCloseTo(0, 6);
    expect(b.max.z).toBeCloseTo(map.height, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(0, 6);
  });

  it("has one wall mesh per wall polygon, from Y = 0 to WALL_HEIGHT", () => {
    const walls = all<THREE.Mesh>(scene, "wall");
    expect(walls).toHaveLength(map.walls.length);
    expect(all(scene, "wall-edges")).toHaveLength(map.walls.length);
    const box = new THREE.Box3();
    for (const w of walls) box.union(bbox(w));
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(WALL_HEIGHT, 3);
  });

  it("maps world (x, y) to (x, *, y), not mirrored, for every wall vertex", () => {
    const walls = all<THREE.Mesh>(scene, "wall");
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
    map.walls.forEach((poly, i) => {
      const pos = walls[i]!.geometry.getAttribute("position");
      const pts: [number, number][] = [];
      for (let j = 0; j + 1 < poly.length; j += 2) pts.push([poly[j]!, poly[j + 1]!]);
      const isPoint = (x: number, z: number): boolean => pts.some(([px, py]) => near(px, x) && near(py, z));
      for (const [x, y] of pts) {
        let hit = false;
        let mirrored = false;
        for (let k = 0; k < pos.count; k++) {
          if (!near(pos.getX(k), x)) continue;
          if (near(pos.getZ(k), y)) hit = true;
          else if (near(pos.getZ(k), -y) && !isPoint(x, -y)) mirrored = true;
        }
        expect(hit, `wall ${i} vertex (${x}, ${y})`).toBe(true);
        expect(mirrored, `wall ${i} vertex (${x}, ${y}) mirrored`).toBe(false);
      }
      for (let k = 0; k < pos.count; k++) {
        expect(isPoint(pos.getX(k), pos.getZ(k)), `wall ${i} geometry vertex ${k}`).toBe(true);
      }
    });
    // Every wall stays inside the map footprint on X/Z.
    const box = new THREE.Box3();
    for (const w of all<THREE.Mesh>(scene, "wall")) box.union(bbox(w));
    expect(box.min.x).toBeGreaterThanOrEqual(-1e-3);
    expect(box.min.z).toBeGreaterThanOrEqual(-1e-3);
    expect(box.max.x).toBeLessThanOrEqual(map.width + 1e-3);
    expect(box.max.z).toBeLessThanOrEqual(map.height + 1e-3);
  });

  it("zone fills sit at Y = 2 over their polygon", () => {
    const b = bbox(byName<THREE.Mesh>(scene, "site-A-fill"));
    const xs = map.sites.A.filter((_, i) => i % 2 === 0);
    const ys = map.sites.A.filter((_, i) => i % 2 === 1);
    expect(b.min.y).toBeCloseTo(2, 6);
    expect(b.max.y).toBeCloseTo(2, 6);
    expect(b.min.x).toBeCloseTo(Math.min(...xs), 3);
    expect(b.max.x).toBeCloseTo(Math.max(...xs), 3);
    expect(b.min.z).toBeCloseTo(Math.min(...ys), 3);
    expect(b.max.z).toBeCloseTo(Math.max(...ys), 3);
  });

  it("uses the 2D palette colours and alphas", () => {
    const expectMat = (name: string, color: number, opacity?: number) => {
      const m = mat(byName(scene, name));
      expect(m.color.getHex(), name).toBe(color);
      if (opacity !== undefined) {
        expect(m.opacity, name).toBeCloseTo(opacity, 6);
        expect(m.transparent, name).toBe(true);
        expect(m.depthWrite, name).toBe(false);
      }
    };
    expectMat("floor", FLOOR);
    expectMat("wall", WALL_FILL);
    expectMat("wall-edges", THEME_NUM.cyan, 0.55);
    expectMat("grid-minor", THEME_NUM.line, 0.45);
    expectMat("grid-major", THEME_NUM.lineHi, 0.4);
    expectMat("spawn-attack-fill", ATTACK_TINT, 0.07);
    expectMat("spawn-defense-fill", DEFENSE_TINT, 0.07);
    expectMat("spawn-attack-outline", ATTACK_TINT, 0.45);
    expectMat("spawn-defense-outline", DEFENSE_TINT, 0.45);
    for (const s of Object.keys(map.sites)) {
      expectMat(`site-${s}-fill`, THEME_NUM.amber, 0.08);
      expectMat(`site-${s}-outline`, THEME_NUM.amber, 0.5);
      expectMat(`site-${s}-brackets`, THEME_NUM.amber, 0.9);
    }
    expect(mat(byName(scene, "wall"))).toBeInstanceOf(THREE.MeshLambertMaterial);
  });

  it("does not own renderer lights", () => {
    expect(all(scene, "hemi-light")).toHaveLength(0);
    expect(all(scene, "sun-light")).toHaveLength(0);
  });

  it("creates renderer lights at the map-relative positions", () => {
    const lights = createLights();
    placeLights(lights, map.width, map.height);
    expect(lights.hemi).toBeInstanceOf(THREE.HemisphereLight);
    expect(lights.hemi.name).toBe("hemi-light");
    expect(lights.hemi.intensity).toBe(1.6);
    expect(lights.sun).toBeInstanceOf(THREE.DirectionalLight);
    expect(lights.sun.name).toBe("sun-light");
    expect(lights.sun.intensity).toBe(1.2);
    expect(lights.sun.position.toArray()).toEqual([map.width * 0.35, Math.max(map.width, map.height), map.height * 1.4]);
    expect(lights.sun.target.position.toArray()).toEqual([map.width / 2, 0, map.height / 2]);
  });

  it("adds no labels without a factory", () => {
    let labels = 0;
    scene.traverse((o) => {
      if (o.name.startsWith("label-")) labels++;
    });
    expect(labels).toBe(0);
  });

  it("places injected labels flat at the polygon centroids above the zones", () => {
    const calls: [string, LabelStyle][] = [];
    const s = buildMapScene(map, {
      makeLabel: (text, style) => {
        calls.push([text, style]);
        return new THREE.Object3D();
      },
    });
    const sites = Object.keys(map.sites);
    expect(calls.map((c) => c[0])).toEqual([...sites, "ATK SPAWN", "DEF SPAWN"]);
    const check = (name: string, poly: readonly number[]) => {
      const o = byName(s, name);
      const c = polygonCentroid(poly);
      expect(o.position.x).toBeCloseTo(c.x, 6);
      expect(o.position.z).toBeCloseTo(c.y, 6);
      expect(o.position.y).toBeGreaterThan(2);
      // Text up (+Y of the label plane) points to -Z (screen up).
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(o.quaternion);
      expect(up.z).toBeCloseTo(-1, 6);
    };
    for (const k of sites) check(`label-site-${k}`, map.sites[k as keyof typeof map.sites]);
    check("label-attack", map.spawns.attack);
    check("label-defense", map.spawns.defense);
    expect(calls[sites.length]![1].color).toBe(ATTACK_TINT);
    expect(calls[sites.length]![1].alpha).toBeCloseTo(0.7, 6);
    expect(calls[0]![1].alpha).toBeCloseTo(0.55, 6);
    disposeMapScene(s);
  });

  it("disposeMapScene disposes every geometry, material and texture", () => {
    const tex = new THREE.Texture();
    const s = buildMapScene(map, {
      makeLabel: () => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex })),
    });
    const spies: ReturnType<typeof vi.spyOn>[] = [];
    s.traverse((o) => {
      const node = o as Partial<THREE.Mesh>;
      if (node.geometry) spies.push(vi.spyOn(node.geometry, "dispose"));
      if (node.material) spies.push(vi.spyOn(node.material as THREE.Material, "dispose"));
    });
    const texSpy = vi.spyOn(tex, "dispose");
    expect(spies.length).toBeGreaterThan(map.walls.length * 2);
    disposeMapScene(s);
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(texSpy).toHaveBeenCalled();
  });
});
