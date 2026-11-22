import { CanvasSource, Container, ImageSource, Sprite, Texture } from "pixi.js";
import { MotionTracker } from "./actorMotion";
import { ENEMY_COLOR, PLAYER_COLOR, PLAYER_R } from "./actorStyle";
import type { FrameView } from "./renderer";
import { downPose, liftLevels, newPose, OPERATOR_SIZE, type SpritePose, standingPose } from "./spritePose";

/**
 * Top-down character sprites for the 2D renderer (see docs/assets.md). Loaded once per renderer;
 * until then (or if loading fails) the actors stay Pixi Graphics circles. One `SpriteLayer` per
 * panel draws downs, enemies and the clutcher from a pooled set of Sprites.
 */

export type SpriteTextures = { readonly operator: Texture; readonly enemy: Texture };

const OPERATOR_FILE = "sprites/operator.webp";
const ENEMY_FILE = "sprites/enemy.webp";
const PLAYER_KEY = -1;

/** Loads both sprite textures from the app's base URL; the enemy falls back to the operator. */
export async function loadSpriteTextures(base: string = import.meta.env.BASE_URL): Promise<SpriteTextures> {
  const operator = await loadTexture(base + OPERATOR_FILE);
  try {
    return { operator, enemy: await loadTexture(base + ENEMY_FILE) };
  } catch {
    return { operator, enemy: operator };
  }
}

export function destroySpriteTextures(t: SpriteTextures): void {
  for (const x of new Set([t.operator, t.enemy])) x.destroy(true);
}

/**
 * A plain <img> load wrapped in an ImageSource. Pixi's `Assets` would pull its loader/cache
 * modules (~17 KB gzip) into the initial download for two images.
 */
async function loadTexture(url: string): Promise<Texture> {
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    throw new Error(`sprite ${url} failed to load`);
  }
  const lifted = liftedCanvas(img);
  const source = lifted
    ? new CanvasSource({ resource: lifted, alphaMode: "premultiply-alpha-on-upload" })
    : new ImageSource({ resource: img, alphaMode: "premultiply-alpha-on-upload" });
  return new Texture({ source });
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

export class SpriteLayer {
  readonly container = new Container();
  private readonly pool: Sprite[] = [];
  private readonly motion = new MotionTracker();
  private readonly pose: SpritePose = newPose();
  private used = 0;

  constructor(private readonly textures: SpriteTextures) {}

  /** Draws `f` (downs, then enemies, then the clutcher, matching the Graphics order). */
  update(f: FrameView, nowMs: number, reducedMotion: boolean, playerColor: number = PLAYER_COLOR): void {
    this.used = 0;
    this.motion.begin(nowMs, reducedMotion);
    // Indexed loops: no iterator or closure allocation per frame.
    const { downs, enemies } = f;
    for (let i = 0; i < downs.length; i++) {
      const d = downs[i]!;
      const player = d.side === "player";
      const fall = this.motion.fall(d.x, d.y, d.side);
      this.place(player ? this.textures.operator : this.textures.enemy, downPose(this.pose, d.x, d.y, fall, player ? playerColor : ENEMY_COLOR, player ? OPERATOR_SIZE : 1));
    }
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      const m = this.motion.actor(e.z ?? i, e.x, e.y, e.fx, e.fy);
      this.place(this.textures.enemy, standingPose(this.pose, e.x, e.y, m, ENEMY_COLOR));
    }
    const p = f.player;
    if (p) {
      const dx = p.aim ? p.aim.x - p.x : 0;
      const dy = p.aim ? p.aim.y - p.y : 0;
      // Same rule as the aim cone: an aim inside the body gives no direction.
      const hasDir = p.aim !== null && dx * dx + dy * dy > PLAYER_R * PLAYER_R;
      const m = this.motion.actor(PLAYER_KEY, p.x, p.y, hasDir ? dx : undefined, hasDir ? dy : undefined);
      this.place(this.textures.operator, standingPose(this.pose, p.x, p.y, m, playerColor, OPERATOR_SIZE));
    }
    this.motion.end();
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }

  private place(texture: Texture, pose: SpritePose): void {
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
  }
}
