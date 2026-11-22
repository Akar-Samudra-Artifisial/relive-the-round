import { renderResolution } from "../game/input";

/**
 * 3D quality tiers (pure). `antialias` only applies when the WebGL renderer is created; the
 * watchdog can lower the pixel ratio and switch shadows off at runtime.
 */
export type QualityTier = "high" | "medium" | "low";

export type QualitySettings = {
  readonly maxPixelRatio: number;
  readonly antialias: boolean;
  readonly shadows: boolean;
};

export const QUALITY: Readonly<Record<QualityTier, QualitySettings>> = {
  high: { maxPixelRatio: 2, antialias: true, shadows: true },
  medium: { maxPixelRatio: 1.5, antialias: true, shadows: false },
  low: { maxPixelRatio: 1, antialias: false, shadows: false },
};

/** `?quality=high|medium|low`; anything else (or no parameter) is null. */
export function parseQuality(search: string): QualityTier | null {
  const q = new URLSearchParams(search).get("quality");
  return q === "high" || q === "medium" || q === "low" ? q : null;
}

export function initialTier(search: string): QualityTier {
  return parseQuality(search) ?? "high";
}

/** high → medium → low → null (nothing left to drop). */
export function lowerTier(tier: QualityTier): QualityTier | null {
  return tier === "high" ? "medium" : tier === "medium" ? "low" : null;
}

/** Device pixel ratio → renderer pixel ratio: the 2D rule (`renderResolution`) capped by the tier. */
export function pixelRatioFor(tier: QualityTier, dpr: number | undefined): number {
  return Math.min(renderResolution(dpr), QUALITY[tier].maxPixelRatio);
}
