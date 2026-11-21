import type { ActorId } from "../level/types";
import {
  BOT_DAMAGE,
  BOT_CROWD_BUDGET,
  BOT_FIRE_S,
  BOT_GRACE_S,
  BOT_HIT_MAX,
  BOT_HIT_MIN,
  BOT_MOVING_TARGET,
  DEFUSE_RADIUS,
  DEFUSE_S,
  DT,
  ENEMY_HIT_RADIUS,
  ENEMY_MIN_HP,
  FOV_COS,
  HEAR_RANGE,
  HUNT_MAX_S,
  NAV_CELL,
  NEAR_NOTICE,
  PLAYER_DAMAGE,
  PLAYER_FIRE_S,
  PLAYER_RANGE,
  REACTION_MAX_S,
  REACTION_MIN_S,
  RETAKE_MARGIN_S,
  RUN_SPEED,
  SPIKE_TIMER_S,
  SPREAD_MOVING,
  SPREAD_STILL,
  TICK_HZ,
  VIEW_RANGE,
} from "./constants";
import { dist, firstWallHit, segmentClear, type Vec2 } from "./geom";
import { findPath, isWalkable } from "./nav";
import { railPosition } from "./rail";
import { nextFloat, seedRng, type RngState } from "./rng";
import type { World } from "./world";

/** Player intent for one tick. `move` components in [-1, 1]; `aim` is a world point (cm). */
export type Input = {
  readonly move: Vec2;
  readonly aim: Vec2;
  readonly fire: boolean;
  /** Hold to defuse. */
  readonly use: boolean;
};

/** A recorded input: the input applied to produce state `tick`. */
export type Command = Input & { readonly tick: number };

export const NO_INPUT: Input = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, fire: false, use: false };

/** `defuse`: a defender walking to / defusing a planted spike (attacking clutcher only). */
export type BotMode = "rail" | "engage" | "hunt" | "defuse";

export type EnemyState = {
  readonly id: ActorId;
  readonly x: number;
  readonly y: number;
  /** Unit facing vector. */
  readonly fx: number;
  readonly fy: number;
  readonly hp: number;
  readonly alive: boolean;
  readonly mode: BotMode;
  /** Own progress along the data rail (level seconds); frozen while off the rail. */
  readonly railT: number;
  /** False while walking back to the rail after a hunt. */
  readonly onRail: boolean;
  readonly path: readonly Vec2[];
  readonly pathIdx: number;
  /** Ticks left before the first shot of the current engagement. */
  readonly reactTicks: number;
  readonly fireCd: number;
  readonly lastSeen: Vec2 | null;
  readonly huntTicks: number;
  /** Uninterrupted ticks spent defusing (mode `defuse`, on the spike). */
  readonly defuseTicks: number;
};

export type ClutcherState = {
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly fireCd: number;
  readonly defuseTicks: number;
  readonly moving: boolean;
};

export type ShotEvent = { readonly by: ActorId; readonly from: Vec2; readonly to: Vec2; readonly hit: ActorId | null };

export type SimOutcome = {
  readonly winner: "clutcher" | "enemies";
  readonly reason: "elimination" | "defuse" | "detonate" | "time" | "death";
  readonly t: number;
};

export type SimStats = {
  readonly kills: number;
  readonly shotsFired: number;
  readonly hits: number;
  readonly damageTaken: number;
};

export type SimState = {
  readonly tick: number;
  readonly rng: RngState;
  readonly clutcher: ClutcherState;
  readonly enemies: readonly EnemyState[];
  /** Shots fired during the last tick (for rendering). */
  readonly shots: readonly ShotEvent[];
  readonly stats: SimStats;
  /** Set once the round is decided; further steps return the state unchanged. */
  readonly outcome: SimOutcome | null;
};

