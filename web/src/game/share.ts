import type { ScoreCard } from "./score";

/** Result + challenge carried by a share link / QR (no input recording). */
export type Challenge = {
  readonly levelId: string;
  /** Sim seed (uint32) so the challenger faces the same bot rolls. */
  readonly seed: number;
  readonly points: number;
  readonly won: boolean;
  /** Round time in tenths of a second. */
  readonly timeDs: number;
  readonly kills: number;
  readonly hp: number;
  /** Accuracy in whole percent (0–100). */
  readonly acc: number;
};

const MAX_SEED = 0xffffffff;
const LIMITS = { points: 99999, timeDs: 9999, kills: 5, hp: 100, acc: 100 } as const;
/** c=<levelId>.<seed36>.<points>.<w|l><timeDs>.<kills>.<hp>.<acc> */
const CHALLENGE_RE = /^([A-Za-z0-9_-]{1,32})\.([0-9a-z]{1,7})\.(\d{1,6})\.([wl])(\d{1,5})\.(\d{1,2})\.(\d{1,3})\.(\d{1,3})$/;
export const MAX_CHALLENGE_LEN = 100;

const clamp = (n: number, max: number): number => Math.min(max, Math.max(0, Math.round(n)));

/** Hash fragment (without '#'), e.g. "c=df244e8f378d.1z141z3.1830.w124.3.62.41". */
export function encodeChallenge(c: Challenge): string {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(c.levelId)) throw new Error(`share: invalid levelId "${c.levelId}"`);
  if (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > MAX_SEED) throw new Error(`share: seed ${c.seed} is not a uint32`);
  const parts = [
    c.levelId,
    c.seed.toString(36),
    clamp(c.points, LIMITS.points),
    `${c.won ? "w" : "l"}${clamp(c.timeDs, LIMITS.timeDs)}`,
    clamp(c.kills, LIMITS.kills),
    clamp(c.hp, LIMITS.hp),
    clamp(c.acc, LIMITS.acc),
  ];
  return `c=${parts.join(".")}`;
}

/**
 * Parses a location hash ("#c=…", "c=…", or with other &-separated params). Returns null when the
 * challenge is missing, malformed, too long, has an unknown levelId or an out-of-range seed;
 * stat fields are clamped to their limits.
 */
export function decodeChallenge(hash: string, allowedLevelIds: readonly string[]): Challenge | null {
  if (hash.length > MAX_CHALLENGE_LEN * 2) return null;
  const param = hash
    .replace(/^#/, "")
    .split("&")
    .find((p) => p.startsWith("c="));
  if (!param || param.length > MAX_CHALLENGE_LEN) return null;
  const m = CHALLENGE_RE.exec(param.slice(2));
  if (!m) return null;
  const [, levelId, seed36, points, wl, timeDs, kills, hp, acc] = m;
  if (!levelId || !allowedLevelIds.includes(levelId)) return null;
  const seed = parseInt(seed36!, 36);
  if (!Number.isSafeInteger(seed) || seed > MAX_SEED) return null;
  return {
    levelId,
    seed,
    points: clamp(Number(points), LIMITS.points),
    won: wl === "w",
    timeDs: clamp(Number(timeDs), LIMITS.timeDs),
    kills: clamp(Number(kills), LIMITS.kills),
    hp: clamp(Number(hp), LIMITS.hp),
    acc: clamp(Number(acc), LIMITS.acc),
  };
}

/** Challenge from a finished round's score card. */
export function challengeFromCard(levelId: string, seed: number, card: ScoreCard): Challenge {
  return {
    levelId,
    seed,
    points: card.points,
    won: card.won,
    timeDs: card.timeS * 10,
    kills: card.kills,
    hp: card.hpLeft,
    acc: card.accuracy * 100,
  };
}

/** Public origin for share links: VITE_PUBLIC_URL (kiosk behind a LAN/tunnel) or this page's origin. */
export function publicBaseUrl(): string {
  const env: unknown = import.meta.env.VITE_PUBLIC_URL;
  return typeof env === "string" && env !== "" ? env : location.origin;
}

/** Full share URL: `<baseUrl>/#c=…`. */
export function challengeUrl(baseUrl: string, c: Challenge): string {
  return `${baseUrl.replace(/\/+$/, "")}/#${encodeChallenge(c)}`;
}
