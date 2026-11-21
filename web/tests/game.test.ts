import { describe, expect, it } from "vitest";
import { blocksDefault, mapInput } from "../src/game/input";
import { addEntry, MAX_PER_LEVEL, normalizeInitials, topEntries, validInitials, type KeyValueStore } from "../src/game/leaderboard";
import { blurbFor } from "../src/game/levels";
import { scoreRound } from "../src/game/score";
import { Session } from "../src/game/session";
import {
  COUNTDOWN_S,
  MAX_SESSION_S,
  PLAY_GUARD_MARGIN_S,
  playGuardS,
  roundEndT,
  roundLimitS,
  SCORE_RETURN_S,
  sessionBudgetS,
  shouldAbortPlay,
} from "../src/game/timing";
import { createAutopilot } from "../src/game/autopilot";
import { playRound } from "../src/game/balance";
import { cellCenter, cellOf, findPath, isWalkable, reachableFrom, snap, type NavGrid } from "../src/sim/nav";
import { warpUV } from "../src/sim/warp";
import { SYNTHETIC_1V3 } from "../src/level/fixtures/synthetic-1v3";
import type { Actor, Level } from "../src/level/types";
import { KILN } from "../src/maps/kiln";
import {
  BOT_GRACE_S,
  BOT_HIT_MAX,
  BOT_HIT_MIN,
  BOT_MOVING_TARGET,
  DEFUSE_S,
  DT,
  FOV_COS,
  HEAR_RANGE,
  PLAYER_DAMAGE,
  PLAYER_FIRE_S,
  REACTION_MAX_S,
  REACTION_MIN_S,
  RUN_SPEED,
  TICK_HZ,
  VIEW_RANGE,
} from "../src/sim/constants";
import { dist, segmentClear, type Vec2 } from "../src/sim/geom";
import { hashState } from "../src/sim/hash";
import {
  BOT_GRACE_TICKS,
  botHitChance,
  initState,
  NO_INPUT,
  replay,
  step,
  type BotMode,
  type EnemyState,
  type Input,
  type SimState,
} from "../src/sim/sim";
import { buildWorld, type World } from "../src/sim/world";

const world = buildWorld(KILN, SYNTHETIC_1V3);
const still = (aim: Vec2, fire = false, use = false): Input => ({ move: { x: 0, y: 0 }, aim, fire, use });

function withLevel(patch: Partial<Level>): World {
  return buildWorld(KILN, { ...SYNTHETIC_1V3, ...patch });
}

/** Walkable cell centre at distance [minD, maxD] from `target` with (or without) line of sight. */
function spotNear(w: World, target: Vec2, minD: number, maxD: number, los: boolean): Vec2 {
  for (let i = 0; i < w.nav.walkable.length; i++) {
    if (w.nav.walkable[i] !== 1) continue;
    const p = cellCenter(w.nav, i);
    const d = dist(p, target);
    if (d >= minD && d <= maxD && segmentClear(w.map.walls, p, target) === los) return p;
  }
  throw new Error(`no spot ${minD}-${maxD} cm from (${target.x}, ${target.y}) with los=${los}`);
}

/** Walkable spot with no line of sight to any enemy (searched from the attacker spawn outward). */
function hiddenSpot(w: World, s: SimState): Vec2 {
  for (let i = w.nav.walkable.length - 1; i >= 0; i--) {
    if (w.nav.walkable[i] !== 1) continue;
    const p = cellCenter(w.nav, i);
    if (s.enemies.every((e) => !e.alive || (!segmentClear(w.map.walls, p, e) && dist(p, e) > 3000))) return p;
  }
  throw new Error("no hidden spot");
}

function place(s: SimState, p: Vec2, hp = s.clutcher.hp): SimState {
  return { ...s, clutcher: { ...s.clutcher, x: p.x, y: p.y, hp } };
}

function scripted(frame: number): Input {
  const dirs = [
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: 0 },
  ];
  return { move: dirs[Math.floor(frame / 45) % dirs.length]!, aim: { x: 1500 + frame * 3, y: 2400 }, fire: frame % 9 < 3, use: false };
}

function playSession(seed: number, frames: number): Session {
  const s = new Session(world, seed);
  for (let f = 0; f < frames; f++) s.advance(1000 / 60, scripted(f));
  return s;
}

