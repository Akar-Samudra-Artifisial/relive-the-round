import type { Level } from "../level/types";
import type { SimOutcome, SimState } from "../sim/sim";

export type ScoreCard = {
  readonly won: boolean;
  readonly reason: SimOutcome["reason"];
  /** Seconds from round start to decision. */
  readonly timeS: number;
  readonly hpLeft: number;
  readonly kills: number;
  readonly enemies: number;
  readonly accuracy: number;
  readonly proWon: boolean;
  readonly proTimeS: number;
  readonly points: number;
};

const WIN_POINTS = 1000;
const KILL_POINTS = 250;
const HP_POINTS = 5;
/** Per second faster than the pro (wins only). */
const SPEED_POINTS = 20;

export function scoreRound(level: Level, s: SimState): ScoreCard {
  if (!s.outcome) throw new Error("score: round is not decided yet");
  const won = s.outcome.winner === "clutcher";
  const timeS = s.outcome.t;
  const proTimeS = level.outcome.t;
  const hpLeft = s.clutcher.hp;
  const { kills, shotsFired, hits } = s.stats;
  const points =
    (won ? WIN_POINTS + HP_POINTS * hpLeft + Math.max(0, Math.round((proTimeS - timeS) * SPEED_POINTS)) : 0) +
    KILL_POINTS * kills;
  return {
    won,
    reason: s.outcome.reason,
    timeS,
    hpLeft,
    kills,
    enemies: level.enemies.length,
    accuracy: shotsFired > 0 ? hits / shotsFired : 0,
    proWon: level.clutcherWon,
    proTimeS,
    points,
  };
}