const PLAYER_FIRE_TICKS = Math.round(PLAYER_FIRE_S * TICK_HZ);
const BOT_FIRE_TICKS = Math.round(BOT_FIRE_S * TICK_HZ);
const HUNT_MAX_TICKS = Math.round(HUNT_MAX_S * TICK_HZ);
const DEFUSE_TICKS = Math.round(DEFUSE_S * TICK_HZ);
export const BOT_GRACE_TICKS = Math.round(BOT_GRACE_S * TICK_HZ);
const REPATH_TICKS = 15;
const STEP_LEN = RUN_SPEED * DT;

/** Level-time (s) at a given tick; level samples start at the first clutcher sample. */
export function simTimeAt(world: World, tick: number): number {
  return world.clutcherRail.keys[0]!.t + tick * DT;
}

export type Clock = { readonly secondsLeft: number; readonly spikeActive: boolean };

/**
 * Round clock at level-time t: the spike timer once planted, otherwise the round timer.
 * A plant after t = 0 by an attacking clutcher is not replayed (the player would have to plant;
 * not modelled yet), so for them only plantedAtStart counts. Enemy plants follow the data.
 */
export function clockAt(world: World, t: number): Clock {
  const { level } = world;
  const plantT = level.spike.plantT;
  const spikeActive =
    level.spike.planted &&
    plantT !== undefined &&
    plantT <= t &&
    (level.plantedAtStart || level.clutcherSide === "defense");
  if (spikeActive) {
    const detonateT = level.plantedAtStart ? level.startClockS : plantT + SPIKE_TIMER_S;
    return { secondsLeft: detonateT - t, spikeActive };
  }
  return { secondsLeft: level.startClockS - t, spikeActive };
}

function unit(dx: number, dy: number): Vec2 | null {
  const l = Math.sqrt(dx * dx + dy * dy);
  return l > 0 ? { x: dx / l, y: dy / l } : null;
}

function initialFacing(world: World, i: number, p: Vec2, toward: Vec2): Vec2 {
  const ahead = railPosition(world.enemyRails[i]!.rail, simTimeAt(world, 0) + 1);
  return (
    unit(ahead.x - p.x, ahead.y - p.y) ??
    (world.spike ? unit(world.spike.x - p.x, world.spike.y - p.y) : null) ??
    unit(toward.x - p.x, toward.y - p.y) ?? { x: 0, y: 1 }
  );
}

export function initState(world: World, seed: number): SimState {
  const t0 = simTimeAt(world, 0);
  const c = railPosition(world.clutcherRail, t0);
  const enemies: EnemyState[] = world.enemyRails.map(({ rail }, i) => {
    const p = railPosition(rail, t0);
    const f = initialFacing(world, i, p, c);
    return {
      id: world.level.enemies[i]!.id,
      x: p.x,
      y: p.y,
      fx: f.x,
      fy: f.y,
      hp: Math.max(ENEMY_MIN_HP, world.level.enemies[i]!.hp),
      alive: true,
      mode: "rail",
      railT: t0,
      onRail: true,
      path: [],
      pathIdx: 0,
      reactTicks: 0,
      fireCd: 0,
      lastSeen: null,
      huntTicks: 0,
      defuseTicks: 0,
    };
  });
  return {
    tick: 0,
    rng: seedRng(seed),
    clutcher: { x: c.x, y: c.y, hp: world.level.clutcher.hp, fireCd: 0, defuseTicks: 0, moving: false },
    enemies,
    shots: [],
    stats: { kills: 0, shotsFired: 0, hits: 0, damageTaken: 0 },
    outcome: null,
  };
}

/** Advance along a polyline by `budget` cm. */
function moveAlong(pos: Vec2, path: readonly Vec2[], idx: number, budget: number): { pos: Vec2; idx: number } {
  let p = pos;
  let i = idx;
  let left = budget;
  while (left > 0 && i < path.length) {
    const target = path[i]!;
    const d = dist(p, target);
    if (d <= left) {
      p = target;
      left -= d;
      i++;
    } else {
      p = { x: p.x + ((target.x - p.x) * left) / d, y: p.y + ((target.y - p.y) * left) / d };
      left = 0;
    }
  }
  return { pos: p, idx: i };
}