describe("recorded-input determinism", () => {
  it("same level + seed + inputs → same recording and final hash; replay reproduces it", () => {
    const a = playSession(99, 1200);
    const b = playSession(99, 1200);
    expect(a.recording.length).toBeGreaterThan(100);
    expect(a.recording).toEqual(b.recording);
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(hashState(replay(world, 99, a.recording))).toBe(hashState(a.state));
    // Replay through a JSON round-trip (how a recording would be stored/shared).
    expect(hashState(replay(world, 99, JSON.parse(JSON.stringify(a.recording))))).toBe(hashState(a.state));
  });

  it("replay rejects gaps in the recording", () => {
    expect(() => replay(world, 1, [{ ...NO_INPUT, tick: 2 }])).toThrow(/tick 2 at state tick 0/);
  });
});

describe("reset between players", () => {
  it("a new session starts from a state identical to a fresh initState, regardless of prior play", () => {
    const levelBefore = JSON.stringify(world.level);
    const fresh = hashState(initState(world, 7));
    playSession(7, 900);
    const next = new Session(world, 7);
    expect(hashState(next.state)).toBe(fresh);
    expect(next.state).toEqual(initState(world, 7));
    expect(next.recording).toHaveLength(0);
    expect(JSON.stringify(world.level)).toBe(levelBefore);
  });
});

describe("hitscan", () => {
  it("hits an enemy in the open and is stopped by a wall", () => {
    const s0 = initState(world, 3);
    const e = s0.enemies[0]!;
    const open = place(s0, spotNear(world, e, 300, 700, true));
    const hit = step(world, open, still(e, true));
    expect(hit.enemies[0]!.hp).toBe(e.hp - PLAYER_DAMAGE);
    expect(hit.shots[0]!.hit).toBe("E1");

    const covered = place(s0, spotNear(world, e, 300, 1500, false));
    const blocked = step(world, covered, still(e, true));
    expect(blocked.enemies[0]!.hp).toBe(e.hp);
    expect(blocked.shots[0]!.hit).toBeNull();
    expect(dist(blocked.shots[0]!.from, blocked.shots[0]!.to)).toBeLessThan(dist(covered.clutcher, e));
  });

  it("respects the fire cooldown", () => {
    // PLAYER_FIRE_S 0.3 → one shot every 9 ticks: ticks 1, 10, 19, 28 within one second.
    expect(Math.round(PLAYER_FIRE_S * TICK_HZ)).toBe(9);
    const s0 = initState(world, 3);
    const e = s0.enemies[0]!;
    let s = place(s0, spotNear(world, e, 300, 700, true));
    const shotTicks: number[] = [];
    for (let i = 0; i < TICK_HZ; i++) {
      s = step(world, s, still(e, true));
      if (s.shots.some((x) => x.by === "P0")) shotTicks.push(s.tick);
    }
    expect(s.outcome).toBeNull();
    expect(shotTicks).toEqual([1, 10, 19, 28]);
  });
});

/** Walkable cell centre satisfying `pred`. */
function findSpot(w: World, pred: (p: Vec2) => boolean): Vec2 {
  for (let i = 0; i < w.nav.walkable.length; i++) {
    if (w.nav.walkable[i] !== 1) continue;
    const p = cellCenter(w.nav, i);
    if (pred(p)) return p;
  }
  throw new Error("no spot matches");
}

/** Cosine between the bot's facing and the direction to p. */
function facingCos(e: EnemyState, p: Vec2): number {
  const d = dist(e, p);
  return (e.fx * (p.x - e.x) + e.fy * (p.y - e.y)) / d;
}

