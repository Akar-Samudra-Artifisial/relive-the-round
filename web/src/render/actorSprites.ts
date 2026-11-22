import { CanvasSource, Container, ImageSource, Rectangle, Sprite, Texture } from "pixi.js";
import { facing, MotionTracker } from "./actorMotion";
import { ENEMY_COLOR, PLAYER_COLOR, PLAYER_R } from "./actorStyle";
import type { Vec2 } from "../sim/geom";
import type { ShotEvent } from "../sim/sim";
import {
  MAX_REACH,
  type MuzzleOffset,
  muzzlePoint,
  muzzleRole,
  type MuzzleSet,
  spriteMuzzles,
  spriteTipPoint,
  spriteTips,
  type TracerOrigin,
} from "./muzzle";
import type { FrameView } from "./renderer";
import { downPose, liftLevels, newPose, operatorSize, type SpritePose, standingPose } from "./spritePose";

/**
 * Top-down character sprites for the 2D renderer (see docs/assets.md). Loaded once per renderer;
 * until then (or if loading fails) the actors stay Pixi Graphics circles. One `SpriteLayer` per
 * panel draws downs, enemies and the clutcher from a pooled set of Sprites.
 */

/**
 * Per role, the frames of one source: index 0 is the idle / static sprite, 1..n the walk cells
 * (none for a static sprite).
 */
export type SpriteTextures = { readonly operator: readonly Texture[]; readonly enemy: readonly Texture[] };

const OPERATOR_FILE = "sprites/operator.webp";
const ENEMY_FILE = "sprites/enemy.webp";
/** Optional walk sheets: SHEET_GRID × SHEET_GRID cells (256 px each), row-major, cell 0 idle. */
const OPERATOR_WALK_FILE = "sprites/operator-walk.webp";
const ENEMY_WALK_FILE = "sprites/enemy-walk.webp";
export const SHEET_GRID = 3;
const PLAYER_KEY = -1;
/** An enemy sprite within this distance (cm) of a shot's origin is taken as its shooter. */
export const SHOOTER_MATCH_CM = 150;

/**
 * Loads both roles from the app's base URL: the walk sheet when present, else the static sprite
 * (a missing sheet is silent). The enemy falls back to the operator.
 */
export async function loadSpriteTextures(base: string = import.meta.env.BASE_URL): Promise<SpriteTextures> {
  const operator = await loadRole(base + OPERATOR_WALK_FILE, base + OPERATOR_FILE);
  try {
    return { operator, enemy: await loadRole(base + ENEMY_WALK_FILE, base + ENEMY_FILE) };
  } catch {
    return { operator, enemy: operator };
  }
}

/** Destroys every frame and each shared source once. */
export function destroySpriteTextures(t: SpriteTextures): void {
  const sources = new Set<Texture["source"]>();
  for (const frames of new Set([t.operator, t.enemy])) {
    for (const f of frames) {
      sources.add(f.source);
      f.destroy(false);
    }
  }
  for (const s of sources) s.destroy();
}

async function loadRole(sheetUrl: string, staticUrl: string): Promise<readonly Texture[]> {
  const sheet = await decode(sheetUrl).catch(() => null);
  if (sheet && isSheetSize(sheet.naturalWidth, sheet.naturalHeight)) return sheetFrames(sourceOf(sheet));
  const img = await decode(staticUrl);
  return [new Texture({ source: sourceOf(img) })];
}

/**
 * True for a full SHEET_GRID × SHEET_GRID grid of square cells: a square image whose side divides
 * evenly into SHEET_GRID cells (768 × 768 for 256 px cells). Anything else uses the static sprite.
 */
export function isSheetSize(width: number, height: number): boolean {
  return width > 0 && width === height && width % SHEET_GRID === 0;
}

