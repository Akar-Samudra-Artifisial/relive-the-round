import { Container, Graphics, Text, type Ticker } from "pixi.js";
import { drawDown, drawEnemy, drawPlayer, drawPro, drawSpike, drawTracer, ENEMY_COLOR, PLAYER_COLOR } from "../render/actors";
import { drawMap } from "../render/mapView";
import { DEFUSE_S, TICK_HZ } from "../sim/constants";
import { clockAt, type SimState } from "../sim/sim";
import type { World } from "../sim/world";
import { DISPLAY_FONT, MONO_FONT } from "../ui/fonts";
import { THEME_NUM } from "../ui/theme";
import { PANEL_CHROME, PANEL_GAP, proFrameAt, replaySpan, tickAtTime, type ReplayLayout } from "./replayModel";

/** Shot tracers stay visible for this many ticks in the replay (≈ the live 120 ms). */
const TRACER_TICKS = 4;
/** Height of the per-panel header strip (px). */
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

export type ReplaySpeed = 1 | 2 | 4;

export type ReplayViewOptions = {
  readonly world: World;
  /** From `buildYouTimeline` (index = tick). */
  readonly timeline: readonly SimState[];
  /** Pixel size of the area both panels share. */
  readonly width: number;
  readonly height: number;
  /** "row" (default): side by side; "column": stacked (narrow portrait screens). */
  readonly layout?: ReplayLayout["layout"];
  /** Called whenever the shown time changes (drive a slider with it). */
  readonly onTime?: (t: number, startT: number, endT: number) => void;
  /** Called when playback reaches the end. */
  readonly onEnd?: () => void;
};

/**
 * Two-panel "you vs pro" replay: left = the player's recorded round, right = the pro's round
 * reconstructed from event data. Both share level-time t. Add `view` to the stage and call
 * `attach(ticker)` for playback; `setTime` works without a ticker (slider scrubbing).
 */
export class ReplayView {
  readonly view = new Container();
  readonly startT: number;
  readonly endT: number;
  private readonly world: World;
  private readonly timeline: readonly SimState[];
  private readonly youDyn = new Graphics();
  private readonly proDyn = new Graphics();
  private readonly onTime: ReplayViewOptions["onTime"];
  private readonly onEnd: ReplayViewOptions["onEnd"];
  private t: number;
  private speed: ReplaySpeed = 1;
  private playing = false;
  private ticker: Ticker | null = null;
  private readonly update = (ticker: Ticker): void => {
    if (!this.playing) return;
    const next = this.t + (ticker.deltaMS / 1000) * this.speed;
    if (next >= this.endT) {
      this.setTime(this.endT);
      this.pause();
      this.onEnd?.();
      return;
    }
    this.setTime(next);
  };