describe("bot FSM", () => {
  it("goes Rail → Engage → Hunt → Rail (no HP tricks)", () => {
    let s = initState(world, 11);
    const e1 = s.enemies[0]!;
    s = place(s, spotNear(world, e1, 300, 600, true));
    const modes: BotMode[] = [s.enemies[0]!.mode];
    const log = (st: SimState): void => {
      const m = st.enemies[0]!.mode;
      if (modes[modes.length - 1] !== m) modes.push(m);
    };
    s = step(world, s, NO_INPUT);
    log(s);
    expect(s.enemies[0]!.mode).toBe("engage");
    // Break line of sight during the grace period: the bot hunts, gives up and walks back to its rail.
    s = place(s, hiddenSpot(world, s));
    for (let i = 0; i < 20 * TICK_HZ && !(modes.includes("hunt") && s.enemies[0]!.mode === "rail" && s.enemies[0]!.onRail); i++) {
      s = step(world, s, NO_INPUT);
      log(s);
    }
    expect(s.clutcher.hp).toBe(SYNTHETIC_1V3.clutcher.hp);
    expect(modes.slice(0, 4)).toEqual(["rail", "engage", "hunt", "rail"]);
    expect(s.enemies[0]!.onRail).toBe(true);
  });

  it("reaction delay before the first shot is 250–400 ms (seeded, varies)", () => {
    const lo = Math.round(REACTION_MIN_S * TICK_HZ);
    const hi = Math.round(REACTION_MAX_S * TICK_HZ);
    const delays = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      // Start after the grace period so only the reaction delay holds fire.
      let s: SimState = { ...initState(world, seed), tick: BOT_GRACE_TICKS + 1 };
      s = place(s, spotNear(world, s.enemies[0]!, 300, 600, true));
      s = step(world, s, NO_INPUT);
      expect(s.enemies[0]!.mode).toBe("engage");
      const engagedAt = s.tick;
      let shotAt = -1;
      for (let i = 0; i < TICK_HZ && shotAt < 0; i++) {
        s = step(world, s, NO_INPUT);
        if (s.shots.some((x) => x.by === "E1")) shotAt = s.tick;
      }
      // Engage tick sets the delay; the bot then waits `delay` ticks and fires on the next one.
      const delay = shotAt - engagedAt - 1;
      expect(delay).toBeGreaterThanOrEqual(lo);
      expect(delay).toBeLessThanOrEqual(hi);
      delays.add(delay);
    }
    expect(delays.size).toBeGreaterThan(1);
  });

  it("design decision: bots hold fire during the first second (grace)", () => {
    let s = initState(world, 4);
    s = place(s, spotNear(world, s.enemies[0]!, 300, 600, true));
    let firstBotShot = -1;
    for (let i = 0; i < 3 * TICK_HZ && firstBotShot < 0 && !s.outcome; i++) {
      s = step(world, s, NO_INPUT);
      if (s.shots.some((x) => x.by !== "P0")) firstBotShot = s.tick;
    }
    expect(BOT_GRACE_TICKS).toBe(TICK_HZ * BOT_GRACE_S);
    expect(firstBotShot).toBe(BOT_GRACE_TICKS + 1);
  });

  it("hit chance falls with distance, against movers and in a crowd", () => {
    expect(botHitChance(0, false)).toBeCloseTo(BOT_HIT_MAX, 9);
    expect(botHitChance(VIEW_RANGE, false)).toBeCloseTo(BOT_HIT_MIN, 9);
    expect(botHitChance(VIEW_RANGE / 2, false)).toBeCloseTo((BOT_HIT_MAX + BOT_HIT_MIN) / 2, 9);
    expect(botHitChance(0, true)).toBeCloseTo(BOT_HIT_MAX * BOT_MOVING_TARGET, 9);
    expect(botHitChance(0, false, 2)).toBeCloseTo(BOT_HIT_MAX, 9);
    expect(botHitChance(0, false, 4)).toBeCloseTo(BOT_HIT_MAX / 2, 9);
    // Empirical check through the sim: a still player at point blank is hit at ~BOT_HIT_MAX.
    let shots = 0;
    let hits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s: SimState = { ...initState(world, seed), tick: BOT_GRACE_TICKS + 1 };
      s = place(s, spotNear(world, s.enemies[0]!, 200, 400, true), 10_000);
      for (let i = 0; i < 2 * TICK_HZ; i++) {
        s = step(world, s, NO_INPUT);
        for (const x of s.shots) if (x.by === "E1") (shots++, x.hit && hits++);
      }
    }
    expect(shots).toBeGreaterThan(100);
    expect(hits / shots).toBeGreaterThan(BOT_HIT_MAX - 0.12);
    expect(hits / shots).toBeLessThan(BOT_HIT_MAX + 0.05);
  });

  it("a bot that is shot reacts even when it faces away and is out of notice range", () => {
    const s0 = initState(world, 2);
    const e = s0.enemies[0]!;
    // Behind the bot, beyond hearing range but inside view range, with line of sight.
    const spot = findSpot(
      world,
      (p) => dist(p, e) > HEAR_RANGE + 100 && dist(p, e) < 2900 && segmentClear(world.map.walls, p, e) && facingCos(e, p) < FOV_COS - 0.2,
    );
    const s = place(s0, spot);
    // Control: a shot into the void is not enough.
    const away = { x: spot.x + (spot.x - e.x), y: spot.y + (spot.y - e.y) };
    expect(step(world, s, still(away, true)).enemies[0]!.mode).toBe("rail");
    const hit = step(world, s, still(e, true));
    expect(hit.shots[0]!.hit).toBe("E1");
    expect(hit.enemies[0]!.mode).toBe("engage");
    expect(hit.enemies[0]!.lastSeen).toEqual({ x: spot.x, y: spot.y });
  });

  it("a bot shot from beyond its view range hunts toward the shooter", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s0 = initState(world, seed);
      const e = s0.enemies[0]!;
      const spot = findSpot(world, (p) => dist(p, e) > VIEW_RANGE + 100 && dist(p, e) < 5200 && segmentClear(world.map.walls, p, e));
      const next = step(world, place(s0, spot), still(e, true));
      if (next.shots[0]!.hit !== "E1") continue; // spread miss at long range; try the next seed
      expect(next.enemies[0]!.mode).toBe("hunt");
      expect(next.enemies[0]!.lastSeen).toEqual({ x: spot.x, y: spot.y });
      expect(next.enemies[0]!.path.length).toBeGreaterThan(0);
      return;
    }
    throw new Error("no seed produced a long-range hit");
  });

  it("walking back to the rail never teleports", () => {
    let s = initState(world, 6);
    s = place(s, hiddenSpot(world, s));
    const e = s.enemies[0]!;
    const far = findSpot(world, (p) => dist(p, e) > 2000 && dist(p, e) < 2600);
    // Off the rail with an empty path (as after an unreachable hunt end).
    s = { ...s, enemies: s.enemies.map((x, i) => (i === 0 ? { ...x, x: far.x, y: far.y, onRail: false, path: [], pathIdx: 0 } : x)) };
    let prev: Vec2 = far;
    for (let i = 0; i < 20 * TICK_HZ && !s.enemies[0]!.onRail; i++) {
      s = step(world, s, NO_INPUT);
      const cur = s.enemies[0]!;
      if (!cur.onRail) expect(dist(prev, cur)).toBeLessThanOrEqual(RUN_SPEED * DT + 1e-6);
      prev = cur;
    }
    expect(s.enemies[0]!.onRail).toBe(true);
  });

  it("simultaneous resolution: a bot killed this tick still fires this tick", () => {
    let s: SimState = { ...initState(world, 9), tick: BOT_GRACE_TICKS + 5 };
    const e = s.enemies[0]!;
    const spot = spotNear(world, e, 300, 500, true);
    s = {
      ...place(s, spot),
      enemies: s.enemies.map((x, i) =>
        i === 0 ? { ...x, hp: PLAYER_DAMAGE, mode: "engage" as const, reactTicks: 0, fireCd: 0, lastSeen: spot } : x,
      ),
    };
    const next = step(world, s, still(e, true));
    expect(next.enemies[0]!.alive).toBe(false);
    expect(next.shots.map((x) => x.by)).toEqual(["P0", "E1"]);
  });
});

