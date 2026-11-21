import type { MapDef } from "../maps/types";
import type { Vec2 } from "../sim/geom";
import type { ShotEvent } from "../sim/sim";

/**
 * Renderer-neutral frame data (types only). Pure builders in `game/frameView.ts` fill these from
 * the sim state or the replay model; a 2D or a 3D renderer only draws them. World units throughout.
 */

export type SpikeView = {
  /** Clutcher's defuse progress 0..1. */
  readonly defuse: number;
  /** Highest enemy defuse progress 0..1 (live view only). */
  readonly enemyDefuse?: number;
  /** Seconds, drives the pulse; pass null to keep it still (reduced motion). */
  readonly pulseT: number | null;
};

/**
 * `z` = draw index among enemies and downs (lower first); drawers merge both lists by it so the
 * layering matches the order the actors were visited in.
 */
export type ActorView = {
  readonly x: number;
  readonly y: number;
  /** Facing (unit vector); omitted when unknown (pro replay). */
  readonly fx?: number;
  readonly fy?: number;
  readonly z?: number;
};

export type DownView = {
  readonly x: number;
  readonly y: number;
  readonly side: "player" | "enemy";
  readonly z?: number;
};

export type TracerView = {
  readonly shot: ShotEvent;
  /** Unclamped; drawers clamp to 0..1. */
  readonly fade: number;
};

export type FrameView = {
  /** The clutcher; null once dead in the replay panels (a player-side down stands in). */
  readonly player: { readonly x: number; readonly y: number; readonly aim: Vec2 | null } | null;
  /** Living enemies, already fog-filtered. */
  readonly enemies: readonly ActorView[];
  readonly downs: readonly DownView[];
  /** Planted spike, or null while it is not active. */
  readonly spike: (Vec2 & SpikeView) | null;
  readonly tracers: readonly TracerView[];
};

/** One map panel on the canvas (CSS px); the replay shows two, live play one. */
export type PanelSpec = {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly title?: string;
  readonly note?: string;
  readonly accent?: number;
};

export interface GameRenderer {
  readonly kind: "2d" | "3d";
  readonly canvas: HTMLCanvasElement;
  resize(cssW: number, cssH: number): void;
  loadMap(map: MapDef, opts: { cssPxPerUnit?: number }): void;
  setPanels(panels: readonly PanelSpec[]): void;
  /** One frame per panel, in panel order. */
  draw(frames: readonly FrameView[]): void;
  screenToWorld(clientX: number, clientY: number): Vec2 | null;
  destroy(): void;
}
