import type { ActorView, DownView, FrameView, SpikeView, TracerView } from "../render/renderer";
import { DEFUSE_S, TICK_HZ } from "../sim/constants";
import { segmentClear, type Vec2 } from "../sim/geom";
import { clockAt, simTimeAt, type ShotEvent, type SimState } from "../sim/sim";
import type { World } from "../sim/world";
import { proFrameAt, tickAtTime } from "./replayModel";

/**
 * Pure builders for what each view draws per frame (live play, YOU and PRO replay panels). No
 * renderer, browser or clock access: the caller passes time and the reduced-motion preference.
 */

/** Live shot tracers stay visible this long (ms). */
export const TRACER_MS = 120;
/** Shot tracers stay visible for this many ticks in the replay (≈ the live 120 ms). */
export const TRACER_TICKS = 4;

export type LiveTracer = { readonly shot: ShotEvent; readonly untilMs: number };

const DEFUSE_FULL = DEFUSE_S * TICK_HZ;

function spikeAt(world: World, t: number, v: SpikeView): (Vec2 & SpikeView) | null {
  const sp = world.spike;
  if (!sp || !clockAt(world, t).spikeActive) return null;
  return { x: sp.x, y: sp.y, ...v };
}

/** Enemies in visit order: dead ones become downs, living ones bodies; `z` = enemy index. */
function enemyViews(s: SimState, visible: (e: SimState["enemies"][number]) => boolean): { enemies: ActorView[]; downs: DownView[] } {
  const enemies: ActorView[] = [];
  const downs: DownView[] = [];
  s.enemies.forEach((e, z) => {
    if (!e.alive) downs.push({ x: e.x, y: e.y, side: "enemy", z });
    else if (visible(e)) enemies.push({ x: e.x, y: e.y, fx: e.fx, fy: e.fy, z });
  });
  return { enemies, downs };
}

/** Live play: fog of war (only enemies in the clutcher's line of sight), pulsing spike, wall-time tracers. */
export function liveFrame(
  world: World,
  s: SimState,
  aim: Vec2 | null,
  tracers: readonly LiveTracer[],
  nowMs: number,
  opts: { readonly reducedMotion?: boolean } = {},
): FrameView {
  const p = s.clutcher;
  const enemyTicks = Math.max(0, ...s.enemies.filter((e) => e.alive).map((e) => e.defuseTicks));
  const spike = spikeAt(world, simTimeAt(world, s.tick), {
    defuse: p.defuseTicks / DEFUSE_FULL,
    enemyDefuse: enemyTicks / DEFUSE_FULL,
    pulseT: opts.reducedMotion ? null : nowMs / 1000,
  });
  const { enemies, downs } = enemyViews(s, (e) => segmentClear(world.map.walls, p, e));
  const tracerViews: TracerView[] = tracers.map(({ shot, untilMs }) => ({ shot, fade: (untilMs - nowMs) / TRACER_MS + 0.3 }));
  // The body stays drawn on the death tick too (the score screen follows right after).
  return { player: { x: p.x, y: p.y, aim }, enemies, downs, spike, tracers: tracerViews };
}

/** YOU replay panel at level-time t: no fog, still spike, tracers of the last TRACER_TICKS ticks. */
export function youFrame(world: World, timeline: readonly SimState[], t: number): FrameView {
  const tick = tickAtTime(world, t, timeline.length);
  // Clamped: holds the final state once the player's round is over.
  const s = timeline[tick]!;
  const p = s.clutcher;
  // Still (no pulse): the replay is scrubbed, a pulse tied to wall time would jitter.
  const spike = spikeAt(world, t, { defuse: p.defuseTicks / DEFUSE_FULL, pulseT: null });
  const { enemies, downs } = enemyViews(s, () => true);
  const alive = p.hp > 0;
  if (!alive) downs.push({ x: p.x, y: p.y, side: "player", z: s.enemies.length });
  const tracers: TracerView[] = [];
  for (let k = Math.max(1, tick - TRACER_TICKS + 1); k <= tick; k++) {
    const fade = 1 - (tick - k) / TRACER_TICKS;
    for (const shot of timeline[k]!.shots) tracers.push({ shot, fade });
  }
  // The recorded round has no aim data per tick here: body only.
  return { player: alive ? { x: p.x, y: p.y, aim: null } : null, enemies, downs, spike, tracers };
}

/** PRO replay panel at level-time t, from the event data: kills as downs, enemies without facing. */
export function proFrame(world: World, t: number): FrameView {
  const f = proFrameAt(world, world.level, t);
  const downs: DownView[] = f.kills.map((k, z) => ({ x: k.at.x, y: k.at.y, side: k.victim === "P0" ? "player" : "enemy", z }));
  const enemies: ActorView[] = f.enemies.map((e, i) => ({ x: e.x, y: e.y, z: f.kills.length + i }));
  return {
    player: f.clutcherAlive ? { x: f.clutcher.x, y: f.clutcher.y, aim: null } : null,
    enemies,
    downs,
    spike: spikeAt(world, t, { defuse: 0, pulseT: null }),
    tracers: [],
  };
}