describe("win / lose", () => {
  it("elimination: killing the last enemy wins", () => {
    let s = initState(world, 5);
    s = { ...s, enemies: s.enemies.map((e, i) => (i === 0 ? { ...e, hp: 1 } : { ...e, hp: 0, alive: false })) };
    const e = s.enemies[0]!;
    s = place(s, spotNear(world, e, 300, 600, true));
    s = step(world, s, still(e, true));
    expect(s.outcome).toMatchObject({ winner: "clutcher", reason: "elimination" });
    expect(s.stats.kills).toBe(1);
    // Decided rounds are frozen.
    expect(step(world, s, still(e, true))).toBe(s);
  });

  it("death: the clutcher going down loses", () => {
    let s = initState(world, 5);
    s = place(s, spotNear(world, s.enemies[0]!, 300, 600, true), 1);
    for (let i = 0; i < 5 * TICK_HZ && !s.outcome; i++) s = step(world, s, NO_INPUT);
    expect(s.outcome).toMatchObject({ winner: "enemies", reason: "death" });
    expect(s.clutcher.hp).toBe(0);
  });

  const timeout = (patch: Partial<Level>): SimState => {
    const w = withLevel({ startClockS: 1, ...patch });
    let s = initState(w, 5);
    for (let i = 0; i < 3 * TICK_HZ && !s.outcome; i++) s = step(w, s, NO_INPUT);
    return s;
  };
  const notPlanted = { spike: { planted: false }, plantedAtStart: false };
  const plantedNow = { spike: { planted: true, plantT: -10, site: "A" as const, u: 0.383, v: 0.278 }, plantedAtStart: true };

  it("time: attacker runs out of round time → lose; defender → win", () => {
    expect(timeout({ ...notPlanted, clutcherSide: "attack" }).outcome).toMatchObject({ winner: "enemies", reason: "time" });
    expect(timeout({ ...notPlanted, clutcherSide: "defense" }).outcome).toMatchObject({ winner: "clutcher", reason: "time" });
  });

  it("detonation: attacker survives the spike timer → win; defender → lose", () => {
    const att = timeout({ ...plantedNow, clutcherSide: "attack" }).outcome;
    expect(att).toMatchObject({ winner: "clutcher", reason: "detonate" });
    expect(att!.t).toBeCloseTo(1, 6);
    expect(timeout({ ...plantedNow, clutcherSide: "defense" }).outcome).toMatchObject({ winner: "enemies", reason: "detonate" });
  });

  it("defuse: holding E on the spike for 5 s wins; moving resets progress", () => {
    const far = (id: Actor["id"]): Actor => ({ id, hp: 100, samples: [{ t: 0, u: 0.95, v: 0.9 }] });
    const w = withLevel({
      ...plantedNow,
      clutcherSide: "defense",
      startClockS: 30,
      clutcher: { id: "P0", hp: 100, samples: [{ t: 0, u: 0.383, v: 0.278 }] },
      enemies: [far("E1"), far("E2"), far("E3")],
    });
    expect(w.spike).not.toBeNull();
    const spike = w.spike!;
    let s = initState(w, 5);
    expect(dist(s.clutcher, spike)).toBeLessThan(150);
    const hold = still(spike, false, true);
    for (let i = 0; i < 60; i++) s = step(w, s, hold);
    expect(s.clutcher.defuseTicks).toBe(60);
    s = step(w, s, { ...hold, move: { x: 1, y: 0 } });
    expect(s.clutcher.defuseTicks).toBe(0);
    s = place(s, spike);
    const ticks = DEFUSE_S * TICK_HZ;
    for (let i = 0; i < ticks - 1; i++) s = step(w, s, hold);
    expect(s.outcome).toBeNull();
    s = step(w, s, hold);
    expect(s.outcome).toMatchObject({ winner: "clutcher", reason: "defuse" });
    expect(s.outcome!.t).toBeCloseTo((61 + ticks) * DT, 6);
  });

  const killAll = (s: SimState): SimState => ({ ...s, enemies: s.enemies.map((e) => ({ ...e, hp: 0, alive: false })) });

  it("defender facing a planted spike must still defuse after the last kill", () => {
    const w = withLevel({
      ...plantedNow,
      clutcherSide: "defense",
      startClockS: 10,
      clutcher: { id: "P0", hp: 100, samples: [{ t: 0, u: 0.383, v: 0.278 }] },
    });
    let s = step(w, killAll(initState(w, 5)), NO_INPUT);
    expect(s.outcome).toBeNull();
    // Doing nothing now loses to the detonation...
    let idle = s;
    for (let i = 0; i < 11 * TICK_HZ && !idle.outcome; i++) idle = step(w, idle, NO_INPUT);
    expect(idle.outcome).toMatchObject({ winner: "enemies", reason: "detonate" });
    // ...while defusing wins.
    for (let i = 0; i < DEFUSE_S * TICK_HZ && !s.outcome; i++) s = step(w, s, still(w.spike!, false, true));
    expect(s.outcome).toMatchObject({ winner: "clutcher", reason: "defuse" });
  });

  it("elimination still wins for a defender before any plant and for an attacker with the spike down", () => {
    const def = withLevel({ ...notPlanted, clutcherSide: "defense" });
    expect(step(def, killAll(initState(def, 5)), NO_INPUT).outcome).toMatchObject({ winner: "clutcher", reason: "elimination" });
    const att = withLevel({ ...plantedNow, clutcherSide: "attack", startClockS: 30 });
    expect(step(att, killAll(initState(att, 5)), NO_INPUT).outcome).toMatchObject({ winner: "clutcher", reason: "elimination" });
  });

  it("defenders retake and defuse a planted spike when the attacking clutcher hides", () => {
    const near = (id: Actor["id"]): Actor => ({ id, hp: 100, samples: [{ t: 0, u: 0.4, v: 0.3 }] });
    const w = withLevel({
      ...plantedNow,
      clutcherSide: "attack",
      startClockS: 40,
      enemies: [near("E1"), near("E2"), near("E3")],
    });
    let s = initState(w, 5);
    s = place(s, hiddenSpot(w, s));
    for (let i = 0; i < 40 * TICK_HZ && !s.outcome; i++) s = step(w, s, NO_INPUT);
    expect(s.outcome).toMatchObject({ winner: "enemies", reason: "defuse" });
    expect(s.outcome!.t).toBeLessThan(15);
  });
});

