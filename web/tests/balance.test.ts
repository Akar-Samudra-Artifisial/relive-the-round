import { describe, expect, it } from "vitest";
import { balanceRow, type BalanceRow } from "../src/game/balance";
import { FEATURED } from "../src/game/levels";
import type { Level } from "../src/level/types";
import { mapFor } from "../src/maps";
import { buildWorld } from "../src/sim/world";

// Real ETL output (git-ignored); the harness is skipped on a fresh clone.
const byFile = import.meta.glob<Level>(["../../data/levels/haven/*.json", "!**/index.json"], { eager: true, import: "default" });
const featured = FEATURED.map((f) => Object.entries(byFile).find(([path]) => path.endsWith(`/${f.file}`))?.[1]).filter(
  (l): l is Level => l !== undefined,
);

const SEEDS = 50;
/** Allowed drift of the win rate from the locked value. */
const WIN_RATE_TOLERANCE = 0.1;
/** Design target: a won round should last at least this long (s of play). */
const MIN_MEDIAN_WIN_S = 4;

function fmt(r: BalanceRow): string {
  return `${r.levelId} win ${(r.winRate * 100).toFixed(0)}% medianWin ${r.medianWinS.toFixed(2)}s firstLoss ${r.firstLossS.toFixed(2)}s ${JSON.stringify(r.reasons)}`;
}

/**
 * Locked win rates of the current tuning (sim is deterministic, so these only move when sim rules,
 * constants, the autopilot or the level data change). The design targets (25–65%, median ≥ 4 s)
 * are the hard limits.
 */
const LOCKED_WIN_RATE: Readonly<Record<string, number>> = {
  df244e8f378d: 0.38,
  "010a7b04f8c3": 0.6,
  bc9dc2b1daac: 0.38,
};

describe.skipIf(featured.length !== FEATURED.length)("balance harness (3 featured levels × 50 seeds)", () => {
  const worlds = featured.map((l) => buildWorld(mapFor(l.map), l));

  it("autopilot: win rate 25–65% per level, median winning round ≥ 4 s", (ctx) => {
    const unknown = worlds.map((w) => w.level.id).filter((id) => !(id in LOCKED_WIN_RATE));
    if (unknown.length > 0) {
      ctx.skip(`no locked balance numbers for level(s) ${unknown.join(", ")}: run the harness and add them to LOCKED_WIN_RATE`);
    }
    for (const w of worlds) {
      const r = balanceRow(w, "autopilot", SEEDS);
      console.info(`autopilot ${fmt(r)}`);
      expect(r.winRate, r.levelId).toBeGreaterThanOrEqual(0.25);
      expect(r.winRate, r.levelId).toBeLessThanOrEqual(0.65);
      expect(r.medianWinS, r.levelId).toBeGreaterThanOrEqual(MIN_MEDIAN_WIN_S);
      const drift = Math.abs(r.winRate - LOCKED_WIN_RATE[r.levelId]!);
      expect(drift, `${r.levelId} win rate drifted`).toBeLessThanOrEqual(WIN_RATE_TOLERANCE);
    }
  });

  it("idle player loses every round, never before ~2 s", () => {
    for (const w of worlds) {
      const r = balanceRow(w, "idle", SEEDS);
      console.info(`idle ${fmt(r)}`);
      expect(r.winRate, r.levelId).toBe(0);
      expect(r.firstLossS, r.levelId).toBeGreaterThanOrEqual(2);
    }
  });
});
