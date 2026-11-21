import { Application, Container, Graphics, Text } from "pixi.js";
import { clientToCanvas, renderResolution } from "../game/input";
import type { MapDef } from "../maps/types";
import type { Vec2 } from "../sim/geom";
import { DISPLAY_FONT, MONO_FONT } from "../ui/fonts";
import { THEME_NUM } from "../ui/theme";
import { drawFrame } from "./actors";
import { drawMap } from "./mapView";
import type { FrameView, GameRenderer, PanelSpec } from "./renderer";

/** Height of the per-panel header strip (px) on titled (replay) panels. */
const HEADER_H = 32;

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

/** Top-left of a panel's map field (logical px): below the header strip when the panel has a title. */
function fieldOrigin(p: PanelSpec): Vec2 {
  return { x: p.x, y: p.y + (p.title !== undefined ? HEADER_H : 0) };
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
  private panels: { readonly view: Container; readonly dyn: Graphics }[] = [];
  private dirty = false;

  /** Use `createPixi2dRenderer` (Pixi init is async). */
  constructor(private readonly app: Application) {}

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
    this.panels.forEach(({ dyn }, i) => {
      dyn.clear();
      const f = frames[i];
      if (f) drawFrame(dyn, f);
    });
    this.app.render();
  }

  screenToWorld(clientX: number, clientY: number): Vec2 | null {
    if (!this.map) return null;
    // CSS may shrink the canvas and HiDPI renders it at resolution × size: map to logical px.
    const px = clientToCanvas(clientX, clientY, this.app.canvas.getBoundingClientRect(), this.app.screen.width);
    const unit = Math.max(this.map.width, this.map.height);
    for (const p of this.specs) {
      const o = fieldOrigin(p);
      if (px.x < o.x || px.y < o.y || px.x > o.x + p.size || px.y > o.y + p.size) continue;
      const scale = p.size / unit;
      return { x: (px.x - o.x) / scale, y: (px.y - o.y) / scale };
    }
    return null;
  }

  destroy(): void {
    this.panels = [];
    this.app.destroy({ removeView: true }, { children: true });
  }

  private rebuild(): void {
    this.dirty = false;
    for (const { view } of this.panels) view.destroy({ children: true });
    this.panels = [];
    const map = this.map;
    if (!map) return;
    for (const spec of this.specs) {
      const scale = spec.size / Math.max(map.width, map.height);
      const view = new Container();
      view.position.set(spec.x, spec.y);
      const dyn = new Graphics();
      const field = new Container();
      field.position.set(0, fieldOrigin(spec).y - spec.y);
      field.scale.set(scale);
      // Without an explicit value logical px == CSS px (the replay canvas is sized to the viewport).
      field.addChild(drawMap(map, { cssPxPerUnit: this.mapOpts.cssPxPerUnit ?? scale }), dyn);
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
      this.panels.push({ view, dyn });
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