// Real ETL output (git-ignored); skipped on a fresh clone.
const realLevels = Object.values(
  import.meta.glob<Level>(["../../data/levels/kiln/*.json", "!**/index.json"], { eager: true, import: "default" }),
);

describe.skipIf(realLevels.length === 0)("real Kiln levels", () => {
  it("every level builds, fits the 3-minute turn, and an idle round is decided by its clock", () => {
    for (const level of realLevels) {
      const w = buildWorld(KILN, level);
      expect(sessionBudgetS(w), level.id).toBeLessThanOrEqual(MAX_SESSION_S);
      let s = initState(w, 1);
      const maxTicks = Math.ceil(roundLimitS(w) * TICK_HZ) + 1;
      for (let i = 0; i < maxTicks && !s.outcome; i++) s = step(w, s, NO_INPUT);
      expect(s.outcome, level.id).not.toBeNull();
      expect(s.tick, level.id).toBeLessThanOrEqual(maxTicks);
    }
    const worst = Math.max(...realLevels.map((l) => sessionBudgetS(buildWorld(KILN, l))));
    console.info(`real levels: worst-case turn ${worst.toFixed(1)} s (limit ${MAX_SESSION_S} s)`);
  });

  it("every planted spike sits on a walkable cell reachable by the clutcher and every enemy", () => {
    const moved: string[] = [];
    for (const level of realLevels) {
      const w = buildWorld(KILN, level);
      if (!w.spike) continue;
      expect(isWalkable(w.nav, w.spike), level.id).toBe(true);
      expect(findPath(w.nav, w.clutcherRail.keys[0]!, w.spike), level.id).not.toBeNull();
      for (const r of w.enemyRails) expect(findPath(w.nav, r.rail.keys[0]!, w.spike), `${level.id} ${r.id}`).not.toBeNull();
      const plain = snap(w.nav, warpUV(w.warp, level.spike.u!, level.spike.v!));
      if (plain.x !== w.spike.x || plain.y !== w.spike.y) moved.push(level.id);
    }
    console.info(`spike moved off an unreachable pocket in ${moved.length}/${realLevels.length} levels: ${moved.join(", ") || "none"}`);
  });
});