  constructor(opts: ReplayViewOptions) {
    this.world = opts.world;
    this.timeline = opts.timeline;
    this.onTime = opts.onTime;
    this.onEnd = opts.onEnd;
    const span = replaySpan(opts.world, opts.timeline);
    this.startT = span.startT;
    this.endT = span.endT;
    this.t = span.startT;

    const column = opts.layout === "column";
    const panelW = column ? opts.width : (opts.width - PANEL_GAP) / 2;
    const panelH = column ? (opts.height - PANEL_GAP) / 2 : opts.height;
    const map = opts.world.map;
    const fieldPx = Math.min(panelW, panelH - PANEL_CHROME);
    const scale = fieldPx / Math.max(map.width, map.height);
    const panels: [string, Graphics, string, number][] = [
      ["YOU", this.youDyn, "your round", PLAYER_COLOR],
      ["PRO", this.proDyn, "rebuilt from event data", THEME_NUM.amber],
    ];
    panels.forEach(([title, dyn, note, accent], i) => {
      const panel = new Container();
      if (column) panel.y = i * (panelH + PANEL_GAP);
      else panel.x = i * (panelW + PANEL_GAP);
      const field = new Container();
      field.y = HEADER_H;
      field.scale.set(scale);
      // The replay canvas is sized to the viewport, so logical px == CSS px here.
      field.addChild(drawMap(map, { cssPxPerUnit: scale }), dyn);
      panel.addChild(hudHeader(fieldPx, accent), field);
      // Thin frame around the map, with an accent tick in the top-left corner.
      const frame = new Graphics()
        .rect(0.5, HEADER_H + 0.5, fieldPx - 1, fieldPx - 1)
        .stroke({ width: 1, color: THEME_NUM.lineHi })
        .moveTo(0.5, HEADER_H + 18)
        .lineTo(0.5, HEADER_H + 0.5)
        .lineTo(18, HEADER_H + 0.5)
        .stroke({ width: 2, color: accent });
      const label = new Text({
        text: title,
        style: { fill: accent, fontFamily: DISPLAY_FONT, fontSize: 18, fontWeight: "700", letterSpacing: 3 },
      });
      label.position.set(16, 5);
      const small = new Text({
        text: note.toUpperCase(),
        style: { fill: THEME_NUM.textDim, fontFamily: MONO_FONT, fontSize: 11, letterSpacing: 1 },
      });
      small.position.set(label.x + label.width + 12, 10);
      if (small.x + small.width > fieldPx - 8) small.visible = false;
      panel.addChild(frame, label, small);
      this.view.addChild(panel);
    });
    this.setTime(this.startT);
  }

  get time(): number {
    return this.t;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Hook playback into a Pixi ticker (e.g. app.ticker). */
  attach(ticker: Ticker): void {
    this.ticker?.remove(this.update);
    this.ticker = ticker;
    ticker.add(this.update);
  }

  setTime(t: number): void {
    this.t = Math.min(Math.max(t, this.startT), this.endT);
    this.drawYou();
    this.drawPro();
    this.onTime?.(this.t, this.startT, this.endT);
  }

  play(): void {
    if (this.t >= this.endT) this.setTime(this.startT);
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  setSpeed(speed: ReplaySpeed): void {
    this.speed = speed;
  }

  destroy(): void {
    this.playing = false;
    this.ticker?.remove(this.update);
    this.ticker = null;
    this.view.destroy({ children: true });
  }

  private drawSpike(g: Graphics, defuseTicks: number): void {
    const sp = this.world.spike;
    if (!sp || !clockAt(this.world, this.t).spikeActive) return;
    // Still (no pulse): the replay is scrubbed, a pulse tied to wall time would jitter.
    drawSpike(g, sp, { defuse: defuseTicks / (DEFUSE_S * TICK_HZ), pulseT: null });
  }

  private drawYou(): void {
    const g = this.youDyn;
    g.clear();
    const tick = tickAtTime(this.world, this.t, this.timeline.length);
    // Clamped: holds the final state once the player's round is over.
    const s = this.timeline[tick]!;
    const p = s.clutcher;
    this.drawSpike(g, p.defuseTicks);
    for (const e of s.enemies) {
      // No fog of war in the replay: the viewer sees the whole fight.
      if (!e.alive) drawDown(g, e.x, e.y);
      else drawEnemy(g, e);
    }
    // The recorded round has no aim data per tick here: body only.
    if (p.hp > 0) drawPlayer(g, p, null);
    else drawDown(g, p.x, p.y, PLAYER_COLOR);
    for (let k = Math.max(1, tick - TRACER_TICKS + 1); k <= tick; k++) {
      const fade = 1 - (tick - k) / TRACER_TICKS;
      for (const shot of this.timeline[k]!.shots) drawTracer(g, shot, fade);
    }
  }

  private drawPro(): void {
    const g = this.proDyn;
    g.clear();
    const f = proFrameAt(this.world, this.world.level, this.t);
    this.drawSpike(g, 0);
    for (const k of f.kills) drawDown(g, k.at.x, k.at.y, k.victim === "P0" ? PLAYER_COLOR : ENEMY_COLOR);
    for (const e of f.enemies) drawEnemy(g, e);
    if (f.clutcherAlive) drawPro(g, f.clutcher);
  }
}
