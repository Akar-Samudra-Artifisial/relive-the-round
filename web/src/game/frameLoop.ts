/** Longest frame step (ms), like the Pixi ticker's `maxElapsedMS`: a stalled tab must not jump ahead. */
export const MAX_FRAME_MS = 100;

/** Elapsed ms between two frames: 0 on the first frame or when the clock went backwards, clamped to `maxMs`. */
export function frameDelta(prevMs: number | null, nowMs: number, maxMs = MAX_FRAME_MS): number {
  if (prevMs === null) return 0;
  const d = nowMs - prevMs;
  if (!(d > 0)) return 0;
  return Math.min(d, maxMs);
}

export type FrameLoopDeps = {
  raf(cb: (time: number) => void): number;
  caf(id: number): void;
  now(): number;
};

export type FrameLoop = {
  start(): void;
  stop(): void;
  readonly running: boolean;
};

const browserDeps: FrameLoopDeps = {
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};

/**
 * The single per-page animation loop: `onFrame(deltaMS, nowMs)` once per animation frame.
 * `start` is idempotent; after `stop` no callback runs (also not an already queued one), and the
 * first frame after a (re)start gets delta 0. Deps are injectable for tests.
 */
export function createFrameLoop(onFrame: (deltaMS: number, nowMs: number) => void, deps: FrameLoopDeps = browserDeps): FrameLoop {
  let running = false;
  let id: number | null = null;
  let prev: number | null = null;
  /** Bumped on every stop so a stale queued callback can tell it is obsolete. */
  let generation = 0;

  const schedule = (): void => {
    const gen = generation;
    id = deps.raf(() => {
      if (!running || gen !== generation) return;
      id = null;
      const now = deps.now();
      const delta = frameDelta(prev, now);
      prev = now;
      onFrame(delta, now);
      if (running && gen === generation && id === null) schedule();
    });
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      prev = null;
      schedule();
    },
    stop(): void {
      if (!running) return;
      running = false;
      generation++;
      if (id !== null) deps.caf(id);
      id = null;
      prev = null;
    },
    get running(): boolean {
      return running;
    },
  };
}
