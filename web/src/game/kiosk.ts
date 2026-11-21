// Booth kiosk mode (`?kiosk=1`): pure helpers, wired into the DOM by gamePage.ts.
import { SCORE_RETURN_S } from "./timing";

/** Score screen returns this long after the last input once initials are saved. */
export const KIOSK_SCORE_IDLE_S = 15;
/** Hard cap on the score screen in kiosk mode, counted from when it first appeared. */
export const KIOSK_SCORE_CAP_S = 60;
/** Default idle time on the level select before the attract loop shows (`?idle=` overrides). */
export const KIOSK_ATTRACT_IDLE_S = 60;
export const KIOSK_ATTRACT_IDLE_MIN_S = 10;
export const KIOSK_ATTRACT_IDLE_MAX_S = 600;
/** Operator reset gesture: this many taps in the top-left corner within the window. */
export const RESET_TAPS = 5;
export const RESET_TAP_WINDOW_MS = 3000;
export const RESET_CORNER_PX = 48;
/** The reset confirm panel cancels itself after this long. */
export const RESET_CONFIRM_S = 10;
/** Featured rounds on the attract loop change this often. */
export const ATTRACT_CYCLE_S = 4;

export type KioskConfig = { readonly enabled: boolean; readonly attractIdleS: number };

/** Reads `kiosk=1` (anything else is normal mode) and `idle=<s>` (clamped, default 60 s). */
export function parseKiosk(search: string): KioskConfig {
  const params = new URLSearchParams(search);
  const raw = params.get("idle");
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  const attractIdleS = Number.isFinite(n)
    ? Math.min(KIOSK_ATTRACT_IDLE_MAX_S, Math.max(KIOSK_ATTRACT_IDLE_MIN_S, n))
    : KIOSK_ATTRACT_IDLE_S;
  return { enabled: params.get("kiosk") === "1", attractIdleS };
}

/**
 * Score-screen deadline in kiosk mode (ms, same clock as the inputs). Unsaved: the normal fixed
 * auto-return. Saved: 15 s after the save or the latest input, never past the 60 s cap.
 */
export function kioskScoreDeadline(o: { shownAtMs: number; savedAtMs: number | null; lastActivityMs: number }): number {
  if (o.savedAtMs === null) return o.shownAtMs + SCORE_RETURN_S * 1000;
  const idleFrom = Math.max(o.savedAtMs, o.lastActivityMs);
  return Math.min(o.shownAtMs + KIOSK_SCORE_CAP_S * 1000, idleFrom + KIOSK_SCORE_IDLE_S * 1000);
}

/** Ctrl+Shift+Alt+R opens the operator reset panel. */
export function isResetChord(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "shiftKey" | "altKey">): boolean {
  return e.code === "KeyR" && e.ctrlKey && e.shiftKey && e.altKey;
}

/** Counts quick taps in the top-left corner; `tap` returns true on the tap that completes the gesture. */
export class CornerTaps {
  private count = 0;
  private firstMs = 0;

  tap(x: number, y: number, nowMs: number): boolean {
    if (x < 0 || y < 0 || x >= RESET_CORNER_PX || y >= RESET_CORNER_PX) {
      this.count = 0;
      return false;
    }
    // The whole gesture must fit in the window, measured from its first tap.
    if (this.count === 0 || nowMs - this.firstMs > RESET_TAP_WINDOW_MS) {
      this.count = 0;
      this.firstMs = nowMs;
    }
    this.count++;
    if (this.count < RESET_TAPS) return false;
    this.count = 0;
    return true;
  }
}

/** Index of the featured round shown on the attract loop at `nowMs`. */
export function attractSlide(nowMs: number, count: number): number {
  if (count <= 0) return 0;
  const i = Math.floor(nowMs / (ATTRACT_CYCLE_S * 1000)) % count;
  return i < 0 ? i + count : i;
}