/** Splits a sheet source into its SHEET_GRID² cells, row-major (cell 0 = idle). */
export function sheetFrames(source: Texture["source"]): Texture[] {
  const w = Math.floor(source.width / SHEET_GRID);
  const h = Math.floor(source.height / SHEET_GRID);
  const frames: Texture[] = [];
  for (let i = 0; i < SHEET_GRID * SHEET_GRID; i++) {
    const frame = new Rectangle((i % SHEET_GRID) * w, Math.floor(i / SHEET_GRID) * h, w, h);
    frames.push(new Texture({ source, frame }));
  }
  return frames;
}

/**
 * A plain <img> load (wrapped in an ImageSource by `sourceOf`). Pixi's `Assets` would pull its
 * loader/cache modules (~17 KB gzip) into the initial download for a few images.
 */
async function decode(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error(`sprite ${url} failed to load`);
  }
  return img;
}

/** The image as a texture source, with `liftLevels` applied once over the whole image (sheet). */
function sourceOf(img: HTMLImageElement): Texture["source"] {
  const lifted = liftedCanvas(img);
  return lifted
    ? new CanvasSource({ resource: lifted, alphaMode: "premultiply-alpha-on-upload" })
    : new ImageSource({ resource: img, alphaMode: "premultiply-alpha-on-upload" });
}

/** The image with `liftLevels` applied, or null without a 2D canvas (the raw image is used then). */
function liftedCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  liftLevels(pixels.data);
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

export class SpriteLayer implements TracerOrigin {
  readonly container = new Container();
  private readonly pool: Sprite[] = [];
  private readonly motion = new MotionTracker();
  private readonly pose: SpritePose = newPose();
  private used = 0;
  /** Reduced motion this frame: walk sheets hold their idle cell. */
  private still = false;

  /** Gun tips of the loaded art in the shot frame: the fallback when no drawn shooter matches. */
  readonly muzzles: MuzzleSet;
  /** Gun tips per frame (sprite px) of the clutcher's and the enemies' art. */
  private readonly playerTips: readonly MuzzleOffset[];
  private readonly enemyTips: readonly MuzzleOffset[];
  /** Drawn this frame: the clutcher's gun tip (world) and its reach, or reach < 0 when absent. */
  private readonly playerGun = { x: 0, y: 0, reach: -1 };
  /** Drawn enemies this frame: body x, y, gun tip x, y and reach, flat (reused, no allocation). */
  private readonly enemyGuns: number[] = [];
  private enemyGunCount = 0;
  private readonly tip = { x: 0, y: 0 };

  constructor(private readonly textures: SpriteTextures) {
    const enemyIsOperator = textures.enemy === textures.operator;
    this.muzzles = spriteMuzzles(textures.operator.length, textures.enemy.length, enemyIsOperator);
    this.playerTips = spriteTips("player", textures.operator.length);
    this.enemyTips = spriteTips(enemyIsOperator ? "player" : "enemy", textures.enemy.length);
  }

  /**
   * TracerOrigin: the gun tip of the shooter's sprite as drawn by the last `update` (the clutcher
   * for P0, else the enemy nearest to the shot origin), so the tracer leaves the barrel whatever
   * the sprite's heading or walk cell. Falls back to the shot-frame tip (`muzzlePoint`) without a
   * match or for a shot too short for the drawn tip.
   */
  tracerStart(shot: ShotEvent, out: { x: number; y: number }): Vec2 {
    const len = Math.hypot(shot.to.x - shot.from.x, shot.to.y - shot.from.y);
    const role = muzzleRole(shot.by);
    if (role === "player") {
      const g = this.playerGun;
      if (g.reach >= 0 && g.reach <= len * MAX_REACH) {
        out.x = g.x;
        out.y = g.y;
        return out;
      }
    } else {
      const a = this.enemyGuns;
      let best = -1;
      let bestD = SHOOTER_MATCH_CM * SHOOTER_MATCH_CM;
      for (let i = 0; i < this.enemyGunCount; i++) {
        const dx = a[i * 5]! - shot.from.x;
        const dy = a[i * 5 + 1]! - shot.from.y;
        const d = dx * dx + dy * dy;
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0 && a[best * 5 + 4]! <= len * MAX_REACH) {
        out.x = a[best * 5 + 2]!;
        out.y = a[best * 5 + 3]!;
        return out;
      }
    }
    return muzzlePoint(shot.from, shot.to, this.muzzles[role], out);
  }