/** Hand-built grid: `#` blocked, `.` walkable. */
function gridOf(rows: string[], cell = 100): NavGrid {
  const cols = rows[0]!.length;
  const walkable = new Uint8Array(rows.length * cols);
  rows.forEach((r, ri) => [...r].forEach((ch, ci) => (walkable[ri * cols + ci] = ch === "." ? 1 : 0)));
  return { cell, cols, rows: rows.length, walkable };
}

describe("spike placement", () => {
  it("snaps to the nearest reachable walkable cell, skipping isolated pockets (deterministic)", () => {
    const g = gridOf([
      // walled pocket (cols 4–5, rows 1–2) is closest to the spike but cut off from the start at (0,0)
      "...#####",
      "...#..##",
      "...#..##",
      "...#####",
      "........",
    ]);
    const spikeRaw = { x: 470, y: 160 };
    expect(snap(g, spikeRaw)).toEqual({ x: 450, y: 150 });
    const reach = reachableFrom(g, cellOf(g, { x: 50, y: 50 }));
    expect(reach[1 * 8 + 4]).toBe(0);
    expect(reach[4 * 8 + 7]).toBe(1);
    const placed = snap(g, spikeRaw, reach);
    expect(reach[cellOf(g, placed)]).toBe(1);
    expect(placed).toEqual({ x: 250, y: 150 });
    expect(snap(g, spikeRaw, reach)).toEqual(placed);
    expect(() => snap(g, spikeRaw, new Uint8Array(g.walkable.length))).toThrow(/no allowed walkable cell/);
  });

  it("a spike recorded inside a wall is moved to a reachable cell the clutcher can defuse from", () => {
    // Find a spike uv that warps into a wall / off the navmesh.
    let uv: { u: number; v: number } | null = null;
    for (let i = 1; i < 40 && !uv; i++) {
      for (let j = 1; j < 40 && !uv; j++) {
        if (!isWalkable(world.nav, warpUV(world.warp, i / 40, j / 40))) uv = { u: i / 40, v: j / 40 };
      }
    }
    expect(uv).not.toBeNull();
    const w = withLevel({
      plantedAtStart: true,
      clutcherSide: "defense",
      startClockS: 90,
      spike: { planted: true, plantT: -10, site: "A", ...uv! },
    });
    expect(isWalkable(w.nav, w.spike!)).toBe(true);
    const path = findPath(w.nav, w.clutcherRail.keys[0]!, w.spike!);
    expect(path).not.toBeNull();
    // Walk the path, then hold E: the defuse completes.
    let s = initState(w, 1);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, hp: 0, alive: false })) };
    for (const wp of path!) {
      for (let i = 0; i < 10 * TICK_HZ && dist(s.clutcher, wp) > 5 && !s.outcome; i++) {
        const d = dist(s.clutcher, wp);
        s = step(w, s, { move: { x: (wp.x - s.clutcher.x) / d, y: (wp.y - s.clutcher.y) / d }, aim: wp, fire: false, use: false });
      }
    }
    for (let i = 0; i < (DEFUSE_S + 1) * TICK_HZ && !s.outcome; i++) s = step(w, s, still(w.spike!, false, true));
    expect(s.outcome).toMatchObject({ winner: "clutcher", reason: "defuse" });
  });
});

