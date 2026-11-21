import { describe, expect, it } from "vitest";
import { challengeFromCard, challengeUrl, decodeChallenge, encodeChallenge, MAX_CHALLENGE_LEN, type Challenge } from "../src/game/share";
import type { ScoreCard } from "../src/game/score";

const IDS = ["df244e8f378d", "010a7b04f8c3", "synthetic-1v3"];
const base: Challenge = { levelId: "df244e8f378d", seed: 0xdeadbeef, points: 1830, won: true, timeDs: 124, kills: 3, hp: 62, acc: 41 };

describe("challenge share link", () => {
  it("round-trips through encode/decode, with or without '#'", () => {
    const enc = encodeChallenge(base);
    expect(decodeChallenge(enc, IDS)).toEqual(base);
    expect(decodeChallenge(`#${enc}`, IDS)).toEqual(base);
    expect(decodeChallenge(`#x=1&${enc}`, IDS)).toEqual(base);
    const lost = { ...base, levelId: "synthetic-1v3", seed: 0, points: 0, won: false, kills: 0, hp: 0, acc: 0 };
    expect(decodeChallenge(encodeChallenge(lost), IDS)).toEqual(lost);
  });

  it("stays within the length budget even at maximum values", () => {
    const worst = encodeChallenge({ ...base, levelId: "a".repeat(32), seed: 0xffffffff, points: 1e9, timeDs: 1e9, kills: 99, hp: 999, acc: 999 });
    expect(worst.length).toBeLessThanOrEqual(MAX_CHALLENGE_LEN);
    expect(challengeUrl("https://example.test/", base).length).toBeLessThan(MAX_CHALLENGE_LEN);
    expect(challengeUrl("https://example.test/", base)).toBe(`https://example.test/#${encodeChallenge(base)}`);
  });

  it("returns null for malformed input, unknown levels and bad seeds", () => {
    const enc = encodeChallenge(base);
    for (const bad of [
      "",
      "#",
      "c=",
      enc.replace("df244e8f378d", "ffffffffffff"),
      enc.replace(".w", ".x"),
      `${enc}.9`,
      enc.replace("c=", "c=<script>"),
      "c=df244e8f378d.zzzzzzz.1.w1.1.1.1",
      "c=df244e8f378d.1.1234567.w1.1.1.1",
      "c=df244e8f378d.1.-5.w1.1.1.1",
      `c=${"a".repeat(200)}`,
    ]) {
      expect(decodeChallenge(bad, IDS)).toBeNull();
    }
  });

  it("clamps out-of-range stats", () => {
    const c = decodeChallenge("c=df244e8f378d.1.999999.l99999.99.999.999", IDS);
    expect(c).toEqual({ levelId: "df244e8f378d", seed: 1, points: 99999, won: false, timeDs: 9999, kills: 5, hp: 100, acc: 100 });
  });

  it("rejects invalid values on encode and rounds stats", () => {
    expect(() => encodeChallenge({ ...base, levelId: "a.b" })).toThrow(/levelId/);
    expect(() => encodeChallenge({ ...base, seed: -1 })).toThrow(/seed/);
    expect(encodeChallenge({ ...base, timeDs: 123.6, acc: -3 })).toContain(".w124.3.62.0");
  });

  it("builds a challenge from a score card", () => {
    const card: ScoreCard = {
      won: true,
      reason: "elimination",
      timeS: 12.44,
      hpLeft: 62,
      kills: 3,
      enemies: 3,
      accuracy: 0.413,
      proWon: true,
      proTimeS: 28,
      points: 1830,
    };
    const c = challengeFromCard("df244e8f378d", 0xdeadbeef, card);
    expect(decodeChallenge(encodeChallenge(c), IDS)).toEqual(base);
  });
});
