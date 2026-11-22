import { THEME_NUM } from "../ui/theme";

/**
 * Map palette (Tactical HUD): dark floor, raised walls with a thin cyan edge, amber sites.
 * Pure constants shared by the 2D (Pixi) and the 3D (three.js) map renderers.
 */
export const FLOOR = 0x070b10;
export const GRID_MINOR = 400;
export const GRID_MAJOR = 2000;
export const WALL_FILL = 0x111b25;
export const ATTACK_TINT = THEME_NUM.red;
export const DEFENSE_TINT = THEME_NUM.green;

/** Site letter font size (world units). */
export const SITE_LABEL_SIZE = 380;
/** Spawn labels never render below this many CSS px. */
export const MIN_LABEL_CSS_PX = 10;
export const SPAWN_LABEL_SIZE = 150;

/** Spawn label font size (world units): the design size, raised so it is ≥ MIN_LABEL_CSS_PX on screen. */
export function spawnLabelSize(cssPxPerUnit: number | undefined): number {
  if (!(cssPxPerUnit !== undefined && cssPxPerUnit > 0)) return SPAWN_LABEL_SIZE;
  return Math.max(SPAWN_LABEL_SIZE, Math.ceil(MIN_LABEL_CSS_PX / cssPxPerUnit));
}
