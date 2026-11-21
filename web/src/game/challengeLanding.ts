import type { ReplaySpeed } from "./replayView";
import { decodeChallenge, type Challenge } from "./share";

/** What the kiosk does on load / hash change. */
export type LandingAction =
  | { readonly kind: "attract" }
  | { readonly kind: "challenge"; readonly challenge: Challenge; readonly levelIndex: number };

/**
 * Location hash → landing. A valid `#c=…` for one of the loaded levels shows the challenge card;
 * anything else (missing, malformed, unknown level) silently falls back to the normal attract screen.
 */
export function landingAction(hash: string, levelIds: readonly string[]): LandingAction {
  const challenge = decodeChallenge(hash, levelIds);
  if (!challenge) return { kind: "attract" };
  const levelIndex = levelIds.indexOf(challenge.levelId);
  return levelIndex < 0 ? { kind: "attract" } : { kind: "challenge", challenge, levelIndex };
}

/** Challenger's stats as short display lines (plain text; render with textContent). */
export function challengeLines(c: Challenge): string[] {
  return [
    `${c.points} points`,
    `${c.won ? "Won" : "Lost"} in ${(c.timeDs / 10).toFixed(1)} s`,
    `${c.kills} kills · ${c.hp} HP left · ${c.acc}% accuracy`,
  ];
}

/** Replay keyboard controls. */
export type ReplayKeyAction =
  | { readonly kind: "toggle" }
  | { readonly kind: "speed"; readonly speed: ReplaySpeed }
  | { readonly kind: "seek"; readonly deltaS: number }
  | { readonly kind: "exit" };

/** Seconds per ←/→ press in the replay. */
export const REPLAY_SEEK_S = 2;

/** `KeyboardEvent.key` → replay action: Space/K play-pause, 1/2/4 speed, ←/→ seek, Esc back. */
export function replayKeyAction(key: string): ReplayKeyAction | null {
  switch (key) {
    case " ":
    case "k":
    case "K":
      return { kind: "toggle" };
    case "1":
    case "2":
    case "4":
      return { kind: "speed", speed: Number(key) as ReplaySpeed };
    case "ArrowLeft":
      return { kind: "seek", deltaS: -REPLAY_SEEK_S };
    case "ArrowRight":
      return { kind: "seek", deltaS: REPLAY_SEEK_S };
    case "Escape":
      return { kind: "exit" };
    default:
      return null;
  }
}
