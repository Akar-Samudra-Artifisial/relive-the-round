import { describe, expect, it } from "vitest";
import { challengeLines, landingAction, REPLAY_SEEK_S, replayKeyAction } from "../src/game/challengeLanding";
import { blocksDefault } from "../src/game/input";
import { encodeChallenge, type Challenge } from "../src/game/share";

const IDS = ["aaa111", "bbb222", "ccc333"];
const C: Challenge = { levelId: "bbb222", seed: 123456789, points: 1830, won: true, timeDs: 124, kills: 3, hp: 62, acc: 41 };

describe("landingAction", () => {
  it("valid #c= → challenge with the level index", () => {
    const a = landingAction(`#${encodeChallenge(C)}`, IDS);
    expect(a).toEqual({ kind: "challenge", challenge: C, levelIndex: 1 });
  });

  it("missing, malformed or unknown level → plain attract", () => {
    expect(landingAction("", IDS)).toEqual({ kind: "attract" });
    expect(landingAction("#foo=bar", IDS)).toEqual({ kind: "attract" });
    expect(landingAction("#c=<script>", IDS)).toEqual({ kind: "attract" });
    expect(landingAction(`#${encodeChallenge({ ...C, levelId: "zzz999" })}`, IDS)).toEqual({ kind: "attract" });
    expect(landingAction(`#${encodeChallenge(C)}`, [])).toEqual({ kind: "attract" });
  });

  it("duplicate ids (synthetic fallback) pick the first level", () => {
    const a = landingAction(`#${encodeChallenge({ ...C, levelId: "x" })}`, ["x", "x"]);
    expect(a.kind === "challenge" && a.levelIndex).toBe(0);
  });
});

describe("challengeLines", () => {
  it("formats the challenger's stats", () => {
    expect(challengeLines(C)).toEqual(["1830 points", "Won in 12.4 s", "3 kills · 62 HP left · 41% accuracy"]);
    expect(challengeLines({ ...C, won: false })[1]).toBe("Lost in 12.4 s");
  });
});

describe("replayKeyAction", () => {
  it("maps the replay shortcuts", () => {
    expect(replayKeyAction(" ")).toEqual({ kind: "toggle" });
    expect(replayKeyAction("k")).toEqual({ kind: "toggle" });
    expect(replayKeyAction("1")).toEqual({ kind: "speed", speed: 1 });
    expect(replayKeyAction("2")).toEqual({ kind: "speed", speed: 2 });
    expect(replayKeyAction("4")).toEqual({ kind: "speed", speed: 4 });
    expect(replayKeyAction("ArrowLeft")).toEqual({ kind: "seek", deltaS: -REPLAY_SEEK_S });
    expect(replayKeyAction("ArrowRight")).toEqual({ kind: "seek", deltaS: REPLAY_SEEK_S });
    expect(replayKeyAction("Escape")).toEqual({ kind: "exit" });
    expect(replayKeyAction("3")).toBeNull();
    expect(replayKeyAction("Enter")).toBeNull();
  });

  it("replay swallows Space/arrow scrolling like play", () => {
    expect(blocksDefault("Space", "replay")).toBe(true);
    expect(blocksDefault("ArrowLeft", "replay")).toBe(true);
    expect(blocksDefault("KeyK", "replay")).toBe(false);
  });
});
