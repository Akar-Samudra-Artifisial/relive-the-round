import { DEFUSE_S, DT, RUN_SPEED, TICK_HZ } from "../sim/constants";
import type { SimState, SimStats } from "../sim/sim";

/**
 * Sound events from the live round (pure: no DOM, no Web Audio). `track` compares the previous
 * frame's snapshot with this one; a frame may cover several sim ticks, so counters come from the
 * cumulative `stats` instead of `state.shots` (which only holds the last tick).
 */

/** Enemy footsteps are audible even while the enemy is hidden by fog of war. Set false to only hear your own. */
export const ENEMY_FOOTSTEPS = true;
/** One footstep per this many cm walked (about 11 ticks at run speed). */
export const STEP_CM = 190;
/** Enemy footsteps are heard within this distance (cm). */
export const ENEMY_STEP_RANGE_CM = 1500;
/** Enemy footstep loudness right next to the player (1 = as loud as your own). */
export const ENEMY_STEP_GAIN = 0.6;
/** Bot shot loudness: 1 / (1 + (d / SHOT_FALLOFF_CM)^2). */
export const SHOT_FALLOFF_CM = 1500;
/** A horizontal offset of this many cm pans fully left/right. */
export const PAN_SPAN_CM = 2500;
/** Minimum gap between two bot shot sounds. */
export const BOT_SHOT_GAP_MS = 40;
/** Defuse progress tick every this many sim ticks (0.5 s). */
export const DEFUSE_TICK_EVERY = 15;
/** At most this many repeats of one event kind per frame (a stalled tab catches up in bursts). */
export const MAX_REPEAT = 3;

const DEFUSE_TICKS = Math.round(DEFUSE_S * TICK_HZ);

export type AudioEvent =
  | {
      readonly kind:
        | "shot"
        | "hit"
        | "kill"
        | "hurt"
        | "death"
        | "explosion"
        | "win"
        | "lose"
        | "defuseStart"
        | "defuseDone"
        | "enemyDefuse";
    }
  | { readonly kind: "botShot"; readonly gain: number; readonly pan: number }
  | { readonly kind: "step"; readonly enemy: boolean; readonly gain: number; readonly pan: number }
  | { readonly kind: "defuseTick"; readonly progress: number }
  | { readonly kind: "beep"; readonly hz: number }
  | { readonly kind: "countdown"; readonly go: boolean };

export type PlaySnapshot = {
  /** The Session object: a new identity starts a fresh tracker. */
  readonly session: object;
  /** Whole seconds left on the pre-round countdown (0 once the round runs). */
  readonly countdown: number;
  readonly state: SimState;
  readonly clock: { readonly secondsLeft: number; readonly spikeActive: boolean };
  /** Frame clock (ms), used for the bot shot gap. */
  readonly nowMs: number;
};

type Walker = { readonly x: number; readonly y: number; readonly acc: number };

export type Tracker = {
  readonly session: object;
  readonly tick: number;
  readonly countdown: number;
  readonly stats: SimStats;
  readonly player: Walker;
  /** Per enemy (same index as `state.enemies`); null while dead. */
  readonly enemies: readonly (Walker | null)[];
  readonly defuseTicks: number;
  readonly enemyDefusing: boolean;
  /** Seconds of sim time since the last spike beep. */
  readonly beepAcc: number;
  readonly outcome: boolean;
  readonly lastBotShotMs: number;
};

/** Spike beep rate (Hz) for the seconds left on the spike timer. */
export function beepHz(secondsLeft: number): number {
  if (secondsLeft > 20) return 1;
  if (secondsLeft > 10) return 2;
  if (secondsLeft > 5) return 4;
  return 8;
}

export function panFor(dx: number): number {
  return Math.max(-1, Math.min(1, dx / PAN_SPAN_CM));
}

export function shotGain(distanceCm: number): number {
  return 1 / (1 + (distanceCm / SHOT_FALLOFF_CM) ** 2);
}

/** Large first value: the first beep after the plant sounds right away. */
const BEEP_IDLE = 10;

function fresh(snap: PlaySnapshot): Tracker {
  const s = snap.state;
  return {
    session: snap.session,
    tick: s.tick,
    countdown: snap.countdown,
    stats: s.stats,
    player: { x: s.clutcher.x, y: s.clutcher.y, acc: 0 },
    // Staggered start so enemies walking together do not step in unison.
    enemies: s.enemies.map((e, i) => (e.alive ? { x: e.x, y: e.y, acc: (i * 53) % STEP_CM } : null)),
    defuseTicks: s.clutcher.defuseTicks,
    enemyDefusing: s.enemies.some((e) => e.alive && e.defuseTicks > 0),
    beepAcc: BEEP_IDLE,
    outcome: s.outcome !== null,
    lastBotShotMs: -Infinity,
  };
}

function repeat(n: number, ev: AudioEvent, out: AudioEvent[]): void {
  for (let i = 0; i < Math.min(MAX_REPEAT, n); i++) out.push(ev);
}

