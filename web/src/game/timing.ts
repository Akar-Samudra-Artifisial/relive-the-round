import { SPIKE_TIMER_S } from "../sim/constants";
import { simTimeAt } from "../sim/sim";
import type { World } from "../sim/world";

/** "3-2-1" before the sim starts. */
export const COUNTDOWN_S = 3;
/** Score screen returns to attract on its own after this long. */
export const SCORE_RETURN_S = 15;
/** Hard cap on the replay screen; after this the kiosk returns to attract. */
export const REPLAY_MAX_S = 45;
/** Event rule: one player's turn (start → play → score → back to attract) fits in 3 minutes. */
export const MAX_SESSION_S = 180;

/** Level-time at which the round clock decides the round (time or detonation), mirroring `clockAt`. */
export function roundEndT(world: World): number {
  const { level } = world;
  const plantT = level.spike.plantT;
  const counts = level.spike.planted && plantT !== undefined && (level.plantedAtStart || level.clutcherSide === "defense");
  if (!counts || plantT > level.startClockS) return level.startClockS;
  const detonateT = level.plantedAtStart ? level.startClockS : plantT + SPIKE_TIMER_S;
  return Math.max(plantT, detonateT);
}

/** Longest possible round (s of play) for this level. */
export function roundLimitS(world: World): number {
  return roundEndT(world) - simTimeAt(world, 0);
}

/** Slack on top of countdown + round limit before the play-screen safety net fires (frame stalls). */
export const PLAY_GUARD_MARGIN_S = 5;

/** Wall time after which an undecided play screen is abandoned (countdown + longest round + margin). */
export function playGuardS(roundLimit: number): number {
  return COUNTDOWN_S + roundLimit + PLAY_GUARD_MARGIN_S;
}

/**
 * Safety net for the 3-minute rule: only an undecided round that has outlived its guard is cut;
 * a round with an outcome always goes on to the score screen.
 */
export function shouldAbortPlay(elapsedMs: number, decided: boolean, roundLimit: number): boolean {
  return !decided && elapsedMs > playGuardS(roundLimit) * 1000;
}

/** Worst-case wall time of one turn: play screen up to its guard + unattended score screen. */
export function sessionBudgetS(world: World): number {
  return playGuardS(roundLimitS(world)) + SCORE_RETURN_S;
}