describe("autopilot is frame-rate independent", () => {
  it("?auto through Session at 16 / 33 / 50 ms frames ends in the same state as the balance harness", () => {
    for (const seed of [1, 7]) {
      const expected = hashState(playRound(world, seed, "autopilot"));
      for (const frameMs of [16, 33, 50]) {
        const session = new Session(world, seed);
        const pilot = createAutopilot(world);
        for (let f = 0; f < 200_000 && !session.state.outcome; f++) session.advance(frameMs, pilot);
        expect(session.state.outcome, `seed ${seed} @${frameMs} ms`).not.toBeNull();
        expect(hashState(session.state), `seed ${seed} @${frameMs} ms`).toBe(expected);
        // The recording replays to the same state (pilot was asked once per tick, none during countdown).
        expect(hashState(replay(world, seed, session.recording))).toBe(expected);
      }
    }
  });
});

describe("session timing (3-minute turn)", () => {
  it("the play-screen guard never cuts a decided round and only fires after countdown + limit + margin", () => {
    const limit = 40;
    const guardMs = playGuardS(limit) * 1000;
    expect(playGuardS(limit)).toBe(COUNTDOWN_S + limit + PLAY_GUARD_MARGIN_S);
    expect(shouldAbortPlay(guardMs, false, limit)).toBe(false);
    expect(shouldAbortPlay(guardMs + 1, false, limit)).toBe(true);
    expect(shouldAbortPlay(guardMs + 1, true, limit)).toBe(false);
    expect(shouldAbortPlay(10 * guardMs, true, limit)).toBe(false);
    expect(shouldAbortPlay((COUNTDOWN_S + limit) * 1000, false, limit)).toBe(false);
  });

  it("countdown runs before the sim; nothing is recorded during it", () => {
    const s = new Session(world, 1);
    expect(s.countdown).toBe(COUNTDOWN_S);
    expect(s.advance(COUNTDOWN_S * 1000 - 1, NO_INPUT)).toBe(0);
    expect(s.countdown).toBe(1);
    expect(s.recording).toHaveLength(0);
    expect(s.state.tick).toBe(0);
    expect(s.advance(1 + 1000 / TICK_HZ, NO_INPUT)).toBe(1);
    expect(s.countdown).toBe(0);
    expect(s.recording.map((c) => c.tick)).toEqual([1]);
  });

  it("countdown + longest round + score screen ≤ 180 s, and the round really ends by then", () => {
    for (const w of [world, withLevel({ ...SYNTHETIC_1V3, spike: { planted: false }, plantedAtStart: false })]) {
      expect(sessionBudgetS(w)).toBeLessThanOrEqual(MAX_SESSION_S);
      expect(sessionBudgetS(w)).toBeCloseTo(COUNTDOWN_S + roundLimitS(w) + PLAY_GUARD_MARGIN_S + SCORE_RETURN_S, 9);
      let s = initState(w, 3);
      s = place(s, hiddenSpot(w, s));
      const maxTicks = Math.ceil(roundLimitS(w) * TICK_HZ) + 1;
      for (let i = 0; i < maxTicks && !s.outcome; i++) s = step(w, s, NO_INPUT);
      expect(s.outcome).not.toBeNull();
      expect(s.outcome!.t).toBeLessThanOrEqual(roundEndT(w) + DT);
    }
  });
});

