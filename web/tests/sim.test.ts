import { describe, expect, it } from "vitest";
import { SYNTHETIC_1V3 } from "../src/level/fixtures/synthetic-1v3";
import { parseLevel } from "../src/level/loader";
import { KILN } from "../src/maps/kiln";
import { NAV_CELL, NAV_CLEARANCE, RUN_SPEED } from "../src/sim/constants";
import { pointInPolygon, type Vec2 } from "../src/sim/geom";
import { hashState } from "../src/sim/hash";
import { buildNavGrid, findPath, isWalkable, snap } from "../src/sim/nav";
import { buildRail, railPosition } from "../src/sim/rail";
import { nextU32, seedRng } from "../src/sim/rng";
import { initState, step, type Input } from "../src/sim/sim";
import { buildWarp, warpUV } from "../src/sim/warp";
import { buildWorld } from "../src/sim/world";

const nav = buildNavGrid(KILN, NAV_CELL, NAV_CLEARANCE);
const warp = buildWarp(KILN.landmarks);
const world = buildWorld(KILN, SYNTHETIC_1V3);

function insideWall(p: Vec2): boolean {
  return KILN.walls.some((w) => pointInPolygon(p.x, p.y, w));
}

/** Every point along the polyline (5 cm steps) is outside all wall polygons. */
function polylineClear(path: readonly Vec2[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / 5));
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      if (insideWall({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })) return false;
    }
  }
  return true;
}

function inputSequence(n: number): Input[] {
  // Fixed scripted input pattern (no randomness).
  const dirs = [
    { x: 0, y: -1 },
    { x: -1, y: -1 },
    { x: -1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 0 },
  ];
  return Array.from({ length: n }, (_, i) => ({
    move: dirs[Math.floor(i / 37) % dirs.length]!,
    aim: { x: 1600, y: 2200 },
    fire: i % 11 === 0,
    use: false,
  }));
}

function run(seed: number, inputs: readonly Input[]): string {
  let s = initState(world, seed);
  for (const inp of inputs) s = step(world, s, inp);
  expect(s.tick).toBeGreaterThan(0);
  return hashState(s);
}

// History: "65028a0f" → "77aeb1e0" when Kiln landmarks were calibrated (rails go through the
// warp). → "50264f3b" in week 3: Input gained aim/fire/use, state gained combat/bot-FSM/outcome
// fields and the hash now covers the whole state (JSON form), so the same run hashes differently.
// → "470ecce0" in the M3 fix round: enemy HP floor 100, rebalanced weapons, bot grace period,
// hit reactions, simultaneous resolution, defuse mode + defuseTicks field on bots.
const GOLDEN_HASH_SEED1234_900 = "470ecce0";

describe("determinism", () => {
  const inputs = inputSequence(900);

  it("same seed + inputs → identical hash after 900 ticks", () => {
    const h1 = run(1234, inputs);
    const h2 = run(1234, inputs);
    expect(h1).toBe(h2);
  });

  it("matches the golden hash (guards cross-process/platform drift)", () => {
    // Update only for an intentional sim/fixture change, and say why in the commit.
    expect(run(1234, inputs)).toBe(GOLDEN_HASH_SEED1234_900);
  });

  it("different seed → different hash", () => {
    expect(run(1234, inputs)).not.toBe(run(4321, inputs));
  });

  it("rng is a pure function of its state", () => {
    const a = seedRng(7);
    expect(nextU32(a)).toEqual(nextU32(a));
  });

  it("sim sources use no DOM/Pixi/Math.random/Date", () => {
    const sources = import.meta.glob("../src/sim/*.ts", { query: "?raw", import: "default", eager: true });
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(5);
    for (const [file, src] of files) {
      expect(String(src), file).not.toMatch(/Math\.random|\bDate\b|performance\.now|\bwindow\b|\bdocument\b|pixi/);
    }
  });
});

describe("nav A*", () => {
  it("finds a wall-free path between attacker spawn and C site", () => {
    const a = { x: 4000, y: 7200 };
    const b = { x: 6500, y: 2400 };
    expect(isWalkable(nav, a)).toBe(true);
    expect(isWalkable(nav, b)).toBe(true);
    const path = findPath(nav, a, b);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);
    expect(polylineClear(path!)).toBe(true);
    // Straight line crosses walls, so the path must detour.
    expect(polylineClear([a, b])).toBe(false);
  });

  it("all walkable cell centers are outside walls", () => {
    for (let i = 0; i < nav.walkable.length; i++) {
      if (nav.walkable[i] !== 1) continue;
      const c = i % nav.cols;
      const r = (i - c) / nav.cols;
      expect(insideWall({ x: (c + 0.5) * nav.cell, y: (r + 0.5) * nav.cell })).toBe(false);
    }
  });

  it("snaps a point inside a wall to a walkable cell", () => {
    const p = snap(nav, { x: 2900, y: 2000 });
    expect(isWalkable(nav, p)).toBe(true);
  });
});

