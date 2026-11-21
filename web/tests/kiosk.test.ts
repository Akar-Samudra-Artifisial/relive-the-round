import { describe, expect, it } from "vitest";
import {
  ATTRACT_CYCLE_S,
  attractSlide,
  CornerTaps,
  isResetChord,
  KIOSK_ATTRACT_IDLE_S,
  KIOSK_SCORE_CAP_S,
  KIOSK_SCORE_IDLE_S,
  kioskScoreDeadline,
  parseKiosk,
  RESET_CORNER_PX,
  RESET_TAP_WINDOW_MS,
  RESET_TAPS,
} from "../src/game/kiosk";
import { addEntry, clearEntries, topEntries, type KeyValueStore } from "../src/game/leaderboard";
import { SCORE_RETURN_S } from "../src/game/timing";

function memStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe("parseKiosk", () => {
  it("is enabled only for kiosk=1", () => {
    expect(parseKiosk("?kiosk=1").enabled).toBe(true);
    expect(parseKiosk("?level=2&kiosk=1").enabled).toBe(true);
    expect(parseKiosk("").enabled).toBe(false);
    expect(parseKiosk("?kiosk=0").enabled).toBe(false);
    expect(parseKiosk("?kiosk=yes").enabled).toBe(false);
    expect(parseKiosk("?kiosk").enabled).toBe(false);
  });

  it("defaults the attract delay to 60 s", () => {
    expect(KIOSK_ATTRACT_IDLE_S).toBe(60);
    expect(parseKiosk("?kiosk=1").attractIdleS).toBe(60);
  });

  it("clamps idle to 10..600 and ignores non-numeric values", () => {
    expect(parseKiosk("?kiosk=1&idle=30").attractIdleS).toBe(30);
    expect(parseKiosk("?kiosk=1&idle=2").attractIdleS).toBe(10);
    expect(parseKiosk("?kiosk=1&idle=-5").attractIdleS).toBe(10);
    expect(parseKiosk("?kiosk=1&idle=9999").attractIdleS).toBe(600);
    expect(parseKiosk("?kiosk=1&idle=abc").attractIdleS).toBe(60);
    expect(parseKiosk("?kiosk=1&idle=").attractIdleS).toBe(60);
    expect(parseKiosk("?kiosk=1&idle=Infinity").attractIdleS).toBe(60);
  });
});

describe("kioskScoreDeadline", () => {
  const shown = 10_000;

  it("keeps the fixed auto-return before the score is saved", () => {
    expect(kioskScoreDeadline({ shownAtMs: shown, savedAtMs: null, lastActivityMs: shown + 9_000 })).toBe(shown + SCORE_RETURN_S * 1000);
  });

  it("returns 15 s after the last input once saved", () => {
    expect(KIOSK_SCORE_IDLE_S).toBe(15);
    const saved = shown + 3_000;
    expect(kioskScoreDeadline({ shownAtMs: shown, savedAtMs: saved, lastActivityMs: saved })).toBe(saved + 15_000);
    expect(kioskScoreDeadline({ shownAtMs: shown, savedAtMs: saved, lastActivityMs: saved + 5_000 })).toBe(saved + 20_000);
  });

  it("never runs past the 60 s cap", () => {
    expect(KIOSK_SCORE_CAP_S).toBe(60);
    const saved = shown + 3_000;
    expect(kioskScoreDeadline({ shownAtMs: shown, savedAtMs: saved, lastActivityMs: shown + 58_000 })).toBe(shown + 60_000);
  });

  it("ignores activity from before the save", () => {
    const saved = shown + 8_000;
    expect(kioskScoreDeadline({ shownAtMs: shown, savedAtMs: saved, lastActivityMs: shown + 1_000 })).toBe(saved + 15_000);
  });
});

describe("isResetChord", () => {
  const k = (code: string, ctrlKey: boolean, shiftKey: boolean, altKey: boolean) => ({ code, ctrlKey, shiftKey, altKey });

  it("matches only Ctrl+Shift+Alt+R", () => {
    expect(isResetChord(k("KeyR", true, true, true))).toBe(true);
    expect(isResetChord(k("KeyR", false, true, true))).toBe(false);
    expect(isResetChord(k("KeyR", true, false, true))).toBe(false);
    expect(isResetChord(k("KeyR", true, true, false))).toBe(false);
    expect(isResetChord(k("KeyR", false, false, false))).toBe(false);
    expect(isResetChord(k("KeyT", true, true, true))).toBe(false);
  });
});

describe("CornerTaps", () => {
  const tapN = (t: CornerTaps, n: number, startMs: number, stepMs = 100): boolean[] =>
    Array.from({ length: n }, (_, i) => t.tap(5, 5, startMs + i * stepMs));

  it("triggers on the 5th corner tap within 3 s", () => {
    expect(RESET_TAPS).toBe(5);
    const t = new CornerTaps();
    expect(tapN(t, RESET_TAPS, 0)).toEqual([false, false, false, false, true]);
  });

  it("resets when a tap lands outside the corner", () => {
    const t = new CornerTaps();
    tapN(t, 4, 0);
    expect(t.tap(RESET_CORNER_PX, 5, 500)).toBe(false);
    expect(tapN(t, 4, 600)).toEqual([false, false, false, false]);
    expect(t.tap(5, 5, 1_100)).toBe(true);
  });

  it("resets when the gesture takes longer than 3 s", () => {
    const t = new CornerTaps();
    tapN(t, 4, 0);
    expect(t.tap(5, 5, RESET_TAP_WINDOW_MS + 1)).toBe(false);
    // Slow taps spread over more than the window never trigger.
    const slow = new CornerTaps();
    expect(tapN(slow, 5, 0, 800)).toEqual([false, false, false, false, false]);
  });

  it("needs a fresh 5 taps after triggering", () => {
    const t = new CornerTaps();
    expect(tapN(t, 5, 0).at(-1)).toBe(true);
    expect(tapN(t, 4, 1_000)).toEqual([false, false, false, false]);
    expect(t.tap(5, 5, 1_500)).toBe(true);
  });
});

describe("attractSlide", () => {
  it("cycles every 4 s and wraps", () => {
    const step = ATTRACT_CYCLE_S * 1000;
    expect(ATTRACT_CYCLE_S).toBe(4);
    expect(attractSlide(0, 3)).toBe(0);
    expect(attractSlide(step - 1, 3)).toBe(0);
    expect(attractSlide(step, 3)).toBe(1);
    expect(attractSlide(2 * step, 3)).toBe(2);
    expect(attractSlide(3 * step, 3)).toBe(0);
    expect(attractSlide(5_000, 0)).toBe(0);
  });
});

describe("clearEntries", () => {
  it("empties the leaderboard", () => {
    const store = memStore();
    expect(addEntry({ initials: "ABC", points: 500, levelId: "L1" }, store)).toBe(true);
    expect(addEntry({ initials: "XYZ", points: 300, levelId: "L2" }, store)).toBe(true);
    expect(topEntries(undefined, store)).toHaveLength(2);
    expect(clearEntries(store)).toBe(true);
    expect(topEntries(undefined, store)).toEqual([]);
  });

  it("returns false without storage or when the write fails", () => {
    expect(clearEntries(null)).toBe(false);
    const broken: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(clearEntries(broken)).toBe(false);
  });
});