describe("controls → Input", () => {
  const raw = (keys: string[], pointerDown = false, aimPx: Vec2 = { x: 100, y: 50 }) => ({ keys: new Set(keys), aimPx, pointerDown });

  it("maps WASD / arrows to move, cancelling opposite keys", () => {
    expect(mapInput(raw(["KeyW"]), 0.1).move).toEqual({ x: 0, y: -1 });
    expect(mapInput(raw(["KeyS", "KeyD"]), 0.1).move).toEqual({ x: 1, y: 1 });
    expect(mapInput(raw(["KeyA", "ArrowUp"]), 0.1).move).toEqual({ x: -1, y: -1 });
    expect(mapInput(raw(["KeyA", "KeyD"]), 0.1).move).toEqual({ x: 0, y: 0 });
    expect(mapInput(raw([]), 0.1).move).toEqual({ x: 0, y: 0 });
  });

  it("maps pointer px to world aim, click/Space to fire, holding E to use", () => {
    const i = mapInput(raw([], true, { x: 41, y: 82 }), 0.1025);
    expect(i.aim.x).toBeCloseTo(400, 9);
    expect(i.aim.y).toBeCloseTo(800, 9);
    expect(i.fire).toBe(true);
    expect(i.use).toBe(false);
    expect(mapInput(raw(["Space"]), 1).fire).toBe(true);
    expect(mapInput(raw(["KeyE"]), 1)).toMatchObject({ fire: false, use: true });
    expect(() => mapInput(raw([]), 0)).toThrow(/scale/);
  });

  it("drives the clutcher in the sim (W moves up, held E defuses)", () => {
    const s0 = initState(world, 1);
    const up = step(world, s0, mapInput(raw(["KeyW"]), 1));
    expect(up.clutcher.y).toBeLessThan(s0.clutcher.y);
    expect(up.clutcher.x).toBe(s0.clutcher.x);
  });

  it("only swallows Space/arrow keys while playing", () => {
    expect(blocksDefault("Space", "play")).toBe(true);
    expect(blocksDefault("ArrowDown", "play")).toBe(true);
    expect(blocksDefault("KeyW", "play")).toBe(false);
    expect(blocksDefault("Space", "attract")).toBe(false);
    expect(blocksDefault("ArrowUp", "score")).toBe(false);
  });
});

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("leaderboard", () => {
  it("needs exactly three letters A–Z", () => {
    expect(normalizeInitials("a1b-c d")).toBe("ABC");
    expect(validInitials("ab")).toBe(false);
    expect(validInitials("ábc")).toBe(false);
    expect(validInitials("xyz")).toBe(true);
    const store = memoryStore();
    expect(addEntry({ initials: "AB", points: 5, levelId: "L" }, store)).toBe(false);
    expect(addEntry({ initials: "abc", points: 5, levelId: "L" }, store)).toBe(true);
    expect(topEntries("L", store)).toEqual([{ initials: "ABC", points: 5, levelId: "L" }]);
  });

  it("keeps the best MAX_PER_LEVEL per level without starving other levels", () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_PER_LEVEL + 5; i++) addEntry({ initials: "AAA", points: 1000 + i, levelId: "busy" }, store);
    addEntry({ initials: "BBB", points: 1, levelId: "quiet" }, store);
    const busy = topEntries("busy", store);
    expect(busy).toHaveLength(MAX_PER_LEVEL);
    expect(busy[0]!.points).toBe(1000 + MAX_PER_LEVEL + 4);
    expect(busy[MAX_PER_LEVEL - 1]!.points).toBe(1005);
    expect(topEntries("quiet", store)).toHaveLength(1);
    const stored: unknown = JSON.parse(store.data.get("rtr.leaderboard.v1")!);
    expect(stored).toHaveLength(MAX_PER_LEVEL + 1);
  });

  it("survives broken storage", () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(topEntries(undefined, throwing)).toEqual([]);
    expect(addEntry({ initials: "ABC", points: 1, levelId: "L" }, throwing)).toBe(false);
    const corrupt = memoryStore();
    corrupt.data.set("rtr.leaderboard.v1", "{not json");
    expect(topEntries(undefined, corrupt)).toEqual([]);
    expect(addEntry({ initials: "ABC", points: 1, levelId: "L" }, null)).toBe(false);
  });
});

describe("level blurbs", () => {
  it("are derived from the level data", () => {
    expect(blurbFor(SYNTHETIC_1V3)).toBe("1v3 · attack · spike down on A · pro won the fight in 28.0 s");
    expect(blurbFor({ ...SYNTHETIC_1V3, clutcherWon: false })).toMatch(/pro lost in 28\.0 s$/);
  });
});

describe("score", () => {
  it("compares against the pro result", () => {
    let s = initState(world, 5);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, hp: 0, alive: false })) };
    s = step(world, s, NO_INPUT);
    const card = scoreRound(SYNTHETIC_1V3, s);
    expect(card.won).toBe(true);
    expect(card.proTimeS).toBe(28);
    expect(card.points).toBeGreaterThan(1000);
    expect(() => scoreRound(SYNTHETIC_1V3, initState(world, 5))).toThrow(/not decided/);
  });
});
