import type { Vec2 } from "./geom";
import { findPath, snap, type NavGrid } from "./nav";
import { warpUV, type Warp } from "./warp";

export type RailSample = { readonly t: number; readonly u: number; readonly v: number };
export type RailKey = { readonly t: number; readonly x: number; readonly y: number };

/** Timed polyline; position(t) is piecewise-linear between keys and clamped at both ends. */
export type Rail = {
  readonly keys: readonly RailKey[];
  /** Snapped world position of each input sample, in order (rail passes through all of them). */
  readonly anchors: readonly Vec2[];
  /** Time the rail ends (death or last sample); position holds afterwards. */
  readonly endT: number;
};

/**
 * Build a speed-limited rail from uv samples: warp → snap → A* between consecutive samples.
 * If the data moves faster than `speed` allows along the nav path, the rail lags and catches up
 * when the actor idles; it never exceeds `speed`.
 */
export function buildRail(
  samples: readonly RailSample[],
  warp: Warp,
  nav: NavGrid,
  speed: number,
  diedT?: number,
): Rail {
  const live = samples.filter((s) => diedT === undefined || s.t <= diedT);
  if (live.length === 0) throw new Error("rail: no samples before diedT");
  for (let i = 1; i < live.length; i++) {
    if (!(live[i]!.t >= live[i - 1]!.t)) throw new Error(`rail: samples not time-ordered at index ${i}`);
  }
  const anchors = live.map((s) => snap(nav, warpUV(warp, s.u, s.v)));
  const keys: RailKey[] = [{ t: live[0]!.t, x: anchors[0]!.x, y: anchors[0]!.y }];
  let cursorT = live[0]!.t;
  for (let i = 1; i < live.length; i++) {
    const from = anchors[i - 1]!;
    const to = anchors[i]!;
    if (from.x === to.x && from.y === to.y) continue;
    const path = findPath(nav, from, to);
    if (!path) throw new Error(`rail: no nav path between samples ${i - 1} and ${i}`);
    const lens: number[] = [];
    let total = 0;
    for (let k = 1; k < path.length; k++) {
      const dx = path[k]!.x - path[k - 1]!.x;
      const dy = path[k]!.y - path[k - 1]!.y;
      const l = Math.sqrt(dx * dx + dy * dy);
      lens.push(l);
      total += l;
    }
    // Leave as late as possible so idle time is spent at `from`, moving at most at `speed`.
    const minDur = total / speed;
    const arrive = Math.max(live[i]!.t, cursorT + minDur);
    const depart = arrive - minDur;
    if (depart > cursorT) keys.push({ t: depart, x: from.x, y: from.y });
    let acc = 0;
    for (let k = 1; k < path.length; k++) {
      acc += lens[k - 1]!;
      const t = k === path.length - 1 ? arrive : depart + acc / speed;
      keys.push({ t, x: path[k]!.x, y: path[k]!.y });
    }
    cursorT = arrive;
  }
  const lastT = keys[keys.length - 1]!.t;
  const endT = diedT !== undefined ? Math.max(lastT, diedT) : lastT;
  return { keys, anchors, endT };
}

export function railPosition(rail: Rail, t: number): Vec2 {
  const k = rail.keys;
  const first = k[0]!;
  if (t <= first.t) return { x: first.x, y: first.y };
  const last = k[k.length - 1]!;
  if (t >= last.t) return { x: last.x, y: last.y };
  let lo = 0;
  let hi = k.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (k[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = k[lo]!;
  const b = k[hi]!;
  const span = b.t - a.t;
  const f = span > 0 ? (t - a.t) / span : 1;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