function pathTo(world: World, from: Vec2, to: Vec2): Vec2[] {
  // Unreachable targets (isolated nav pockets) yield an empty path; callers then stop moving.
  return findPath(world.nav, from, to) ?? [];
}

/** Line of sight within view range. */
export function hasLos(world: World, a: Vec2, b: Vec2): boolean {
  return dist(a, b) <= VIEW_RANGE && segmentClear(world.map.walls, a, b);
}

function notices(world: World, e: EnemyState, p: Vec2, playerFired: boolean): boolean {
  if (!hasLos(world, e, p)) return false;
  const d = dist(e, p);
  if (d <= NEAR_NOTICE || (playerFired && d <= HEAR_RANGE)) return true;
  return d > 0 && (e.fx * (p.x - e.x) + e.fy * (p.y - e.y)) / d >= FOV_COS;
}

type Ctx = { rng: RngState };

function roll(ctx: Ctx): number {
  const [r, next] = nextFloat(ctx.rng);
  ctx.rng = next;
  return r;
}

function stepClutcher(world: World, s: SimState, input: Input, ctx: Ctx) {
  const c = s.clutcher;
  let mx = Math.max(-1, Math.min(1, input.move.x));
  let my = Math.max(-1, Math.min(1, input.move.y));
  const ml = Math.sqrt(mx * mx + my * my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  let x = c.x;
  let y = c.y;
  // Axis-separated slide against non-walkable cells.
  if (mx !== 0 && isWalkable(world.nav, { x: x + mx * STEP_LEN, y })) x += mx * STEP_LEN;
  if (my !== 0 && isWalkable(world.nav, { x, y: y + my * STEP_LEN })) y += my * STEP_LEN;
  const moving = x !== c.x || y !== c.y;

  let fireCd = Math.max(0, c.fireCd - 1);
  let fired = false;
  let shot: ShotEvent | null = null;
  let hitIdx = -1;
  const enemies = [...s.enemies];
  const aimDir = unit(input.aim.x - x, input.aim.y - y);
  if (input.fire && fireCd === 0 && aimDir) {
    fired = true;
    fireCd = PLAYER_FIRE_TICKS;
    const spread = (roll(ctx) * 2 - 1) * (moving ? SPREAD_MOVING : SPREAD_STILL);
    const dir = unit(aimDir.x - aimDir.y * spread, aimDir.y + aimDir.x * spread)!;
    const from = { x, y };
    const end = { x: x + dir.x * PLAYER_RANGE, y: y + dir.y * PLAYER_RANGE };
    const wallFrac = firstWallHit(world.map.walls, from, end);
    const maxD = wallFrac === Infinity ? PLAYER_RANGE : wallFrac * PLAYER_RANGE;
    let hitD = maxD;
    enemies.forEach((e, i) => {
      if (!e.alive) return;
      const ex = e.x - x;
      const ey = e.y - y;
      const along = ex * dir.x + ey * dir.y;
      if (along < 0 || along > hitD) return;
      if (Math.abs(ex * dir.y - ey * dir.x) <= ENEMY_HIT_RADIUS) {
        hitIdx = i;
        hitD = along;
      }
    });
    const to = { x: x + dir.x * hitD, y: y + dir.y * hitD };
    if (hitIdx >= 0) {
      const e = enemies[hitIdx]!;
      const hp = e.hp - PLAYER_DAMAGE;
      enemies[hitIdx] = { ...e, hp: Math.max(0, hp), alive: hp > 0 };
    }
    shot = { by: "P0", from, to, hit: hitIdx >= 0 ? enemies[hitIdx]!.id : null };
  }

  const { spikeActive } = clockAt(world, simTimeAt(world, s.tick + 1));
  const canDefuse =
    world.level.clutcherSide === "defense" &&
    spikeActive &&
    world.spike !== null &&
    input.use &&
    !moving &&
    !fired &&
    dist({ x, y }, world.spike) <= DEFUSE_RADIUS;
  const defuseTicks = canDefuse ? c.defuseTicks + 1 : 0;

  return {
    clutcher: { x, y, hp: c.hp, fireCd, defuseTicks, moving },
    enemies,
    shot,
    fired,
    hitIdx,
  };
}

/**
 * Bot hit chance per shot: falls off linearly with distance, reduced against a moving target and
 * when more than BOT_CROWD_BUDGET bots are engaged at once.
 */
export function botHitChance(d: number, targetMoving: boolean, engaged = 1): number {
  const p = Math.max(BOT_HIT_MIN, BOT_HIT_MAX - ((BOT_HIT_MAX - BOT_HIT_MIN) * d) / VIEW_RANGE);
  const crowd = Math.min(1, BOT_CROWD_BUDGET / Math.max(1, engaged));
  return (targetMoving ? p * BOT_MOVING_TARGET : p) * crowd;
}

/** Per-tick facts shared by every bot. */
type TickInfo = {
  /** Tick being produced. */
  readonly tick: number;
  readonly playerFired: boolean;
  readonly spikeActive: boolean;
  readonly secondsLeft: number;
  /** Bots in engage mode at the start of the tick. */
  readonly engaged: number;
};

function engageNow(e: EnemyState, pPos: Vec2, ctx: Ctx): EnemyState {
  const reaction = REACTION_MIN_S + roll(ctx) * (REACTION_MAX_S - REACTION_MIN_S);
  const f = unit(pPos.x - e.x, pPos.y - e.y) ?? { x: e.fx, y: e.fy };
  return {
    ...e,
    mode: "engage",
    fx: f.x,
    fy: f.y,
    lastSeen: pPos,
    reactTicks: Math.round(reaction * TICK_HZ),
    fireCd: 0,
    path: [],
    pathIdx: 0,
    defuseTicks: 0,
  };
}

/** Defenders (vs an attacking clutcher) go for the planted spike once their rail is spent or time is short. */
function wantsRetake(world: World, e: EnemyState, i: number, info: TickInfo): boolean {
  if (world.level.clutcherSide !== "attack" || !info.spikeActive || !world.spike) return false;
  if (e.railT >= world.enemyRails[i]!.rail.endT) return true;
  const travelS = dist(e, world.spike) / RUN_SPEED;
  return info.secondsLeft <= DEFUSE_S + travelS + RETAKE_MARGIN_S;
}

function stepEnemy(
  world: World,
  e: EnemyState,
  i: number,
  player: ClutcherState,
  wasHit: boolean,
  info: TickInfo,
  ctx: Ctx,
  shots: ShotEvent[],
): { e: EnemyState; damage: number } {
  if (!e.alive) return { e, damage: 0 };
  const t = e.railT;
  const rail = world.enemyRails[i]!.rail;
  const pPos = { x: player.x, y: player.y };
  // Unreachable targets are re-planned at most every REPATH_TICKS (staggered per bot) to bound A* cost.
  const mayRepath = (info.tick + i) % REPATH_TICKS === 0;

  if (e.mode === "engage") {
    if (!hasLos(world, e, pPos)) {
      const target = e.lastSeen ?? pPos;
      return {
        e: { ...e, mode: "hunt", path: pathTo(world, e, target), pathIdx: 0, huntTicks: HUNT_MAX_TICKS },
        damage: 0,
      };
    }
    const f = unit(pPos.x - e.x, pPos.y - e.y) ?? { x: e.fx, y: e.fy };
    const base = { ...e, fx: f.x, fy: f.y, lastSeen: pPos };
    if (e.reactTicks > 0) return { e: { ...base, reactTicks: e.reactTicks - 1 }, damage: 0 };
    if (e.fireCd > 0) return { e: { ...base, fireCd: e.fireCd - 1 }, damage: 0 };
    if (info.tick <= BOT_GRACE_TICKS) return { e: base, damage: 0 };
    const hit = roll(ctx) < botHitChance(dist(e, pPos), player.moving, info.engaged);
    shots.push({ by: e.id, from: { x: e.x, y: e.y }, to: pPos, hit: hit ? "P0" : null });
    return { e: { ...base, fireCd: BOT_FIRE_TICKS }, damage: hit ? BOT_DAMAGE : 0 };
  }

  // Taking fire always provokes a reaction, whatever the bot's facing or the distance.
  if (wasHit) {
    if (hasLos(world, e, pPos)) return { e: engageNow(e, pPos, ctx), damage: 0 };
    return {
      e: { ...e, mode: "hunt", lastSeen: pPos, path: pathTo(world, e, pPos), pathIdx: 0, huntTicks: HUNT_MAX_TICKS, defuseTicks: 0 },
      damage: 0,
    };
  }

  if (notices(world, e, pPos, info.playerFired)) return { e: engageNow(e, pPos, ctx), damage: 0 };

  // A defuse attempt is audible: everyone not fighting converges on the spike.
  if (player.defuseTicks === 1 && world.spike && e.mode === "rail") {
    return {
      e: { ...e, mode: "hunt", lastSeen: world.spike, path: pathTo(world, e, world.spike), pathIdx: 0, huntTicks: HUNT_MAX_TICKS },
      damage: 0,
    };
  }

  const face = (from: Vec2, to: Vec2): Vec2 => unit(to.x - from.x, to.y - from.y) ?? { x: e.fx, y: e.fy };

  if (e.mode === "defuse" && world.spike) {
    const spike = world.spike;
    const m = moveAlong(e, e.path, e.pathIdx, STEP_LEN);
    const f = face(e, m.pos);
    if (m.idx >= e.path.length) {
      if (dist(m.pos, spike) <= DEFUSE_RADIUS) {
        return { e: { ...e, ...m.pos, fx: f.x, fy: f.y, pathIdx: m.idx, defuseTicks: e.defuseTicks + 1 }, damage: 0 };
      }
      // No route (yet): stand and re-plan.
      const path = mayRepath ? pathTo(world, m.pos, spike) : [];
      return { e: { ...e, ...m.pos, fx: f.x, fy: f.y, path, pathIdx: 0, defuseTicks: 0 }, damage: 0 };
    }
    return { e: { ...e, ...m.pos, fx: f.x, fy: f.y, pathIdx: m.idx }, damage: 0 };
  }

  if (e.mode === "hunt") {
    const m = moveAlong(e, e.path, e.pathIdx, STEP_LEN);
    const f = face(e, m.pos);
    const huntTicks = e.huntTicks - 1;
    if (m.idx >= e.path.length || huntTicks <= 0) {
      const back = railPosition(rail, t);
      return {
        e: { ...e, ...m.pos, fx: f.x, fy: f.y, mode: "rail", onRail: false, path: pathTo(world, m.pos, back), pathIdx: 0, huntTicks: 0 },
        damage: 0,
      };
    }
    return { e: { ...e, ...m.pos, fx: f.x, fy: f.y, pathIdx: m.idx, huntTicks }, damage: 0 };
  }

  // Rail mode.
  if (wantsRetake(world, e, i, info) && world.spike) {
    return { e: { ...e, mode: "defuse", path: pathTo(world, e, world.spike), pathIdx: 0, defuseTicks: 0 }, damage: 0 };
  }
  if (!e.onRail) {
    const back = railPosition(rail, t);
    const m = moveAlong(e, e.path, e.pathIdx, STEP_LEN);
    const f = face(e, m.pos);
    if (m.idx >= e.path.length) {
      // Rejoin only from (almost) the frozen rail point — never teleport across the map when no route exists.
      if (dist(m.pos, back) <= NAV_CELL) {
        return { e: { ...e, x: back.x, y: back.y, fx: f.x, fy: f.y, onRail: true, path: [], pathIdx: 0 }, damage: 0 };
      }
      const path = mayRepath ? pathTo(world, m.pos, back) : [];
      return { e: { ...e, ...m.pos, fx: f.x, fy: f.y, path, pathIdx: 0 }, damage: 0 };
    }
    return { e: { ...e, ...m.pos, fx: f.x, fy: f.y, pathIdx: m.idx }, damage: 0 };
  }
  const railT = t + DT;
  const p = railPosition(rail, railT);
  const f = face(e, p);
  return { e: { ...e, x: p.x, y: p.y, fx: f.x, fy: f.y, railT }, damage: 0 };
}

function decide(world: World, s: Omit<SimState, "outcome">): SimOutcome | null {
  const t = simTimeAt(world, s.tick);
  if (s.clutcher.defuseTicks >= DEFUSE_TICKS) return { winner: "clutcher", reason: "defuse", t };
  if (s.enemies.some((e) => e.alive && e.defuseTicks >= DEFUSE_TICKS)) return { winner: "enemies", reason: "defuse", t };
  const clock = clockAt(world, t);
  // A defending clutcher facing a planted spike still has to defuse it after the last kill.
  const mustDefuse = world.level.clutcherSide === "defense" && clock.spikeActive;
  if (!mustDefuse && s.enemies.every((e) => !e.alive)) return { winner: "clutcher", reason: "elimination", t };
  if (s.clutcher.hp <= 0) return { winner: "enemies", reason: "death", t };
  if (clock.secondsLeft <= 0) {
    const attackerWins = clock.spikeActive;
    const clutcherWins = (world.level.clutcherSide === "attack") === attackerWins;
    return { winner: clutcherWins ? "clutcher" : "enemies", reason: clock.spikeActive ? "detonate" : "time", t };
  }
  return null;
}

/** Pure step: (state, input) → next state. No mutation of inputs. */
export function step(world: World, s: SimState, input: Input): SimState {
  if (s.outcome) return s;
  const ctx: Ctx = { rng: s.rng };
  const tick = s.tick + 1;
  const pc = stepClutcher(world, s, input, ctx);
  const clock = clockAt(world, simTimeAt(world, tick));
  const info: TickInfo = {
    tick,
    playerFired: pc.fired,
    spikeActive: clock.spikeActive,
    secondsLeft: clock.secondsLeft,
    engaged: s.enemies.filter((e) => e.alive && e.mode === "engage").length,
  };
  const shots: ShotEvent[] = pc.shot ? [pc.shot] : [];
  let damage = 0;
  // Simultaneous resolution: a bot killed by this tick's player shot still acts (and may shoot)
  // this tick, so trades happen; it is removed afterwards.
  const enemies = pc.enemies.map((after, i) => {
    if (!s.enemies[i]!.alive) return after;
    const r = stepEnemy(world, { ...after, alive: true }, i, pc.clutcher, i === pc.hitIdx, info, ctx, shots);
    damage += r.damage;
    return after.alive ? r.e : after;
  });
  const hp = Math.max(0, pc.clutcher.hp - damage);
  const killed = s.enemies.filter((e, i) => e.alive && !enemies[i]!.alive).length;
  const next = {
    tick,
    rng: ctx.rng,
    clutcher: { ...pc.clutcher, hp },
    enemies,
    shots,
    stats: {
      kills: s.stats.kills + killed,
      shotsFired: s.stats.shotsFired + (pc.fired ? 1 : 0),
      hits: s.stats.hits + (pc.shot?.hit ? 1 : 0),
      damageTaken: s.stats.damageTaken + (s.clutcher.hp - hp),
    },
  };
  return { ...next, outcome: decide(world, next) };
}

/** Replays a recording from the initial state. Commands must be in tick order, one per tick. */
export function replay(world: World, seed: number, commands: readonly Command[]): SimState {
  let s = initState(world, seed);
  for (const cmd of commands) {
    if (s.outcome) break;
    if (cmd.tick !== s.tick + 1) throw new Error(`replay: command for tick ${cmd.tick} at state tick ${s.tick}`);
    s = step(world, s, cmd);
  }
  return s;
}
