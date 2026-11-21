import { describe, expect, it } from "vitest";
import { liveFrame, proFrame, TRACER_MS, TRACER_TICKS, youFrame } from "../src/game/frameView";
import { buildYouTimeline, proFrameAt, timeOfTick, youStateAt } from "../src/game/replayModel";
import { Session } from "../src/game/session";
import { SYNTHETIC_1V3 } from "../src/level/fixtures/synthetic-1v3";
import type { Level } from "../src/level/types";
import { KILN } from "../src/maps/kiln";
import type { FrameView } from "../src/render/renderer";
import { DEFUSE_S, TICK_HZ } from "../src/sim/constants";
import { segmentClear, type Vec2 } from "../src/sim/geom";
import { clockAt, initState, simTimeAt, type EnemyState, type ShotEvent, type SimState } from "../src/sim/sim";
import { buildWorld } from "../src/sim/world";

const world = buildWorld(KILN, SYNTHETIC_1V3);
const base = initState(world, 42);
const FULL = DEFUSE_S * TICK_HZ;
// A defending clutcher sees the enemies' mid-round plant (t = 22); an attacking one does not.
const defWorld = buildWorld(KILN, { ...SYNTHETIC_1V3, clutcherSide: "defense" });

function withActors(s: SimState, clutcher: Partial<SimState["clutcher"]>, enemies: readonly Partial<EnemyState>[]): SimState {
  return {
    ...s,
    clutcher: { ...s.clutcher, ...clutcher },
    enemies: s.enemies.map((e, i) => ({ ...e, ...(enemies[i] ?? {}) })),
  };
}

/** A wall and two points on either side of it (blocked line), found on the real Kiln geometry. */
function blockedPair(): { a: Vec2; b: Vec2 } {
  for (const w of KILN.walls) {
    const xs = w.filter((_, i) => i % 2 === 0);
    const ys = w.filter((_, i) => i % 2 === 1);
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const a = { x: Math.min(...xs) - 200, y: cy };
    const b = { x: Math.max(...xs) + 200, y: cy };
    if (!segmentClear(KILN.walls, a, b)) return { a, b };
  }
  throw new Error("no blocking wall found");
}

/** First tick whose level time is at least t. */
function tickAt(t: number): number {
  return Math.ceil((t - simTimeAt(world, 0)) * TICK_HZ);
}

function zOrdered(f: FrameView): boolean {
  const zs = [...f.downs, ...f.enemies].map((v) => v.z!).sort((x, y) => x - y);
  return zs.every((z, i) => i === 0 || z > zs[i - 1]!);
}

const shot = (by: "P0" | "E1", x: number): ShotEvent => ({ by, from: { x, y: 0 }, to: { x, y: 500 }, hit: null });

describe("liveFrame", () => {
  it("hides living enemies behind a wall (fog of war) and shows those in line of sight with facing", () => {
    const { a, b } = blockedPair();
    const near = { x: a.x - 300, y: a.y };
    expect(segmentClear(KILN.walls, a, near)).toBe(true);
    const s = withActors(base, { x: a.x, y: a.y }, [
      { x: b.x, y: b.y, alive: true },
      { x: near.x, y: near.y, fx: 1, fy: 0, alive: true },
      { alive: true },
    ]);
    const visibleThird = segmentClear(KILN.walls, a, s.enemies[2]!);
    const f = liveFrame(world, s, null, [], 0);
    expect(f.enemies.some((e) => e.z === 0)).toBe(false);
    expect(f.enemies.find((e) => e.z === 1)).toEqual({ x: near.x, y: near.y, fx: 1, fy: 0, z: 1 });
    expect(f.enemies.some((e) => e.z === 2)).toBe(visibleThird);
    expect(f.downs).toEqual([]);
  });

  it("always shows dead enemies as downs, even behind a wall", () => {
    const { a, b } = blockedPair();
    const s = withActors(base, { x: a.x, y: a.y }, [{ x: b.x, y: b.y, alive: false }]);
    const f = liveFrame(world, s, null, [], 0);
    expect(f.downs).toContainEqual({ x: b.x, y: b.y, side: "enemy", z: 0 });
    expect(f.enemies.some((e) => e.z === 0)).toBe(false);
  });

  it("fades tracers with wall time like the live view (unclamped)", () => {
    const tr = [{ shot: shot("P0", 0), untilMs: 1000 }];
    expect(liveFrame(world, base, null, tr, 1000 - TRACER_MS).tracers[0]!.fade).toBeCloseTo(1.3);
    expect(liveFrame(world, base, null, tr, 1000 - TRACER_MS / 2).tracers[0]!.fade).toBeCloseTo(0.8);
    expect(liveFrame(world, base, null, tr, 1000).tracers[0]!.fade).toBeCloseTo(0.3);
    expect(liveFrame(world, base, null, tr, 0).tracers[0]!.shot).toBe(tr[0]!.shot);
  });

  it("has no spike before the plant and the defuse fields after it", () => {
    expect(clockAt(defWorld, simTimeAt(defWorld, 0)).spikeActive).toBe(false);
    expect(liveFrame(defWorld, base, null, [], 0).spike).toBeNull();
    const tick = tickAt(23);
    expect(clockAt(defWorld, simTimeAt(defWorld, tick)).spikeActive).toBe(true);
    // Same tick on the attacking level: the mid-round plant is not shown.
    expect(liveFrame(world, { ...base, tick }, null, [], 0).spike).toBeNull();
    const s = withActors({ ...base, tick }, { defuseTicks: 30 }, [{ alive: true, defuseTicks: 60 }, { alive: false, defuseTicks: 200 }, { alive: true, defuseTicks: 10 }]);
    const f = liveFrame(defWorld, s, null, [], 2500);
    expect(f.spike).toEqual({ x: defWorld.spike!.x, y: defWorld.spike!.y, defuse: 30 / FULL, enemyDefuse: 60 / FULL, pulseT: 2.5 });
    expect(liveFrame(defWorld, s, null, [], 2500, { reducedMotion: true }).spike!.pulseT).toBeNull();
  });

  it("gives the replay panels a still spike: own defuse on YOU, 0 on PRO, no enemy defuse", () => {
    const tick = tickAt(23);
    const t = simTimeAt(defWorld, tick);
    const timeline = Array.from({ length: tick + 1 }, (_, i) => withActors({ ...base, tick: i }, { defuseTicks: i === tick ? 45 : 0 }, [{ defuseTicks: 99 }]));
    const sp = { x: defWorld.spike!.x, y: defWorld.spike!.y };
    expect(youFrame(defWorld, timeline, t).spike).toEqual({ ...sp, defuse: 45 / FULL, pulseT: null });
    expect(proFrame(defWorld, t).spike).toEqual({ ...sp, defuse: 0, pulseT: null });
    expect(proFrame(defWorld, 21).spike).toBeNull();
  });

  it("keeps the player (with aim) even at hp 0", () => {
    const aim = { x: 10, y: 20 };
    const s = withActors(base, { hp: 0 }, []);
    expect(liveFrame(world, s, aim, [], 0).player).toEqual({ x: s.clutcher.x, y: s.clutcher.y, aim });
  });
});

