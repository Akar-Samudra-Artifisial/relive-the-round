import { RUN_SPEED } from "../sim/constants";

/**
 * Procedural actor motion shared by the 2D sprites and the 3D models. Pure: no renderer libs, DOM
 * or clocks (the caller passes `nowMs` and the reduced-motion flag). World units (cm) and world
 * angles (heading a = atan2(dy, dx)) throughout.
 *
 * Frames carry positions only, so speed and the movement heading come from the position delta
 * between frames. Actors are keyed by identity (player, enemy `z`, down position + side + duplicate
 * index); a key that
 * suddenly maps to a far away position (a kill shifting enemy `z`, a replay scrub) resets its state
 * instead of producing a huge speed.
 */

/** Down animation: a fresh down falls over this many ms. */
export const FALL_MS = 400;
/** Max forward lean (rad) at full run speed. */
export const LEAN_MAX = 0.12;
/** Distance (cm) per footstep: one |sin| bob period. */
export const STRIDE_CM = 120;
/** A position jump beyond max(JUMP_FACTOR × RUN_SPEED × dt, JUMP_MIN_CM) resets the actor. */
const JUMP_FACTOR = 3;
const JUMP_MIN_CM = 150;
/** Smoothing time constants (ms). */
const SPEED_TAU = 120;
const HEADING_TAU = 80;
/** Below this per-frame move (cm) the movement direction is noise and the heading is kept. */
const MOVE_EPS = 1;

export type MotionSample = {
  /** World heading (rad): facing/aim when known, else movement direction, else the last heading. */
  readonly heading: number;
  /** Smoothed speed as a fraction of RUN_SPEED, 0..1. */
  readonly speed01: number;
  /** Footstep bob 0..1 (|sin| of the stride phase × speed01); 0 with reduced motion. */
  readonly bob: number;
  /** Forward lean (rad), 0..LEAN_MAX; 0 with reduced motion. */
  readonly lean: number;
};

export type FallSample = {
  /** 0 (standing) → 1 (lying) over FALL_MS; 1 at once with reduced motion or for downs already present. */
  readonly fallT: number;
  /** Stable yaw (rad) from the down position, so bodies do not all lie the same way. */
  readonly yaw: number;
};

type ActorState = {
  heading: number;
  speed01: number;
  bob: number;
  lean: number;
  x: number;
  y: number;
  speed: number;
  phase: number;
  lastMs: number;
  seen: number;
};

type DownState = { fallT: number; yaw: number; bornMs: number; seen: number };

const TAU = Math.PI * 2;

