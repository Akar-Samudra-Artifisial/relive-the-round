// Design tokens for the "tactical HUD" look, shared by DOM code and (phase 2) the Pixi renderer.
// Keep in sync with the CSS custom properties at the top of ./theme.css.

export const THEME = {
  bg: "#06090d",
  bgRaised: "#0b1118",
  surface: "#0f1720",
  surfaceHi: "#16222d",
  line: "#22323f",
  lineHi: "#35505f",
  text: "#e4eef3",
  textDim: "#93a7b3",
  textMute: "#6f8794",
  /** Primary accent: the player / interactive elements. */
  cyan: "#3ee6ff",
  /** Secondary accent: score, spike, highlights. */
  amber: "#ffb84d",
  /** Enemies, danger, losses. */
  red: "#ff5a62",
  /** Success, defuse progress. */
  green: "#5cf2a0",
} as const;

export type ThemeColor = keyof typeof THEME;

/** `#rrggbb` → 0xrrggbb for Pixi. */
export function hexNum(c: string): number {
  return Number.parseInt(c.slice(1), 16);
}

export const THEME_NUM: Readonly<Record<ThemeColor, number>> = Object.fromEntries(
  Object.entries(THEME).map(([k, v]) => [k, hexNum(v)]),
) as Record<ThemeColor, number>;
