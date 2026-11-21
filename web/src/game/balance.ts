import { TICK_HZ } from "../sim/constants";
import { initState, step, type Input, type SimState } from "../sim/sim";
import type { World } from "../sim/world";
import { createAutopilot } from "./autopilot";
import { roundLimitS } from "./timing";

export type Pilot = "autopilot" | "idle";

/** Plays one full round headless (no countdown: it does not touch the sim). */
export function playRound(world: World, seed: number, pilot: Pilot): SimState {
  const control: (s: SimState) => Input = pilot === "autopilot" ? createAutopilot(world) : () => ({ move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, fire: false, use: false });
  const maxTicks = Math.ceil((roundLimitS(world) + 1) * TICK_HZ);
  let s = initState(world, seed);
  for (let i = 0; i < maxTicks && !s.outcome; i++) s = step(world, s, control(s));
  if (!s.outcome) throw new Error(`playRound: level ${world.level.id} seed ${seed} undecided after ${maxTicks} ticks`);
  return s;
}

export type BalanceRow = {
  readonly levelId: string;
  readonly rounds: number;
  readonly winRate: number;
  /** Median seconds of play in rounds the pilot won (NaN without wins). */
  readonly medianWinS: number;
  /** Earliest loss (s of play); Infinity without losses. */
  readonly firstLossS: number;
  readonly reasons: Readonly<Record<string, number>>;
};

function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/** Deterministic balance sweep: one round per seed (seeds 1..n). */
export function balanceRow(world: World, pilot: Pilot, n: number): BalanceRow {
  const wins: number[] = [];
  const losses: number[] = [];
  const reasons: Record<string, number> = {};
  for (let seed = 1; seed <= n; seed++) {
    const s = playRound(world, seed, pilot);
    const o = s.outcome!;
    const playS = s.tick / TICK_HZ;
    (o.winner === "clutcher" ? wins : losses).push(playS);
    const key = `${o.winner === "clutcher" ? "win" : "loss"}:${o.reason}`;
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
  return {
    levelId: world.level.id,
    rounds: n,
    winRate: wins.length / n,
    medianWinS: median(wins),
    firstLossS: losses.length > 0 ? Math.min(...losses) : Infinity,
    reasons,
  };
}
