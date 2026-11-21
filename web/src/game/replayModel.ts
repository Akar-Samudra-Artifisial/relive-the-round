import type { ActorId, Kill, Level } from "../level/types";
import { DT } from "../sim/constants";
import type { Vec2 } from "../sim/geom";
import { railPosition } from "../sim/rail";
import { initState, simTimeAt, step, type Command, type SimState } from "../sim/sim";
import { warpUV } from "../sim/warp";
import type { World } from "../sim/world";

/**
 * Every state of the player's round, index = tick (states[0] = initState). Computed once so
 * scrubbing is an O(1) lookup. Same rules as `replay()`: commands in tick order, one per tick,
 * stops at the outcome.
 */
export function buildYouTimeline(world: World, seed: number, commands: readonly Command[]): SimState[] {
  let s = initState(world, seed);
  const states: SimState[] = [s];
  for (const cmd of commands) {
    if (s.outcome) break;
    if (cmd.tick !== s.tick + 1) throw new Error(`replay: command for tick ${cmd.tick} at state tick ${s.tick}`);
    s = step(world, s, cmd);
    states.push(s);
  }
  return states;
}

/** Shared replay clock: both panels run on level-time t (s); tick 0 = first clutcher sample. */
export function timeOfTick(world: World, tick: number): number {
  return simTimeAt(world, tick);
}

/** Nearest tick at level-time t, clamped to the timeline. */
export function tickAtTime(world: World, t: number, timelineLength: number): number {
  const tick = Math.round((t - simTimeAt(world, 0)) / DT);
  return Math.min(Math.max(0, tick), Math.max(0, timelineLength - 1));
}

/** Player state shown at level-time t (holds the last state after the round ended). */
export function youStateAt(world: World, timeline: readonly SimState[], t: number): SimState {
  if (timeline.length === 0) throw new Error("replay: empty timeline");
  return timeline[tickAtTime(world, t, timeline.length)]!;
}

/** Replay span [startT, endT]: from tick 0 until both the player's and the pro's round are over. */
export function replaySpan(world: World, timeline: readonly SimState[]): { startT: number; endT: number } {
  const startT = simTimeAt(world, 0);
  const youEnd = simTimeAt(world, Math.max(0, timeline.length - 1));
  return { startT, endT: Math.max(startT, youEnd, world.level.outcome.t) };
}

export type ProEnemy = { readonly id: ActorId; readonly x: number; readonly y: number };
export type ProKill = Kill & { readonly at: Vec2 };

export type ProFrame = {
  readonly t: number;
  readonly clutcher: Vec2;
  readonly clutcherAlive: boolean;
  /** Enemies still alive at t (an enemy disappears at its diedT). */
  readonly enemies: readonly ProEnemy[];
  /** Kill events with t ≤ frame t; `at` = victim position on our map. */
  readonly kills: readonly ProKill[];
};

/** The pro's round at level-time t, reconstructed from the event data (rails + kill feed). */
export function proFrameAt(world: World, level: Level, t: number): ProFrame {
  const clutcher = railPosition(world.clutcherRail, t);
  const clutcherAlive = level.clutcher.diedT === undefined || t < level.clutcher.diedT;
  const enemies: ProEnemy[] = [];
  world.enemyRails.forEach(({ rail }, i) => {
    const actor = level.enemies[i];
    if (!actor || (actor.diedT !== undefined && t >= actor.diedT)) return;
    const p = railPosition(rail, t);
    enemies.push({ id: actor.id, x: p.x, y: p.y });
  });
  const kills = level.kills
    .filter((k) => k.t <= t)
    .map((k) => ({ ...k, at: warpUV(world.warp, k.victimUV[0], k.victimUV[1]) }));
  return { t, clutcher, clutcherAlive, enemies, kills };
}
