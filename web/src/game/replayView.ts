import { Container, Graphics, Text, type Ticker } from "pixi.js";
import { drawMap } from "../render/mapView";
import { DEFUSE_RADIUS, DEFUSE_S, TICK_HZ } from "../sim/constants";
import { clockAt, type SimState } from "../sim/sim";
import type { World } from "../sim/world";
import { proFrameAt, replaySpan, tickAtTime } from "./replayModel";

// Same palette as the live view in gamePage.ts.
const ENEMY_COLOR = 0xff6b5a;
const PLAYER_COLOR = 0x5ad1ff;
const LABEL_COLOR = 0xf4e4c1;
/** Shot tracers stay visible for this many ticks in the replay (≈ the live 120 ms). */
const TRACER_TICKS = 4;
const PANEL_GAP = 16;

export type ReplaySpeed = 1 | 2 | 4;

export type ReplayViewOptions = {
  readonly world: World;
  /** From `buildYouTimeline` (index = tick). */
  readonly timeline: readonly SimState[];
  /** Pixel size of the area both panels share (side by side). */
  readonly width: number;
  readonly height: number;
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

    const panelW = (opts.width - PANEL_GAP) / 2;
    const map = opts.world.map;
    const scale = Math.min(panelW, opts.height - 40) / Math.max(map.width, map.height);
    const panels: [string, Graphics, string | null][] = [
      ["YOU", this.youDyn, null],
      ["PRO", this.proDyn, "reconstructed from event data"],
    ];
    panels.forEach(([title, dyn, note], i) => {
      const panel = new Container();
      panel.x = i * (panelW + PANEL_GAP);
      const field = new Container();
      field.y = 32;
      field.scale.set(scale);
      field.addChild(drawMap(map), dyn);
      const label = new Text({ text: title, style: { fill: LABEL_COLOR, fontSize: 22, fontWeight: "bold" } });
      panel.addChild(label, field);
      if (note) {
        const small = new Text({ text: note, style: { fill: LABEL_COLOR, fontSize: 12 } });
        small.alpha = 0.7;
        small.position.set(label.width + 12, 8);
        panel.addChild(small);
      }
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
    g.circle(sp.x, sp.y, DEFUSE_RADIUS).stroke({ width: 14, color: 0xff3b3b, alpha: 0.6 });
    g.rect(sp.x - 60, sp.y - 60, 120, 120).fill({ color: 0xff3b3b });
    if (defuseTicks > 0) {
      const frac = defuseTicks / (DEFUSE_S * TICK_HZ);
      g.rect(sp.x - 200, sp.y + 240, 400 * frac, 50).fill({ color: 0x6bff95 });
    }
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
      if (!e.alive) {
        cross(g, e.x, e.y);
        continue;
      }
      // No fog of war in the replay: the viewer sees the whole fight.
      g.circle(e.x, e.y, 110).fill({ color: ENEMY_COLOR });
      g.moveTo(e.x, e.y).lineTo(e.x + e.fx * 220, e.y + e.fy * 220).stroke({ width: 22, color: 0xffffff, alpha: 0.8 });
    }
    if (p.hp > 0) g.circle(p.x, p.y, 120).fill({ color: PLAYER_COLOR }).stroke({ width: 16, color: 0xffffff });
    else cross(g, p.x, p.y, PLAYER_COLOR);
    for (let k = Math.max(1, tick - TRACER_TICKS + 1); k <= tick; k++) {
      for (const shot of this.timeline[k]!.shots) {
        const color = shot.by === "P0" ? 0xfff3b0 : 0xff8a7a;
        g.moveTo(shot.from.x, shot.from.y).lineTo(shot.to.x, shot.to.y).stroke({ width: 14, color, alpha: 0.85 });
      }
    }
  }

  private drawPro(): void {
    const g = this.proDyn;
    g.clear();
    const f = proFrameAt(this.world, this.world.level, this.t);
    this.drawSpike(g, 0);
    for (const k of f.kills) cross(g, k.at.x, k.at.y, k.victim === "P0" ? PLAYER_COLOR : ENEMY_COLOR);
    for (const e of f.enemies) g.circle(e.x, e.y, 110).fill({ color: ENEMY_COLOR });
    if (f.clutcherAlive) {
      g.circle(f.clutcher.x, f.clutcher.y, 120).fill({ color: PLAYER_COLOR }).stroke({ width: 16, color: 0xffffff });
    }
  }
}

function cross(g: Graphics, x: number, y: number, color = ENEMY_COLOR): void {
  g.moveTo(x - 80, y - 80).lineTo(x + 80, y + 80).moveTo(x + 80, y - 80).lineTo(x - 80, y + 80);
  g.stroke({ width: 24, color, alpha: 0.5 });
}
