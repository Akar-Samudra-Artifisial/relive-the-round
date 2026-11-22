import { describe, expect, it } from "vitest";
import { MOODS, mtof, musicNotes, STEPS_PER_BAR, stepSeconds } from "../src/audio/pattern";

describe("music pattern", () => {
  it("tempo and gain per mood", () => {
    expect(MOODS.menu).toEqual({ bpm: 92, gain: 0.28 });
    expect(MOODS.round).toEqual({ bpm: 120, gain: 0.22 });
    expect(MOODS.calm).toEqual({ bpm: 92, gain: 0.15 });
    expect(stepSeconds("round")).toBeCloseTo(0.125);
  });

  it("is deterministic and only returns notes in [from, to)", () => {
    const a = musicNotes(5, 40, "round", true);
    expect(a).toEqual(musicNotes(5, 40, "round", true));
    expect(a.every((n) => n.step >= 5 && n.step < 40)).toBe(true);
    // Chunked requests produce the same notes as one big request (the scheduler asks step by step).
    const chunked = Array.from({ length: 35 }, (_, i) => musicNotes(5 + i, 6 + i, "round", true)).flat();
    expect(chunked).toEqual(a);
  });

  it("follows Dm - Bb - Gm - A (pad roots per bar, looping every 4 bars)", () => {
    const padLow = (bar: number): number => {
      const pads = musicNotes(bar * STEPS_PER_BAR, bar * STEPS_PER_BAR + 1, "menu").filter((n) => n.voice === "pad");
      return Math.min(...pads.map((n) => n.freq));
    };
    expect(padLow(0)).toBeCloseTo(mtof(62)); // D
    expect(padLow(1)).toBeCloseTo(mtof(58)); // Bb
    expect(padLow(2)).toBeCloseTo(mtof(55)); // G
    expect(padLow(3)).toBeCloseTo(mtof(57)); // A
    expect(padLow(4)).toBeCloseTo(padLow(0));
  });

  it("round mood: eighth-note bass and four kicks per bar; the intense layer adds notes", () => {
    const bar = musicNotes(0, STEPS_PER_BAR, "round");
    expect(bar.filter((n) => n.voice === "bass")).toHaveLength(8);
    expect(bar.filter((n) => n.voice === "kick")).toHaveLength(4);
    expect(bar.some((n) => n.voice === "stab")).toBe(false);
    const intense = musicNotes(0, STEPS_PER_BAR, "round", true);
    expect(intense.length).toBeGreaterThan(bar.length);
    expect(intense.some((n) => n.voice === "stab")).toBe(true);
  });

  it("calm mood is sparser than the menu and has no drums", () => {
    const menu = musicNotes(0, 4 * STEPS_PER_BAR, "menu");
    const calm = musicNotes(0, 4 * STEPS_PER_BAR, "calm");
    expect(calm.length).toBeLessThan(menu.length);
    expect(calm.some((n) => n.voice === "kick" || n.voice === "hat")).toBe(false);
    expect([...menu, ...calm].every((n) => n.gain > 0 && n.gain <= 1 && n.freq > 0 && n.steps > 0)).toBe(true);
  });
});