  /** Draws `f` (downs, then enemies, then the clutcher, matching the Graphics order). */
  update(f: FrameView, nowMs: number, reducedMotion: boolean, playerColor: number = PLAYER_COLOR): void {
    this.used = 0;
    this.still = reducedMotion;
    this.motion.begin(nowMs, reducedMotion);
    // Indexed loops: no iterator or closure allocation per frame.
    const { downs, enemies } = f;
    for (let i = 0; i < downs.length; i++) {
      const d = downs[i]!;
      const player = d.side === "player";
      const fall = this.motion.fall(d.x, d.y, d.side);
      const frames = player ? this.textures.operator : this.textures.enemy;
      this.place(frames, downPose(this.pose, d.x, d.y, fall, player ? playerColor : ENEMY_COLOR, player ? operatorSize(frames.length) : 1));
    }
    this.enemyGunCount = 0;
    this.playerGun.reach = -1;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      const m = this.motion.actor(e.z ?? i, e.x, e.y, e.fx, e.fy);
      const frames = this.textures.enemy;
      const pose = standingPose(this.pose, e.x, e.y, m, ENEMY_COLOR, 1, frames.length - 1);
      const t = this.gunTip(this.enemyTips, this.place(frames, pose), pose);
      const a = this.enemyGuns;
      const k = this.enemyGunCount++ * 5;
      a[k] = e.x;
      a[k + 1] = e.y;
      a[k + 2] = t.x;
      a[k + 3] = t.y;
      a[k + 4] = Math.hypot(t.x - e.x, t.y - e.y);
    }
    const p = f.player;
    if (p) {
      const dx = p.aim ? p.aim.x - p.x : 0;
      const dy = p.aim ? p.aim.y - p.y : 0;
      // Same rule as the aim cone: an aim inside the body gives no direction.
      const hasDir = p.aim !== null && dx * dx + dy * dy > PLAYER_R * PLAYER_R;
      const face = facing(p, hasDir, dx, dy);
      const m = this.motion.actor(PLAYER_KEY, p.x, p.y, face?.x, face?.y);
      const frames = this.textures.operator;
      const pose = standingPose(this.pose, p.x, p.y, m, playerColor, operatorSize(frames.length), frames.length - 1);
      const t = this.gunTip(this.playerTips, this.place(frames, pose), pose);
      this.playerGun.x = t.x;
      this.playerGun.y = t.y;
      this.playerGun.reach = Math.hypot(t.x - p.x, t.y - p.y);
    }
    this.motion.end();
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }

  /** World gun tip of a sprite placed with `pose` showing `frame` (the shared `tip`, reused). */
  private gunTip(tips: readonly MuzzleOffset[], frame: number, pose: SpritePose): Vec2 {
    return spriteTipPoint(pose.x, pose.y, pose.rotation, pose.scale, tips[frame] ?? tips[0]!, this.tip);
  }

  /**
   * `frames[pose.frame]` placed with `pose`; the idle frame 0 with reduced motion or out of range.
   * Returns the frame index drawn.
   */
  private place(frames: readonly Texture[], pose: SpritePose): number {
    const index = !this.still && frames[pose.frame] ? pose.frame : 0;
    const texture = frames[index]!;
    let s = this.pool[this.used];
    if (!s) {
      s = new Sprite(texture);
      s.anchor.set(0.5);
      this.pool.push(s);
      this.container.addChild(s);
    }
    this.used++;
    if (s.texture !== texture) s.texture = texture;
    s.visible = true;
    s.position.set(pose.x, pose.y);
    s.rotation = pose.rotation;
    s.scale.set(pose.scale);
    s.tint = pose.tint;
    s.alpha = pose.alpha;
    return index;
  }
}
