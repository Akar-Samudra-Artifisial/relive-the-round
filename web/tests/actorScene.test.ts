import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { ENEMY_COLOR, ENEMY_R, ENEMY_TRACER, PLAYER_COLOR, PLAYER_TRACER } from "../src/render/actorStyle";
import type { FrameView, TracerView } from "../src/render/renderer";
import { ActorLayer, TRACER_Y } from "../src/render/three3d/actorScene";
import { DEFUSE_RADIUS } from "../src/sim/constants";
import type { ShotEvent } from "../src/sim/sim";
import { THEME_NUM } from "../src/ui/theme";

type BasicMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

function shown(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (!n.visible) return false;
    if (n === root) return true;
  }
  return true;
}

function named(layer: ActorLayer, name: string, onlyShown = true): BasicMesh[] {
  const out: BasicMesh[] = [];
  layer.group.traverse((o) => {
    if (o.name === name && (!onlyShown || shown(o, layer.group))) out.push(o as BasicMesh);
  });
  return out;
}

function one(layer: ActorLayer, name: string): BasicMesh {
  const all = named(layer, name);
  expect(all, name).toHaveLength(1);
  return all[0]!;
}

function worldPos(o: THREE.Object3D, local = new THREE.Vector3()): THREE.Vector3 {
  o.updateWorldMatrix(true, false);
  return o.localToWorld(local.clone());
}

/** Direction of local +X under the object's world rotation (independent of camMath). */
function forward(o: THREE.Object3D): THREE.Vector3 {
  o.updateWorldMatrix(true, false);
  return new THREE.Vector3(1, 0, 0).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
}

const shot = (by: string, from: [number, number], to: [number, number], hit: string | null): ShotEvent =>
  ({ by, from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] }, hit }) as ShotEvent;

const base: FrameView = {
  player: { x: 1000, y: 2000, aim: { x: 1000, y: 3000 } },
  enemies: [
    { x: 3000, y: 1000, fx: 0, fy: 1, z: 0 },
    { x: 3500, y: 1200, fx: 1, fy: 0, z: 1 },
  ],
  downs: [
    { x: 4000, y: 500, side: "enemy", z: 2 },
    { x: 4200, y: 700, side: "player", z: 3 },
  ],
  spike: { x: 5000, y: 5000, defuse: 0.5, pulseT: 0.6 },
  tracers: [
    { shot: shot("P0", [1000, 2000], [3000, 1000], "E1"), fade: 0.4 },
    { shot: shot("E2", [3500, 1200], [1000, 2000], null), fade: 1 },
    { shot: shot("P0", [1000, 2000], [1500, 2500], null), fade: -0.5 },
  ],
};

