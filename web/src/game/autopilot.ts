import type { ActorId } from "../level/types";
import { DEFUSE_RADIUS, PLAYER_RANGE, TICK_HZ } from "../sim/constants";
import { dist, segmentClear, type Vec2 } from "../sim/geom";
import { findPath } from "../sim/nav";
import { clockAt, simTimeAt, type EnemyState, type Input, type SimState } from "../sim/sim";
import type { World } from "../sim/world";

/** Human-like delay between an enemy coming into view and the first shot. */
export const AUTOPILOT_REACTION_S = 0.45;
/** An attacking autopilot guards the planted spike from this far away. */
const GUARD_DIST = 800;
const WAYPOINT_REACHED = 40;

export type Autopilot = (s: SimState) => Input;

/**
 * Scripted "average player" for kiosk demo (?auto) and the balance harness. Deterministic and
 * free of randomness; holds small per-round memory, so create one per round. Shoots the nearest
 * visible enemy (standing still) after a reaction delay; otherwise walks to a planted spike and
 * defuses it (defense) or guards it (attack).
 */
export function createAutopilot(world: World, reactionS = AUTOPILOT_REACTION_S): Autopilot {
  const reactionTicks = Math.round(reactionS * TICK_HZ);
  const defense = world.level.clutcherSide === "defense";
  let route: readonly Vec2[] | null = null;
  let routeIdx = 0;
  let targetId: ActorId | null = null;
  let seenTicks = 0;

  return (s) => {
    const p = s.clutcher;
    let best: EnemyState | null = null;
    let bestD = Infinity;
    for (const e of s.enemies) {
      if (!e.alive) continue;
      const d = dist(p, e);
      if (d < bestD && d <= PLAYER_RANGE && segmentClear(world.map.walls, p, e)) {
        bestD = d;
        best = e;
      }
    }
    if (best) {
      seenTicks = best.id === targetId ? seenTicks + 1 : 1;
      targetId = best.id;
      return { move: { x: 0, y: 0 }, aim: { x: best.x, y: best.y }, fire: seenTicks > reactionTicks, use: false };
    }
    targetId = null;
    seenTicks = 0;

    const spike = world.spike;
    if (spike && clockAt(world, simTimeAt(world, s.tick)).spikeActive) {
      const d = dist(p, spike);
      const holding = defense ? d <= DEFUSE_RADIUS / 2 : d <= GUARD_DIST && segmentClear(world.map.walls, p, spike);
      if (holding) {
        return { move: { x: 0, y: 0 }, aim: { x: spike.x, y: spike.y - 1 }, fire: false, use: defense };
      }
      route ??= findPath(world.nav, p, spike) ?? [];
      while (routeIdx < route.length && dist(p, route[routeIdx]!) < WAYPOINT_REACHED) routeIdx++;
      const to = route[routeIdx] ?? spike;
      const l = dist(p, to);
      const move = l > 0 ? { x: (to.x - p.x) / l, y: (to.y - p.y) / l } : { x: 0, y: 0 };
      return { move, aim: { x: to.x, y: to.y }, fire: false, use: false };
    }
    return { move: { x: 0, y: 0 }, aim: { x: p.x, y: p.y - 1 }, fire: false, use: false };
  };
}
