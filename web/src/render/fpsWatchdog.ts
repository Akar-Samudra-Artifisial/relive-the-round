export type FpsWatchdogOptions = {
  /** Samples are ignored for this long after the first sample and after every reset (ms). */
  readonly warmupMs?: number;
  /** Length of the rolling average (ms). */
  readonly spanMs?: number;
  /** Average fps below this counts as slow. */
  readonly minFps?: number;
  /** How long the average must stay slow before "degrade" (ms). */
  readonly slowForMs?: number;
  /** A frame gap this long (ms) is a pause (tab switch, debugger), not a slow frame: it resets. */
  readonly gapMs?: number;
};

export type FpsVerdict = "ok" | "degrade";

export type FpsWatchdog = {
  sample(nowMs: number): FpsVerdict;
  reset(nowMs: number): void;
};

/** Ring buffer size; enough for the rolling span at very high refresh rates (oldest samples drop). */
const CAPACITY = 1024;

/**
 * Pure, deterministic frame-rate watchdog: the caller feeds every frame's clock. Frame times come
 * from the clock itself, not the frame loop's delta, because that delta is clamped (a real 8 fps
 * would look like 10 fps). Returns "degrade" once when the rolling average stays below `minFps`
 * for `slowForMs`, then resets itself (a new warm-up). A gap of `gapMs` or more (a background tab)
 * also resets, so a hidden tab never degrades. No allocation per sample.
 */
export function createFpsWatchdog(opts: FpsWatchdogOptions = {}): FpsWatchdog {
  const warmupMs = opts.warmupMs ?? 3000;
  const spanMs = opts.spanMs ?? 2000;
  const minFps = opts.minFps ?? 45;
  const slowForMs = opts.slowForMs ?? 3000;
  const gapMs = opts.gapMs ?? 1000;

  const times = new Float64Array(CAPACITY);
  const deltas = new Float64Array(CAPACITY);
  let head = 0;
  let count = 0;
  let sum = 0;
  let startMs: number | null = null;
  let lastMs = 0;
  let slowSinceMs: number | null = null;

  const reset = (nowMs: number): void => {
    head = 0;
    count = 0;
    sum = 0;
    slowSinceMs = null;
    startMs = nowMs;
    lastMs = nowMs;
  };

  const sample = (nowMs: number): FpsVerdict => {
    if (startMs === null) {
      reset(nowMs);
      return "ok";
    }
    const frameMs = nowMs - lastMs;
    lastMs = nowMs;
    if (frameMs >= gapMs) {
      reset(nowMs);
      return "ok";
    }
    if (!(frameMs > 0) || nowMs - startMs < warmupMs) return "ok";

    if (count === CAPACITY) {
      sum -= deltas[head]!;
      head = (head + 1) % CAPACITY;
      count--;
    }
    const tail = (head + count) % CAPACITY;
    times[tail] = nowMs;
    deltas[tail] = frameMs;
    sum += frameMs;
    count++;
    while (count > 1 && nowMs - times[head]! > spanMs) {
      sum -= deltas[head]!;
      head = (head + 1) % CAPACITY;
      count--;
    }

    const fps = (count * 1000) / sum;
    if (fps >= minFps) {
      slowSinceMs = null;
      return "ok";
    }
    if (slowSinceMs === null) slowSinceMs = nowMs;
    if (nowMs - slowSinceMs < slowForMs) return "ok";
    reset(nowMs);
    return "degrade";
  };

  return { sample, reset };
}