describe("ActorLayer", () => {
  it("is a group named actors and shows one mesh set per frame item", () => {
    const layer = new ActorLayer();
    expect(layer.group.name).toBe("actors");
    layer.update(base, 0);
    expect(named(layer, "player-body")).toHaveLength(1);
    expect(named(layer, "enemy-body")).toHaveLength(2);
    expect(named(layer, "down-ring")).toHaveLength(2);
    expect(named(layer, "down-x")).toHaveLength(2);
    expect(named(layer, "tracer-core")).toHaveLength(3);
    expect(named(layer, "tracer-halo")).toHaveLength(3);
    expect(named(layer, "spike-zone")).toHaveLength(1);
    expect(named(layer, "spike-diamond")).toHaveLength(1);
    layer.update({ ...base, player: null, enemies: [], downs: [], spike: null, tracers: [] }, 0);
    for (const n of ["player-body", "enemy-body", "down-ring", "tracer-core", "spike-zone"]) expect(named(layer, n), n).toHaveLength(0);
  });

  it("maps world (x, y) to (x, *, y)", () => {
    const layer = new ActorLayer();
    layer.update(base, 0);
    const xz = (o: THREE.Object3D): [number, number] => {
      const p = worldPos(o);
      return [Math.round(p.x), Math.round(p.z)];
    };
    expect(xz(one(layer, "player-body"))).toEqual([1000, 2000]);
    expect(named(layer, "enemy-body").map(xz)).toEqual([[3000, 1000], [3500, 1200]]);
    expect(named(layer, "down-ring").map(xz)).toEqual([[4000, 500], [4200, 700]]);
    expect(xz(one(layer, "spike-zone"))).toEqual([5000, 5000]);
    const core = named(layer, "tracer-core")[0]!;
    expect(xz(core)).toEqual([1000, 2000]);
    expect(worldPos(core).y).toBeCloseTo(TRACER_Y, 6);
    // The far end of the unit box lands on shot.to.
    const end = worldPos(core, new THREE.Vector3(1, 0, 0));
    expect(end.x).toBeCloseTo(3000, 3);
    expect(end.z).toBeCloseTo(1000, 3);
    const hit = named(layer, "tracer-hit-inner")[0]!;
    expect(xz(hit)).toEqual([3000, 1000]);
  });

  it("points a facing (0, 1) at +Z and (1, 0) at +X", () => {
    const layer = new ActorLayer();
    layer.update(base, 0);
    const [cone0, cone1] = named(layer, "enemy-cone");
    const f0 = forward(cone0!);
    expect(f0.x).toBeCloseTo(0, 6);
    expect(f0.z).toBeCloseTo(1, 6);
    const f1 = forward(cone1!);
    expect(f1.x).toBeCloseTo(1, 6);
    expect(f1.z).toBeCloseTo(0, 6);
    const tick = named(layer, "enemy-tick")[0]!;
    const tip = worldPos(tick, new THREE.Vector3(1, 0, 0));
    expect(tip.x).toBeCloseTo(3000, 3);
    expect(tip.z).toBeCloseTo(1000 + ENEMY_R + 110, 3);
    // Player aims at world +y (0, 1) -> +Z; then at (1, 0) -> +X; then up (0, -1) -> -Z.
    expect(forward(one(layer, "player-aim-cone")).z).toBeCloseTo(1, 6);
    layer.update({ ...base, player: { x: 1000, y: 2000, aim: { x: 1600, y: 2000 } } }, 0);
    expect(forward(one(layer, "player-aim-line")).x).toBeCloseTo(1, 6);
    expect(forward(one(layer, "player-nose")).x).toBeCloseTo(1, 6);
    layer.update({ ...base, player: { x: 1000, y: 2000, aim: { x: 1000, y: 1000 } } }, 0);
    expect(forward(one(layer, "player-aim-cone")).z).toBeCloseTo(-1, 6);
  });

  it("hides the enemy cone and tick without a facing, and the aim without a direction", () => {
    const layer = new ActorLayer();
    layer.update({ ...base, enemies: [{ x: 1, y: 2, fx: 0, fy: 0 }, { x: 3, y: 4 }] }, 0);
    expect(named(layer, "enemy-body")).toHaveLength(2);
    expect(named(layer, "enemy-cone")).toHaveLength(0);
    expect(named(layer, "enemy-tick")).toHaveLength(0);
    for (const aim of [null, { x: 1050, y: 2050 }]) {
      layer.update({ ...base, player: { x: 1000, y: 2000, aim } }, 0);
      expect(named(layer, "player-body")).toHaveLength(1);
      expect(named(layer, "player-glow")).toHaveLength(1);
      for (const n of ["player-aim-cone", "player-aim-line", "player-nose"]) expect(named(layer, n), n).toHaveLength(0);
    }
  });

  it("fades tracers with the clamped fade and flags hits only when the shot hit", () => {
    const layer = new ActorLayer();
    layer.update(base, 0);
    const cores = named(layer, "tracer-core");
    const halos = named(layer, "tracer-halo");
    const expected = base.tracers.map((t) => Math.max(0, Math.min(1, t.fade)));
    expected.forEach((a, i) => {
      expect(cores[i]!.material.opacity).toBeCloseTo(0.9 * a, 6);
      expect(halos[i]!.material.opacity).toBeCloseTo(0.14 * a, 6);
    });
    expect(cores.map((c) => c.material.color.getHex())).toEqual([PLAYER_TRACER, ENEMY_TRACER, PLAYER_TRACER]);
    expect(named(layer, "tracer-hit-outer")).toHaveLength(1);
    const inner = one(layer, "tracer-hit-inner");
    expect(inner.material.opacity).toBeCloseTo(0.75 * 0.4, 6);
    expect(inner.material.color.getHex()).toBe(PLAYER_TRACER);
    expect(one(layer, "tracer-hit-outer").material.opacity).toBeCloseTo(0.18 * 0.4, 6);
  });

  it("colours downs by side", () => {
    const layer = new ActorLayer();
    layer.update(base, 0);
    expect(named(layer, "down-ring").map((m) => m.material.color.getHex())).toEqual([ENEMY_COLOR, PLAYER_COLOR]);
    expect(named(layer, "down-x").map((m) => m.material.color.getHex())).toEqual([ENEMY_COLOR, PLAYER_COLOR]);
  });

  it("draws spike progress from 12 o'clock clockwise via drawRange", () => {
    const layer = new ActorLayer();
    layer.update(base, 0);
    const own = one(layer, "spike-progress-own");
    expect(own.material.color.getHex()).toBe(THEME_NUM.green);
    expect(named(layer, "spike-progress-enemy")).toHaveLength(0);
    expect(named(layer, "spike-track")).toHaveLength(1);
    const geo = own.geometry;
    const index = geo.getIndex()!;
    expect(geo.drawRange.count).toBe(index.count / 2);
    // Theta indices used by the drawn range: 0..32 of 64 (row length 65).
    const pos = geo.getAttribute("position");
    const used: number[] = [];
    for (let i = 0; i < geo.drawRange.count; i++) used.push(index.getX(i) % 65);
    expect(Math.min(...used)).toBe(0);
    expect(Math.max(...used)).toBe(32);
    let prev = -Infinity;
    for (let k = 0; k <= 32; k++) {
      expect(pos.getY(k)).toBeCloseTo(0, 6);
      const ang = Math.atan2(pos.getZ(k), pos.getX(k));
      if (k === 0) expect(ang).toBeCloseTo(-Math.PI / 2, 6); // world -y = 12 o'clock
      expect(ang).toBeGreaterThan(prev);
      prev = ang;
    }
    // A quarter turn later the arc is at world +x (3 o'clock on screen): clockwise.
    expect(pos.getX(16)).toBeGreaterThan(0);
    expect(pos.getZ(16)).toBeCloseTo(0, 3);

    layer.update({ ...base, spike: { x: 5000, y: 5000, defuse: 0, enemyDefuse: 0.25, pulseT: null } }, 0);
    expect(named(layer, "spike-progress-own")).toHaveLength(0);
    const enemy = one(layer, "spike-progress-enemy");
    expect(enemy.material.color.getHex()).toBe(THEME_NUM.red);
    expect(enemy.geometry.drawRange.count).toBe(6 * 16);

    layer.update({ ...base, spike: { x: 5000, y: 5000, defuse: 0, pulseT: null } }, 0);
    for (const n of ["spike-track", "spike-progress-own", "spike-progress-enemy"]) expect(named(layer, n), n).toHaveLength(0);
  });

  it("pulses the spike ring from pulseT and keeps it still without it", () => {
    const layer = new ActorLayer();
    layer.update(base, 0);
    const pulse = one(layer, "spike-pulse");
    expect(named(layer, "spike-still")).toHaveLength(0);
    const k = (0.6 % 1.2) / 1.2;
    const r = DEFUSE_RADIUS + 420 * k;
    const pos = pulse.geometry.getAttribute("position");
    expect(Math.hypot(pos.getX(0), pos.getZ(0))).toBeCloseTo(r - 8, 3);
    expect(Math.hypot(pos.getX(65 + 10), pos.getZ(65 + 10))).toBeCloseTo(r + 8, 3);
    expect(pulse.material.opacity).toBeCloseTo(0.45 * (1 - k), 6);
    layer.update({ ...base, spike: { ...base.spike!, pulseT: null } }, 0);
    expect(named(layer, "spike-pulse")).toHaveLength(0);
    expect(named(layer, "spike-still")).toHaveLength(1);
  });

  it("layers ground decals above the map and depth-tests bodies normally", () => {
    const layer = new ActorLayer();
    layer.update(base, 0);
    const decals = [
      "player-glow", "player-aim-cone", "player-aim-line", "player-nose",
      "enemy-glow", "enemy-cone", "enemy-tick", "down-ring", "down-x",
      "spike-zone", "spike-outline", "spike-pulse", "spike-track", "spike-progress-own",
    ];
    for (const n of decals) {
      for (const m of named(layer, n)) {
        const y = worldPos(m).y;
        expect(y, n).toBeGreaterThanOrEqual(4);
        expect(y, n).toBeLessThanOrEqual(6);
        expect(m.material.transparent, n).toBe(true);
        expect(m.material.depthWrite, n).toBe(false);
        expect(m.material.depthTest, n).toBe(true);
        expect(m.renderOrder, n).toBeGreaterThan(5);
      }
    }
    for (const n of ["player-body", "enemy-body", "spike-diamond"]) {
      for (const m of named(layer, n)) {
        expect(m.material, n).toBeInstanceOf(THREE.MeshLambertMaterial);
        expect(m.material.depthTest, n).toBe(true);
        expect(m.material.depthWrite, n).toBe(true);
      }
    }
    for (const m of named(layer, "tracer-core")) {
      expect(m.material.depthTest).toBe(true);
      expect(m.renderOrder).toBeGreaterThan(5);
    }
  });

  it("update(null) hides everything", () => {
    const layer = new ActorLayer();
    layer.update(base, 0);
    layer.update(null, 0);
    let visible = 0;
    layer.group.traverse((o) => {
      if ((o instanceof THREE.Mesh || o instanceof THREE.LineSegments) && shown(o, layer.group)) visible++;
    });
    expect(visible).toBe(0);
  });

  it("allocates no geometry or material across 50 updates within the pool sizes", () => {
    const layer = new ActorLayer();
    layer.update(base, 0);
    const resources = (): Set<string> => {
      const s = new Set<string>();
      layer.group.traverse((o) => {
        const n = o as Partial<THREE.Mesh>;
        if (n.geometry) s.add(n.geometry.uuid);
        if (n.material) s.add((n.material as THREE.Material).uuid);
      });
      return s;
    };
    const before = resources();
    const g0 = new THREE.BufferGeometry();
    const m0 = new THREE.MeshBasicMaterial();
    for (let i = 0; i < 50; i++) {
      const tracers: TracerView[] = [];
      for (let k = 0; k < i % 24; k++) tracers.push({ shot: shot(k % 2 ? "P0" : "E1", [k * 10, 0], [k * 10 + 500, 300], k % 3 ? null : "E1"), fade: (i % 7) / 5 });
      layer.update(
        {
          player: i % 9 === 0 ? null : { x: 100 + i, y: 200, aim: i % 2 ? { x: 900, y: 900 + i } : null },
          enemies: base.enemies.slice(0, i % 3).concat(i % 4 ? [{ x: i, y: i, fx: 0.6, fy: -0.8 }] : []),
          downs: base.downs.slice(0, i % 3),
          spike: i % 5 === 0 ? null : { x: 5000, y: 5000, defuse: (i % 4) / 4, enemyDefuse: (i % 3) / 3, pulseT: i % 2 ? i * 0.1 : null },
          tracers,
        },
        i * 16,
      );
    }
    const g1 = new THREE.BufferGeometry();
    const m1 = new THREE.MeshBasicMaterial();
    expect(g1.id - g0.id).toBe(1);
    expect(m1.id - m0.id).toBe(1);
    expect(resources()).toEqual(before);
    [g0, g1, m0, m1].forEach((x) => x.dispose());
  });

  it("grows a pool past its size without errors", () => {
    const layer = new ActorLayer();
    const tracers: TracerView[] = Array.from({ length: 30 }, (_, k) => ({ shot: shot("P0", [k, 0], [k, 500], null), fade: 1 }));
    layer.update({ ...base, tracers }, 0);
    expect(named(layer, "tracer-core")).toHaveLength(30);
    layer.update(base, 0);
    expect(named(layer, "tracer-core")).toHaveLength(3);
  });

  it("dispose() disposes every geometry and material in the group", () => {
    const layer = new ActorLayer();
    layer.update(base, 0);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    layer.group.traverse((o) => {
      const n = o as Partial<THREE.Mesh>;
      if (n.geometry) geos.add(n.geometry);
      if (n.material) mats.add(n.material as THREE.Material);
    });
    // Down slots swap between per-side materials; make sure both sides are covered.
    layer.update({ ...base, downs: [{ x: 0, y: 0, side: "player" }, { x: 0, y: 0, side: "enemy" }] }, 0);
    layer.group.traverse((o) => {
      const n = o as Partial<THREE.Mesh>;
      if (n.material) mats.add(n.material as THREE.Material);
    });
    const spies = [...geos, ...mats].map((x) => vi.spyOn(x, "dispose"));
    expect(spies.length).toBeGreaterThan(20);
    layer.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});
