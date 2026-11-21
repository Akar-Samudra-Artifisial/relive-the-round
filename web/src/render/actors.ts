import type { Graphics } from "pixi.js";
import { DEFUSE_RADIUS } from "../sim/constants";
import type { Vec2 } from "../sim/geom";
import type { ShotEvent } from "../sim/sim";
import { THEME_NUM } from "../ui/theme";
import type { ActorView, DownView, FrameView, SpikeView } from "./renderer";

export type { SpikeView };

/**
 * Shared actor drawing for the live view and the replay (world units, one Graphics cleared per
 * frame). Glows are plain low-alpha shapes, no filters, so it stays cheap on phones.
 */
export const PLAYER_COLOR = THEME_NUM.cyan;
export const ENEMY_COLOR = THEME_NUM.red;
const PLAYER_TRACER = 0xc8f8ff;
const ENEMY_TRACER = 0xff9a5c;
const BODY_EDGE = THEME_NUM.text;
const PLAYER_R = 120;
const ENEMY_R = 110;
const AIM_LEN = 1100;
const AIM_HALF = 0.16;
const VIEW_LEN = 520;
const VIEW_HALF = 0.32;

/** Filled circular sector (a view/aim cone) from `o` towards angle `a`. */
function cone(g: Graphics, o: Vec2, a: number, half: number, len: number, color: number, alpha: number): void {
  const pts: number[] = [o.x, o.y];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = a - half + (2 * half * i) / steps;
    pts.push(o.x + Math.cos(t) * len, o.y + Math.sin(t) * len);
  }
  g.poly(pts).fill({ color, alpha });
}

/** Circular progress arc (0..1) starting at 12 o'clock. */
function progressArc(g: Graphics, c: Vec2, r: number, frac: number, color: number, width: number): void {
  const start = -Math.PI / 2;
  g.moveTo(c.x, c.y - r).arc(c.x, c.y, r, start, start + Math.PI * 2 * Math.min(1, frac)).stroke({ width, color, cap: "butt" });
}

/**
 * The player: soft glow, aim cone towards `aim` (omitted while the pointer has not aimed yet),
 * body with a light rim and a nose pointing where they aim.
 */
export function drawPlayer(g: Graphics, p: Vec2, aim: Vec2 | null): void {
  g.circle(p.x, p.y, PLAYER_R * 1.9).fill({ color: PLAYER_COLOR, alpha: 0.1 });
  const dx = aim ? aim.x - p.x : 0;
  const dy = aim ? aim.y - p.y : 0;
  const hasDir = aim !== null && dx * dx + dy * dy > PLAYER_R * PLAYER_R;
  const a = Math.atan2(dy, dx);
  if (hasDir) {
    cone(g, p, a, AIM_HALF, AIM_LEN, PLAYER_COLOR, 0.12);
    g.moveTo(p.x, p.y).lineTo(p.x + Math.cos(a) * AIM_LEN, p.y + Math.sin(a) * AIM_LEN).stroke({ width: 10, color: PLAYER_COLOR, alpha: 0.35 });
  }
  g.circle(p.x, p.y, PLAYER_R).fill({ color: PLAYER_COLOR }).stroke({ width: 18, color: BODY_EDGE });
  if (hasDir) {
    const tip = PLAYER_R + 90;
    const base = PLAYER_R + 10;
    g.poly([
      p.x + Math.cos(a) * tip, p.y + Math.sin(a) * tip,
      p.x + Math.cos(a + 0.5) * base, p.y + Math.sin(a + 0.5) * base,
      p.x + Math.cos(a - 0.5) * base, p.y + Math.sin(a - 0.5) * base,
    ]).fill({ color: BODY_EDGE });
  }
}

/** The pro's clutcher in the replay (no aim data): same body, no cone. */
export function drawPro(g: Graphics, p: Vec2): void {
  drawPlayer(g, p, null);
}

/** A live enemy: glow, faint view cone along its facing (fx, fy), body and a facing tick. */
export function drawEnemy(g: Graphics, e: { x: number; y: number; fx?: number; fy?: number }): void {
  g.circle(e.x, e.y, ENEMY_R * 1.8).fill({ color: ENEMY_COLOR, alpha: 0.12 });
  const hasFacing = e.fx !== undefined && e.fy !== undefined && (e.fx !== 0 || e.fy !== 0);
  if (hasFacing) cone(g, e, Math.atan2(e.fy!, e.fx!), VIEW_HALF, VIEW_LEN, ENEMY_COLOR, 0.1);
  g.circle(e.x, e.y, ENEMY_R).fill({ color: ENEMY_COLOR }).stroke({ width: 14, color: 0x2a0d10 });
  if (hasFacing) {
    g.moveTo(e.x, e.y).lineTo(e.x + e.fx! * (ENEMY_R + 110), e.y + e.fy! * (ENEMY_R + 110)).stroke({ width: 22, color: BODY_EDGE, alpha: 0.9 });
  }
}