describe("youFrame", () => {
  it("fades the tracers of the last TRACER_TICKS ticks by 1, 0.75, 0.5, 0.25", () => {
    const timeline = Array.from({ length: 6 }, (_, i) => ({ ...base, tick: i, shots: [shot("P0", i)] }));
    const f = youFrame(world, timeline, timeOfTick(world, 5));
    expect(f.tracers.map((t) => t.shot.from.x)).toEqual([2, 3, 4, 5]);
    expect(f.tracers.map((t) => t.fade)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(TRACER_TICKS).toBe(4);
    // Tick 0 (the initial state) never contributes tracers.
    expect(youFrame(world, timeline, timeOfTick(world, 1)).tracers.map((t) => t.shot.from.x)).toEqual([1]);
  });

  it("replaces the dead player by a player-side down drawn after all enemies", () => {
    const dead = withActors({ ...base, tick: 1 }, { hp: 0 }, [{ alive: false }]);
    const f = youFrame(world, [base, dead], timeOfTick(world, 1));
    expect(f.player).toBeNull();
    expect(f.downs.at(-1)).toEqual({ x: dead.clutcher.x, y: dead.clutcher.y, side: "player", z: dead.enemies.length });
    expect(f.downs[0]).toMatchObject({ side: "enemy", z: 0 });
    expect(f.enemies.map((e) => e.z)).toEqual([1, 2]);
  });

  it("shows the recorded state without fog at several times, with a still spike", () => {
    const session = new Session(world, 42, 0);
    for (let i = 0; i < 900; i++) session.advance(1000 / 60, { move: { x: 0, y: -1 }, aim: { x: 1500, y: 2400 }, fire: i % 9 < 3, use: false });
    const timeline = buildYouTimeline(world, 42, session.recording);
    const last = timeOfTick(world, timeline.length - 1);
    for (const t of [timeOfTick(world, 0), timeOfTick(world, 0) + 2, last / 2, last, 1e6]) {
      const s = youStateAt(world, timeline, t);
      const f = youFrame(world, timeline, t);
      expect(f.enemies.length + f.downs.length).toBe(s.enemies.length + (s.clutcher.hp > 0 ? 0 : 1));
      expect(f.enemies.length).toBe(s.enemies.filter((e) => e.alive).length);
      for (const e of f.enemies) expect(e).toMatchObject({ x: s.enemies[e.z!]!.x, y: s.enemies[e.z!]!.y, fx: s.enemies[e.z!]!.fx });
      if (f.player) expect(f.player).toEqual({ x: s.clutcher.x, y: s.clutcher.y, aim: null });
      expect(zOrdered(f)).toBe(true);
      if (f.spike) {
        expect(f.spike).toEqual({ x: world.spike!.x, y: world.spike!.y, defuse: s.clutcher.defuseTicks / FULL, pulseT: null });
      } else {
        expect(clockAt(world, t).spikeActive).toBe(false);
      }
    }
  });
});

describe("proFrame", () => {
  it("matches proFrameAt at start, mid, after a kill and at the end", () => {
    for (const t of [timeOfTick(world, 0), 10, 15, 21, 23, 28]) {
      const pf = proFrameAt(world, world.level, t);
      const f = proFrame(world, t);
      expect(f.player).toEqual({ x: pf.clutcher.x, y: pf.clutcher.y, aim: null });
      expect(f.enemies).toEqual(pf.enemies.map((e, i) => ({ x: e.x, y: e.y, z: pf.kills.length + i })));
      expect(f.downs).toEqual(pf.kills.map((k, z) => ({ x: k.at.x, y: k.at.y, side: "enemy", z })));
      expect(f.tracers).toEqual([]);
      expect(zOrdered(f)).toBe(true);
      expect(f.spike === null).toBe(!clockAt(world, t).spikeActive);
      if (f.spike) expect(f.spike).toMatchObject({ defuse: 0, pulseT: null });
    }
    expect(proFrame(world, 15).downs).toHaveLength(1);
    expect(proFrame(world, 15).enemies).toHaveLength(2);
  });

  it("turns the pro's clutcher into a player-side down after their death", () => {
    const level: Level = {
      ...SYNTHETIC_1V3,
      clutcher: { ...SYNTHETIC_1V3.clutcher, diedT: 25 },
      kills: [SYNTHETIC_1V3.kills[0]!, SYNTHETIC_1V3.kills[1]!, { t: 25, killer: "E3", victim: "P0", victimUV: [0.4, 0.2] }],
      outcome: { winner: "enemies", t: 25, reason: "elimination" },
    };
    const w = buildWorld(KILN, level);
    expect(proFrame(w, 24.9).player).not.toBeNull();
    const f = proFrame(w, 25);
    expect(f.player).toBeNull();
    expect(f.downs.map((d) => d.side)).toEqual(["enemy", "enemy", "player"]);
    expect(f.enemies).toEqual([expect.objectContaining({ z: 3 })]);
  });
});

describe("frame view purity", () => {
  it("frame builders, the replay player and renderer types use no renderer libs, DOM or clocks", () => {
    const sources = import.meta.glob(["../src/game/frameView.ts", "../src/game/replayPlayer.ts", "../src/render/renderer.ts"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const files = Object.entries(sources);
    expect(files).toHaveLength(3);
    for (const [file, src] of files) {
      expect(String(src), file).not.toMatch(
        /Math\.random|\bDate\b|performance\.now|\bwindow\b|\bdocument\b|pixi|from\s*["']three|import\s*\(?\s*["']three/,
      );
    }
  });

  it("camera math and renderer selection (except detectCaps) use no renderer libs or DOM", () => {
    const sources = import.meta.glob(["../src/render/three3d/camMath.ts", "../src/render/select.ts"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const files = Object.entries(sources);
    expect(files).toHaveLength(2);
    const forbidden = /Math\.random|\bwindow\b|\bdocument\b|pixi|from\s*["']three|import\s*\(?\s*["']three/;
    for (const [file, raw] of files) {
      let src = String(raw);
      if (file.endsWith("select.ts")) {
        expect(src).not.toMatch(/pixi|from\s*["']three|import\s*\(?\s*["']three/);
        const caps = /export function detectCaps\(\)[\s\S]*?\n}/;
        expect(src, "detectCaps block").toMatch(caps);
        src = src.replace(caps, "");
      }
      expect(src, file).not.toMatch(forbidden);
    }
  });

  it("frame loop uses no renderer libs or DOM (only the default browser clock/raf deps)", () => {
    const src = import.meta.glob("../src/game/frameLoop.ts", { query: "?raw", import: "default", eager: true });
    const files = Object.values(src);
    expect(files).toHaveLength(1);
    expect(String(files[0])).not.toMatch(/pixi|three|\bdocument\b|\bwindow\b/);
  });
});

describe("renderer seam", () => {
  const sources = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true });
  const pixiAllowed = (file: string): boolean =>
    ["../src/render/pixi2d.ts", "../src/render/mapView.ts", "../src/render/actors.ts", "../src/main.ts"].includes(file) || file.startsWith("../src/debug/");

  it("only the Pixi renderer files (and main.ts for unsafe-eval, plus the dev debug page) import pixi.js", () => {
    const users = Object.entries(sources)
      .filter(([, src]) => /["']pixi\.js/.test(String(src)))
      .map(([file]) => file);
    expect(users).toContain("../src/render/pixi2d.ts");
    expect(users.filter((f) => !pixiAllowed(f))).toEqual([]);
  });

  it("the game page is Pixi-free and the old replay view is gone", () => {
    expect(sources["../src/game/gamePage.ts"]).toBeDefined();
    // It may use the renderer factory (`render/pixi2d`), never the library itself.
    expect(String(sources["../src/game/gamePage.ts"])).not.toMatch(/["']pixi\.js/);
    expect(sources["../src/game/replayView.ts"]).toBeUndefined();
  });
});