/** Shortest signed angle from `a` to `b`, in (-π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** Deterministic yaw in [0, 2π) from a position. */
export function yawFromPosition(x: number, y: number): number {
  let h = (Math.imul(Math.round(x) | 0, 73856093) ^ Math.imul(Math.round(y) | 0, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return ((h % 3600) / 3600) * TAU;
}

/** Distinct duplicates (same rounded position and side) per frame before keys repeat. */
const DOWN_DUP_SLOTS = 64;

/**
 * Numeric key for a down at (x, y) of `side`; `dup` is its 0-based occurrence among this frame's
 * downs with the same rounded position and side, so stacked downs keep separate fall progress.
 */
export function downKey(x: number, y: number, side: "player" | "enemy", dup = 0): number {
  const pos = Math.round(x) * 100_003 + Math.round(y);
  return (pos * 2 + (side === "player" ? 1 : 0)) * DOWN_DUP_SLOTS + Math.min(dup, DOWN_DUP_SLOTS - 1);
}

/**
 * Per-panel motion state. Call `begin` once per frame, then `actor` / `fall` per visible actor,
 * then `end` to drop actors that were not seen. Returned samples are live state objects (no
 * allocation per frame); read them before the next call for the same key.
 */
export class MotionTracker {
  private readonly actors = new Map<number, ActorState>();
  private readonly downs = new Map<number, DownState>();
  /** Downs per base key (dup 0) already looked up this frame; cleared in `begin`. */
  private readonly downDups = new Map<number, number>();
  private frame = 0;
  private nowMs = 0;
  private reduced = false;
  /** Real (non-null) frames begun so far; downs on the first one are already lying. */
  private realFrames = 0;

  /** `hasFrame` false: the caller shows no frame (it does not count as the first real frame). */
  begin(nowMs: number, reducedMotion: boolean, hasFrame = true): void {
    this.frame++;
    if (hasFrame) this.realFrames++;
    this.nowMs = nowMs;
    this.reduced = reducedMotion;
    this.downDups.clear();
  }

  /**
   * Motion of the actor `key` at (x, y). `fx`/`fy` is a facing (any length, aim or view direction);
   * pass undefined (or 0, 0) when unknown.
   */
  actor(key: number, x: number, y: number, fx?: number, fy?: number): MotionSample {
    const now = this.nowMs;
    const hasFacing = fx !== undefined && fy !== undefined && (fx !== 0 || fy !== 0);
    let s = this.actors.get(key);
    if (!s) {
      s = { heading: hasFacing ? Math.atan2(fy!, fx!) : 0, speed01: 0, bob: 0, lean: 0, x, y, speed: 0, phase: 0, lastMs: now, seen: 0 };
      this.actors.set(key, s);
    }
    // Missed a frame (hidden, e.g. fog) → treat as a fresh appearance.
    const fresh = s.seen !== this.frame - 1;
    s.seen = this.frame;
    const dt = now - s.lastMs;
    const dist = Math.hypot(x - s.x, y - s.y);
    const jump = dist > Math.max((JUMP_FACTOR * RUN_SPEED * Math.max(dt, 0)) / 1000, JUMP_MIN_CM);
    if (fresh || jump || dt <= 0) {
      // Reset on a fresh appearance or a teleport; a repeated timestamp only takes the position.
      if (fresh || jump) {
        s.speed = 0;
        s.phase = 0;
        s.lastMs = now;
      }
      s.x = x;
      s.y = y;
      if (hasFacing) s.heading = Math.atan2(fy!, fx!);
      return this.finish(s);
    }
    const inst = (dist / dt) * 1000;
    s.speed += (inst - s.speed) * (1 - Math.exp(-dt / SPEED_TAU));
    s.phase += (dist / STRIDE_CM) * Math.PI;
    if (s.phase > TAU * 64) s.phase -= TAU * 64;
    if (hasFacing) {
      s.heading = Math.atan2(fy!, fx!);
    } else if (dist > MOVE_EPS) {
      const target = Math.atan2(y - s.y, x - s.x);
      s.heading = this.reduced ? target : s.heading + angleDelta(s.heading, target) * (1 - Math.exp(-dt / HEADING_TAU));
    }
    s.x = x;
    s.y = y;
    s.lastMs = now;
    return this.finish(s);
  }

  /** Fall progress and yaw of the down at (x, y) of `side`. Call once per down per frame. */
  fall(x: number, y: number, side: "player" | "enemy"): FallSample {
    const base = downKey(x, y, side);
    const dup = this.downDups.get(base) ?? 0;
    this.downDups.set(base, dup + 1);
    const key = downKey(x, y, side, dup);
    let d = this.downs.get(key);
    if (!d) {
      // Downs present on the first real frame (a panel opening mid-round) are already lying.
      const bornMs = this.realFrames <= 1 ? this.nowMs - FALL_MS : this.nowMs;
      d = { fallT: 0, yaw: yawFromPosition(x, y), bornMs, seen: 0 };
      this.downs.set(key, d);
    }
    d.seen = this.frame;
    d.fallT = this.reduced ? 1 : Math.max(0, Math.min(1, (this.nowMs - d.bornMs) / FALL_MS));
    return d;
  }

  /** Forgets actors and downs not seen since `begin`. */
  end(): void {
    for (const [k, s] of this.actors) if (s.seen !== this.frame) this.actors.delete(k);
    for (const [k, d] of this.downs) if (d.seen !== this.frame) this.downs.delete(k);
  }

  private finish(s: ActorState): MotionSample {
    s.speed01 = Math.min(1, s.speed / RUN_SPEED);
    if (s.speed01 < 0.02) s.speed01 = 0;
    s.bob = this.reduced ? 0 : Math.abs(Math.sin(s.phase)) * s.speed01;
    s.lean = this.reduced ? 0 : LEAN_MAX * s.speed01;
    return s;
  }
}
