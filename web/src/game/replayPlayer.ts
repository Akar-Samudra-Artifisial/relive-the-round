import type { FrameView, PanelSpec } from "../render/renderer";
import type { SimState } from "../sim/sim";
import type { World } from "../sim/world";
import { THEME_NUM } from "../ui/theme";
import { proFrame, youFrame } from "./frameView";
import { PANEL_CHROME, PANEL_GAP, replaySpan, type ReplayLayout } from "./replayModel";

export type ReplaySpeed = 1 | 2 | 4;

export type ReplayPlayerOptions = {
  readonly world: World;
  /** From `buildYouTimeline` (index = tick). */
  readonly timeline: readonly SimState[];
  /** Called whenever the shown time changes (drive a slider with it). */
  readonly onTime?: (t: number, startT: number, endT: number) => void;
  /** Called when playback reaches the end. */
  readonly onEnd?: () => void;
};

/**
 * Two-panel "you vs pro" replay, renderer-agnostic: left = the player's recorded round, right =
 * the pro's round reconstructed from event data. Both share level-time t. Call `update(deltaMS)`
 * once per frame for playback; `setTime` works without it (slider scrubbing). A renderer draws
 * `frames()` into `panels(...)`.
 */
export class ReplayPlayer {
  readonly startT: number;
  readonly endT: number;
  private readonly world: World;
  private readonly timeline: readonly SimState[];
  private readonly onTime: ReplayPlayerOptions["onTime"];
  private readonly onEnd: ReplayPlayerOptions["onEnd"];
  private t: number;
  private speed: ReplaySpeed = 1;
  private playing = false;
  private cache: { t: number; frames: FrameView[] } | null = null;

  constructor(opts: ReplayPlayerOptions) {
    this.world = opts.world;
    this.timeline = opts.timeline;
    this.onTime = opts.onTime;
    this.onEnd = opts.onEnd;
    const span = replaySpan(opts.world, opts.timeline);
    this.startT = span.startT;
    this.endT = span.endT;
    this.t = span.startT;
    this.setTime(this.startT);
  }

  get time(): number {
    return this.t;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setTime(t: number): void {
    this.t = Math.min(Math.max(t, this.startT), this.endT);
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

  /** Advances playback by one frame; at the end it stops on `endT` and fires `onEnd` once. */
  update(deltaMS: number): void {
    if (!this.playing) return;
    const next = this.t + (deltaMS / 1000) * this.speed;
    if (next >= this.endT) {
      this.setTime(this.endT);
      this.pause();
      this.onEnd?.();
      return;
    }
    this.setTime(next);
  }

  /** [YOU, PRO] at the current time. No fog of war in the replay: the viewer sees the whole fight. */
  frames(): FrameView[] {
    if (this.cache?.t !== this.t) {
      this.cache = { t: this.t, frames: [youFrame(this.world, this.timeline, this.t), proFrame(this.world, this.t)] };
    }
    return this.cache.frames;
  }

  /**
   * Panel layout for a `width × height` canvas: "row" (default) side by side, "column" stacked
   * (narrow portrait screens). Each panel has a header strip above its square map field.
   */
  panels(width: number, height: number, layout?: ReplayLayout["layout"]): PanelSpec[] {
    const column = layout === "column";
    const panelW = column ? width : (width - PANEL_GAP) / 2;
    const panelH = column ? (height - PANEL_GAP) / 2 : height;
    const size = Math.min(panelW, panelH - PANEL_CHROME);
    const specs: [string, string, number][] = [
      ["YOU", "your round", THEME_NUM.cyan],
      ["PRO", "rebuilt from event data", THEME_NUM.amber],
    ];
    return specs.map(([title, note, accent], i) => ({
      x: column ? 0 : i * (panelW + PANEL_GAP),
      y: column ? i * (panelH + PANEL_GAP) : 0,
      size,
      title,
      note,
      accent,
    }));
  }
}
