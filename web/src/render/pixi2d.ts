import { Application, Container, Graphics, Text } from "pixi.js";
import { clientToCanvas, renderResolution } from "../game/input";
import type { MapDef } from "../maps/types";
import type { Vec2 } from "../sim/geom";
import { DISPLAY_FONT, MONO_FONT } from "../ui/fonts";
import { THEME_NUM } from "../ui/theme";
import { drawFrameUnder, drawTracers } from "./actors";
import { destroySpriteTextures, loadSpriteTextures, SpriteLayer, type SpriteTextures } from "./actorSprites";
import { PLAYER_COLOR } from "./actorStyle";
import { drawMap } from "./mapView";
import { fieldRect, HEADER_H } from "./panelLayout";
import type { FrameView, GameRenderer, PanelSpec } from "./renderer";

/** HUD header strip: dark plate with a bevelled right end, accent bar on the left edge. */
function hudHeader(w: number, accent: number): Graphics {
  const h = HEADER_H - 4;
  const b = 10;
  return new Graphics()
    .poly([0, 0, w - b, 0, w, b, w, h, 0, h])
    .fill({ color: THEME_NUM.surface })
    .stroke({ width: 1, color: THEME_NUM.line, alignment: 1 })
    .rect(0, 0, 4, h)
    .fill({ color: accent });
}

/**
 * The 2D (Pixi) renderer. It never runs the Pixi ticker: the game's own frame loop calls `draw`
 * once per frame, which draws every panel and renders once.
 */