/** A downed actor: muted X with a faint ring. */
export function drawDown(g: Graphics, x: number, y: number, color: number = ENEMY_COLOR): void {
  g.circle(x, y, 100).stroke({ width: 10, color, alpha: 0.3 });
  g.moveTo(x - 70, y - 70).lineTo(x + 70, y + 70).moveTo(x + 70, y - 70).lineTo(x - 70, y + 70);
  g.stroke({ width: 22, color, alpha: 0.55 });
}

/** Shot tracer with a soft halo and a hit flash at the end; `fade` 1 → 0 over its lifetime. */
export function drawTracer(g: Graphics, shot: ShotEvent, fade = 1): void {
  const color = shot.by === "P0" ? PLAYER_TRACER : ENEMY_TRACER;
  const a = Math.max(0, Math.min(1, fade));
  g.moveTo(shot.from.x, shot.from.y).lineTo(shot.to.x, shot.to.y).stroke({ width: 44, color, alpha: 0.14 * a });
  g.moveTo(shot.from.x, shot.from.y).lineTo(shot.to.x, shot.to.y).stroke({ width: 12, color, alpha: 0.9 * a });
  if (shot.hit) {
    g.circle(shot.to.x, shot.to.y, 150).fill({ color: 0xffffff, alpha: 0.18 * a });
    g.circle(shot.to.x, shot.to.y, 70).fill({ color, alpha: 0.75 * a });
  }
}

/** Planted spike: defuse zone, optional pulse ring, diamond core and defuse progress arcs. */
export function drawSpike(g: Graphics, sp: Vec2, v: SpikeView): void {
  g.circle(sp.x, sp.y, DEFUSE_RADIUS).fill({ color: THEME_NUM.red, alpha: 0.1 }).stroke({ width: 12, color: THEME_NUM.red, alpha: 0.7 });
  if (v.pulseT !== null) {
    const k = (v.pulseT % 1.2) / 1.2;
    g.circle(sp.x, sp.y, DEFUSE_RADIUS + k * 420).stroke({ width: 16, color: THEME_NUM.red, alpha: 0.45 * (1 - k) });
  } else {
    g.circle(sp.x, sp.y, DEFUSE_RADIUS + 200).stroke({ width: 10, color: THEME_NUM.red, alpha: 0.25 });
  }
  const d = 95;
  g.poly([sp.x, sp.y - d, sp.x + d, sp.y, sp.x, sp.y + d, sp.x - d, sp.y]).fill({ color: THEME_NUM.red }).stroke({ width: 14, color: THEME_NUM.amber });
  const r = DEFUSE_RADIUS + 110;
  if (v.defuse > 0 || (v.enemyDefuse ?? 0) > 0) {
    g.circle(sp.x, sp.y, r).stroke({ width: 46, color: THEME_NUM.surfaceHi, alpha: 0.85 });
  }
  if (v.defuse > 0) progressArc(g, sp, r, v.defuse, THEME_NUM.green, 46);
  else if ((v.enemyDefuse ?? 0) > 0) progressArc(g, sp, r, v.enemyDefuse!, THEME_NUM.red, 46);
}

/**
 * One frame from renderer-neutral data: spike, then downs and enemies merged by `z` (stable,
 * downs first on ties), then the player, then tracers. `g` is not cleared here.
 */
export function drawFrame(g: Graphics, f: FrameView): void {
  if (f.spike) drawSpike(g, f.spike, f.spike);
  const layered: ({ down: DownView } | { enemy: ActorView })[] = [
    ...f.downs.map((down) => ({ down })),
    ...f.enemies.map((enemy) => ({ enemy })),
  ];
  const z = (v: { down: DownView } | { enemy: ActorView }): number => ("down" in v ? v.down.z : v.enemy.z) ?? Infinity;
  layered.sort((a, b) => z(a) - z(b) || 0);
  for (const v of layered) {
    if ("down" in v) drawDown(g, v.down.x, v.down.y, v.down.side === "player" ? PLAYER_COLOR : ENEMY_COLOR);
    else drawEnemy(g, v.enemy);
  }
  if (f.player) drawPlayer(g, f.player, f.player.aim);
  for (const t of f.tracers) drawTracer(g, t.shot, t.fade);
}