describe("rail", () => {
  // Enemies and the clutcher (P0) both get rails; P0's dense track is the clutcher replay/ghost path.
  for (const actor of [...SYNTHETIC_1V3.enemies, SYNTHETIC_1V3.clutcher]) {
    it(`${actor.id}: respects run speed, passes through snapped samples, stays clear of walls`, () => {
      const rail = buildRail(actor.samples, warp, nav, RUN_SPEED, actor.diedT);
      expect(rail.anchors).toHaveLength(actor.samples.length);
      for (let i = 1; i < rail.keys.length; i++) {
        const a = rail.keys[i - 1]!;
        const b = rail.keys[i]!;
        const dt = b.t - a.t;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        expect(dt).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(RUN_SPEED * dt + 1e-6);
      }
      for (const anchor of rail.anchors) {
        expect(rail.keys.some((k) => k.x === anchor.x && k.y === anchor.y)).toBe(true);
      }
      expect(polylineClear(rail.keys)).toBe(true);
      // Sampled per-tick displacement also never exceeds speed.
      const t0 = rail.keys[0]!.t;
      let prev = railPosition(rail, t0);
      for (let t = t0 + 1 / 30; t <= rail.endT; t += 1 / 30) {
        const p = railPosition(rail, t);
        expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThanOrEqual(RUN_SPEED / 30 + 1e-6);
        prev = p;
      }
    });
  }

  it("lags instead of teleporting when data moves too fast", () => {
    const rail = buildRail(
      [
        { t: 0, u: 0.5, v: 0.9 },
        { t: 0.5, u: 0.8, v: 0.28 },
      ],
      warp,
      nav,
      RUN_SPEED,
    );
    const last = rail.keys[rail.keys.length - 1]!;
    expect(last.t).toBeGreaterThan(5);
  });

  it("world clutcher rail matches a rail built from the clutcher samples", () => {
    const c = SYNTHETIC_1V3.clutcher;
    expect(world.clutcherRail).toEqual(buildRail(c.samples, warp, nav, RUN_SPEED, c.diedT));
  });
});

describe("warp", () => {
  it("maps every landmark exactly onto its target", () => {
    for (const l of KILN.landmarks) {
      const p = warpUV(warp, l.src[0], l.src[1]);
      expect(p.x, l.name).toBeCloseTo(l.dst[0], 6);
      expect(p.y, l.name).toBeCloseTo(l.dst[1], 6);
    }
  });

  it("rejects duplicate landmarks", () => {
    const lms = [...KILN.landmarks, { name: "dup", src: KILN.landmarks[5]!.src, dst: [10, 10] as const }];
    expect(() => buildWarp(lms)).toThrow(/'.+' and 'dup' share the same src uv/);
  });

  it("rejects all-collinear landmarks", () => {
    const line = [0, 0.25, 0.5, 1].map((u, i) => ({ name: `l${i}`, src: [u, u] as const, dst: [u * 100, u * 100] as const }));
    expect(() => buildWarp(line)).toThrow(/collinear/);
  });

  it("rejects fewer than 3 landmarks", () => {
    expect(() => buildWarp(KILN.landmarks.slice(0, 2))).toThrow(/need >= 3/);
  });

  it("has no folded triangles (source → Kiln is a reflection everywhere)", () => {
    const o = (a: readonly number[], b: readonly number[], c: readonly number[]) =>
      (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
    for (const [i, j, k] of warp.triangles) {
      const [a, b, c] = [KILN.landmarks[i]!, KILN.landmarks[j]!, KILN.landmarks[k]!];
      expect(o(a.src, b.src, c.src) * o(a.dst, b.dst, c.dst), `${a.name}/${b.name}/${c.name}`).toBeLessThan(0);
    }
  });

  it("has 15–40 landmarks and covers the unit square", () => {
    // Calibration against real data needs denser anchors than the original 15–20 sketch.
    expect(KILN.landmarks.length).toBeGreaterThanOrEqual(15);
    expect(KILN.landmarks.length).toBeLessThanOrEqual(40);
    const p = warpUV(warp, 0.5, 0.5);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(KILN.width);
  });
});

describe("level loader", () => {
  it("accepts the synthetic fixture round-tripped through JSON", () => {
    expect(parseLevel(JSON.parse(JSON.stringify(SYNTHETIC_1V3)))).toEqual(SYNTHETIC_1V3);
  });

  it("rejects bad schemaVersion with the field path", () => {
    expect(() => parseLevel({ ...SYNTHETIC_1V3, schemaVersion: 2 })).toThrow(/schemaVersion/);
  });
});