export class Pixi2dRenderer implements GameRenderer {
  readonly kind = "2d" as const;
  private map: MapDef | null = null;
  private mapOpts: { cssPxPerUnit?: number } = {};
  private specs: readonly PanelSpec[] = [];
  /**
   * Per panel, bottom to top: map, `under` (spike, glows, cones, down marks, and the body circles
   * while no sprites are loaded), `sprites` (character sprites, null until loaded), `over` (tracers).
   */
  private panels: {
    readonly view: Container;
    readonly under: Graphics;
    readonly sprites: SpriteLayer | null;
    readonly over: Graphics;
    readonly color: number;
  }[] = [];
  private dirty = false;
  private textures: SpriteTextures | null = null;
  private destroyed = false;
  private readonly motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  /** Use `createPixi2dRenderer` (Pixi init is async). */
  constructor(private readonly app: Application) {
    // Character sprites are optional: on failure the Graphics bodies stay, with one warning.
    loadSpriteTextures().then(
      (textures) => {
        if (this.destroyed) {
          destroySpriteTextures(textures);
          return;
        }
        this.textures = textures;
        this.dirty = true;
      },
      (err: unknown) => {
        console.warn("[2d] character sprites unavailable, keeping circle bodies:", err instanceof Error ? err.message : err);
      },
    );
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  resize(cssW: number, cssH: number): void {
    this.app.renderer.resize(cssW, cssH);
  }

  loadMap(map: MapDef, opts: { cssPxPerUnit?: number }): void {
    this.map = map;
    this.mapOpts = { ...opts };
    this.dirty = true;
  }

  setPanels(panels: readonly PanelSpec[]): void {
    this.specs = [...panels];
    this.dirty = true;
  }

  draw(frames: readonly FrameView[]): void {
    if (this.dirty) this.rebuild();
    const now = performance.now();
    const reduced = this.motionQuery?.matches ?? false;
    this.panels.forEach(({ under, sprites, over, color }, i) => {
      under.clear();
      over.clear();
      const f = frames[i];
      if (sprites) sprites.container.visible = f !== undefined;
      if (!f) return;
      drawFrameUnder(under, f, { bodies: sprites === null, playerColor: color });
      sprites?.update(f, now, reduced, color);
      drawTracers(over, f, sprites);
    });
    this.app.render();
  }

  screenToWorld(clientX: number, clientY: number): Vec2 | null {
    if (!this.map) return null;
    // CSS may shrink the canvas and HiDPI renders it at resolution × size: map to logical px.
    const px = clientToCanvas(clientX, clientY, this.app.canvas.getBoundingClientRect(), this.app.screen.width);
    const unit = Math.max(this.map.width, this.map.height);
    for (const p of this.specs) {
      const field = fieldRect(p);
      if (px.x < field.x || px.y < field.y || px.x >= field.x + field.w || px.y >= field.y + field.h) continue;
      const scale = field.w / unit;
      return { x: (px.x - field.x) / scale, y: (px.y - field.y) / scale };
    }
    return null;
  }

  destroy(): void {
    // Sprites go with the stage; the textures are owned by this renderer.
    this.destroyed = true;
    this.panels = [];
    this.app.destroy({ removeView: true }, { children: true });
    if (this.textures) destroySpriteTextures(this.textures);
    this.textures = null;
  }

  private rebuild(): void {
    this.dirty = false;
    for (const { view } of this.panels) view.destroy({ children: true });
    this.panels = [];
    const map = this.map;
    if (!map) return;
    for (const spec of this.specs) {
      const scale = spec.size / Math.max(map.width, map.height);
      const fieldArea = fieldRect(spec);
      const view = new Container();
      view.position.set(spec.x, spec.y);
      const under = new Graphics();
      const over = new Graphics();
      const sprites = this.textures ? new SpriteLayer(this.textures) : null;
      const field = new Container();
      field.position.set(0, fieldArea.y - spec.y);
      field.scale.set(scale);
      // Without an explicit value logical px == CSS px (the replay canvas is sized to the viewport).
      field.addChild(drawMap(map, { cssPxPerUnit: this.mapOpts.cssPxPerUnit ?? scale }), under);
      if (sprites) field.addChild(sprites.container);
      field.addChild(over);
      if (spec.title !== undefined) {
        const accent = spec.accent ?? THEME_NUM.cyan;
        const fieldPx = spec.size;
        view.addChild(hudHeader(fieldPx, accent), field);
        // Thin frame around the map, with an accent tick in the top-left corner.
        const frame = new Graphics()
          .rect(0.5, HEADER_H + 0.5, fieldPx - 1, fieldPx - 1)
          .stroke({ width: 1, color: THEME_NUM.lineHi })
          .moveTo(0.5, HEADER_H + 18)
          .lineTo(0.5, HEADER_H + 0.5)
          .lineTo(18, HEADER_H + 0.5)
          .stroke({ width: 2, color: accent });
        const label = new Text({
          text: spec.title,
          style: { fill: accent, fontFamily: DISPLAY_FONT, fontSize: 18, fontWeight: "700", letterSpacing: 3 },
        });
        label.position.set(16, 5);
        view.addChild(frame, label);
        if (spec.note !== undefined) {
          const small = new Text({
            text: spec.note.toUpperCase(),
            style: { fill: THEME_NUM.textDim, fontFamily: MONO_FONT, fontSize: 11, letterSpacing: 1 },
          });
          small.position.set(label.x + label.width + 12, 10);
          if (small.x + small.width > fieldPx - 8) small.visible = false;
          view.addChild(small);
        }
      } else {
        view.addChild(field);
      }
      this.app.stage.addChild(view);
      // YOU stays cyan, PRO gets its amber panel accent.
      this.panels.push({ view, under, sprites, over, color: spec.accent ?? PLAYER_COLOR });
    }
  }
}

/** Same Pixi setup as before the renderer seam, minus the ticker (`autoStart: false`). */
export async function createPixi2dRenderer(opts: { width: number; height: number }): Promise<Pixi2dRenderer> {
  const app = new Application();
  // HiDPI: render at devicePixelRatio (capped at 2) with the same CSS size (autoDensity).
  await app.init({
    width: opts.width,
    height: opts.height,
    background: THEME_NUM.bg,
    antialias: true,
    resolution: renderResolution(window.devicePixelRatio),
    autoDensity: true,
    autoStart: false,
  });
  // Belt and braces: our frame loop renders, the ticker must never render a second time.
  app.ticker.stop();
  return new Pixi2dRenderer(app);
}