/** Walk accumulator: returns the new walker and whether a footstep falls in this frame. */
function walk(prev: Walker, x: number, y: number, maxCm: number): { w: Walker; step: boolean } {
  const d = Math.hypot(x - prev.x, y - prev.y);
  // A jump (respawn, rail rejoin) is not walking.
  if (d > maxCm) return { w: { x, y, acc: prev.acc }, step: false };
  const acc = prev.acc + d;
  return acc >= STEP_CM ? { w: { x, y, acc: acc % STEP_CM }, step: true } : { w: { x, y, acc }, step: false };
}

/**
 * One frame: previous tracker (null on the first frame) + snapshot → next tracker and the sound
 * events in play order. A different session object resets the tracker (only the countdown beep).
 */
export function track(prev: Tracker | null, snap: PlaySnapshot): { next: Tracker; events: AudioEvent[] } {
  const events: AudioEvent[] = [];
  if (!prev || prev.session !== snap.session) {
    if (snap.countdown > 0) events.push({ kind: "countdown", go: false });
    return { next: fresh(snap), events };
  }

  if (snap.countdown !== prev.countdown) {
    if (snap.countdown > 0) events.push({ kind: "countdown", go: false });
    else if (prev.countdown > 0) events.push({ kind: "countdown", go: true });
  }
  const s = snap.state;
  const ticks = s.tick - prev.tick;
  if (ticks <= 0) return { next: { ...prev, countdown: snap.countdown }, events };

  const d = (k: keyof SimStats): number => Math.max(0, s.stats[k] - prev.stats[k]);
  repeat(d("shotsFired"), { kind: "shot" }, events);

  const me = s.clutcher;
  let lastBotShotMs = prev.lastBotShotMs;
  for (const shot of s.shots) {
    if (shot.by === "P0" || snap.nowMs - lastBotShotMs < BOT_SHOT_GAP_MS) continue;
    lastBotShotMs = snap.nowMs;
    const dist = Math.hypot(shot.from.x - me.x, shot.from.y - me.y);
    events.push({ kind: "botShot", gain: shotGain(dist), pan: panFor(shot.from.x - me.x) });
  }
  repeat(d("hits"), { kind: "hit" }, events);
  repeat(d("kills"), { kind: "kill" }, events);
  if (d("damageTaken") > 0 && me.hp > 0) events.push({ kind: "hurt" });

  const maxCm = RUN_SPEED * DT * ticks * 1.5;
  const pw = walk(prev.player, me.x, me.y, maxCm);
  if (pw.step) events.push({ kind: "step", enemy: false, gain: 1, pan: 0 });
  const enemies = s.enemies.map((e, i): Walker | null => {
    if (!e.alive) return null;
    const before = prev.enemies[i];
    if (!before) return { x: e.x, y: e.y, acc: 0 };
    const r = walk(before, e.x, e.y, maxCm);
    if (r.step && ENEMY_FOOTSTEPS) {
      const dist = Math.hypot(e.x - me.x, e.y - me.y);
      if (dist < ENEMY_STEP_RANGE_CM) {
        events.push({ kind: "step", enemy: true, gain: ENEMY_STEP_GAIN * (1 - dist / ENEMY_STEP_RANGE_CM), pan: panFor(e.x - me.x) });
      }
    }
    return r.w;
  });

  const dt = me.defuseTicks;
  if (prev.defuseTicks === 0 && dt > 0) events.push({ kind: "defuseStart" });
  else if (dt > 0 && Math.floor(dt / DEFUSE_TICK_EVERY) > Math.floor(prev.defuseTicks / DEFUSE_TICK_EVERY)) {
    events.push({ kind: "defuseTick", progress: Math.min(1, dt / DEFUSE_TICKS) });
  }
  const enemyDefusing = s.enemies.some((e) => e.alive && e.defuseTicks > 0);
  if (enemyDefusing && !prev.enemyDefusing) events.push({ kind: "enemyDefuse" });

  let beepAcc = BEEP_IDLE;
  if (snap.clock.spikeActive && !s.outcome) {
    const hz = beepHz(snap.clock.secondsLeft);
    beepAcc = prev.beepAcc + ticks * DT;
    if (beepAcc >= 1 / hz) {
      events.push({ kind: "beep", hz });
      beepAcc = 0;
    }
  }

  if (s.outcome && !prev.outcome) {
    const o = s.outcome;
    if (o.reason === "defuse" && o.winner === "clutcher") events.push({ kind: "defuseDone" });
    else if (o.reason === "detonate") events.push({ kind: "explosion" });
    else if (o.reason === "death") events.push({ kind: "death" });
    events.push({ kind: o.winner === "clutcher" ? "win" : "lose" });
  }

  return {
    next: {
      session: prev.session,
      tick: s.tick,
      countdown: snap.countdown,
      stats: s.stats,
      player: pw.w,
      enemies,
      defuseTicks: dt,
      enemyDefusing,
      beepAcc,
      outcome: s.outcome !== null,
      lastBotShotMs,
    },
    events,
  };
}

/** Replay (YOU panel): only your shots and kills between two timeline states. */
export function replayEvents(a: SimStats, b: SimStats): AudioEvent[] {
  const events: AudioEvent[] = [];
  repeat(Math.max(0, b.shotsFired - a.shotsFired), { kind: "shot" }, events);
  repeat(Math.max(0, b.kills - a.kills), { kind: "kill" }, events);
  return events;
}
