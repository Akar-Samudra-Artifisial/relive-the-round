/**
 * Dev-only per-sound counter for browser verification (read through the dev probe in gamePage).
 * In production builds `import.meta.env.DEV` is false, so `countSound` is an empty function.
 */
export const soundCounts: Record<string, number> = {};

export function countSound(name: string): void {
  if (import.meta.env.DEV) soundCounts[name] = (soundCounts[name] ?? 0) + 1;
}
