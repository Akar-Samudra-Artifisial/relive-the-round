import { THEME_NUM } from "../ui/theme";

/**
 * Actor colours and sizes (world units) shared by the 2D (`actors.ts`) and 3D (`three3d/actorScene.ts`)
 * drawers. Pure: no renderer libs, DOM or clocks.
 */
export const PLAYER_COLOR = THEME_NUM.cyan;
export const ENEMY_COLOR = THEME_NUM.red;
export const PLAYER_TRACER = 0xc8f8ff;
export const ENEMY_TRACER = 0xff9a5c;
export const BODY_EDGE = THEME_NUM.text;
export const PLAYER_R = 120;
export const ENEMY_R = 110;
export const AIM_LEN = 1100;
export const AIM_HALF = 0.16;
// The drawn view cone (520 cm, half 0.32 rad) intentionally differs from the sim's FOV_COS /
// VIEW_RANGE: it is a facing hint, and visual parity between 2D and 3D wins over sim accuracy.
export const VIEW_LEN = 520;
export const VIEW_HALF = 0.32;
