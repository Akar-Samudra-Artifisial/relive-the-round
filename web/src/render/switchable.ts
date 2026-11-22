import type { MapDef } from "../maps/types";
import type { Vec2 } from "../sim/geom";
import type { QualityTier } from "./quality";
import type { FrameView, GameRenderer, PanelSpec } from "./renderer";

export interface SwitchableRenderer extends GameRenderer {
  /** The renderer calls are forwarded to right now (the primary until a swap completes). */
  readonly current: GameRenderer;
  /** True while a swap is pending (calls are recorded, `draw` and `setQuality` are skipped). */
  readonly swapping: boolean;
  /** Replaces the primary with the fallback once; later calls return the same promise. */
  swapToFallback(reason: string): Promise<void>;
}

/** The reason `Three3dRenderer` reports through `onFail` on `webglcontextlost`. */
export const CONTEXT_LOST = "WebGL context lost";

/**
 * Wraps a primary renderer (3D) so it can be replaced by a fallback (2D) at runtime without the
 * caller noticing. Remembers the last `resize`, `loadMap` and `setPanels` and replays them, in that
 * order, on the fallback. A throwing `primary.loadMap` / `primary.draw` or `primary.onFail` triggers
 * the swap instead of an error. While the swap is pending, calls are recorded and `draw` is skipped.
 */
export function createSwitchableRenderer(
  primary: GameRenderer,
  makeFallback: () => Promise<GameRenderer>,
  onSwap: (next: GameRenderer) => void,
): SwitchableRenderer {
  let current: GameRenderer = primary;
  let pending = false;
  let swap: Promise<void> | null = null;
  /** The fallback could not be created: stay on the primary and never try again. */
  let gaveUp = false;
  /** The primary's WebGL context is gone and there is no fallback: draw nothing. */
  let dead = false;
  /** Set by the primary's `onFail(CONTEXT_LOST)`, whatever swap is in flight. */
  let contextLost = false;
  let destroyed = false;
  let lastResize: [number, number] | null = null;
  let lastMap: [MapDef, { cssPxPerUnit?: number }] | null = null;
  let lastPanels: readonly PanelSpec[] | null = null;

  const onPrimary = (): boolean => current === primary && swap === null;

  /** Catches the primary up on what was recorded while the failed swap was pending. */
  const resumePrimary = (): void => {
    try {
      if (lastResize) primary.resize(lastResize[0], lastResize[1]);
      if (lastMap) primary.loadMap(lastMap[0], lastMap[1]);
      if (lastPanels) primary.setPanels(lastPanels);
    } catch (err) {
      console.error("[3d] renderer failed after the 2D fallback failed", err);
    }
  };

  /** Context lost with no fallback: stop drawing, log once. */
  const markDead = (err?: unknown): void => {
    if (dead) return;
    dead = true;
    console.error(`[3d] ${CONTEXT_LOST} and no 2D fallback; nothing left to draw with`, err);
  };

  const swapToFallback = (reason: string): Promise<void> => {
    if (reason === CONTEXT_LOST) contextLost = true;
    if (swap) return swap;
    if (gaveUp) {
      if (contextLost) markDead();
      return Promise.resolve();
    }
    if (destroyed) return Promise.resolve();
    pending = true;
    const old = primary;
    swap = (async () => {
      let next: GameRenderer;
      try {
        next = await makeFallback();
      } catch (err) {
        gaveUp = true;
        pending = false;
        swap = null;
        // The context may have been lost while a swap for another reason was pending.
        if (contextLost) {
          markDead(err);
        } else {
          console.error(`[3d] 2D fallback failed ("${reason}"); staying on 3D`, err);
          if (!destroyed) resumePrimary();
        }
        return;
      }
      if (destroyed) {
        next.destroy();
        return;
      }
      const oldCanvas = old.canvas;
      next.canvas.style.visibility = oldCanvas.style.visibility;
      // A canvas not in the DOM yet is left alone: the page appends `renderer.canvas` (the new one).
      if (oldCanvas.parentNode) oldCanvas.replaceWith(next.canvas);
      current = next;
      pending = false;
      if (lastResize) next.resize(lastResize[0], lastResize[1]);
      if (lastMap) next.loadMap(lastMap[0], lastMap[1]);
      if (lastPanels) next.setPanels(lastPanels);
      old.onFail = undefined;
      try {
        old.destroy();
      } catch {
        // A lost WebGL context may refuse to clean up; the canvas is already out of the DOM.
      }
      console.warn(`[3d] falling back to 2D: ${reason}`);
      onSwap(next);
    })();
    return swap;
  };

  primary.onFail = (reason) => void swapToFallback(reason);

  return {
    get kind() {
      return current.kind;
    },
    get canvas() {
      return current.canvas;
    },
    get current() {
      return current;
    },
    get swapping() {
      return pending;
    },
    resize(cssW: number, cssH: number): void {
      lastResize = [cssW, cssH];
      if (!pending) current.resize(cssW, cssH);
    },
    loadMap(map: MapDef, opts: { cssPxPerUnit?: number }): void {
      lastMap = [map, opts];
      if (pending) return;
      if (!onPrimary()) {
        current.loadMap(map, opts);
        return;
      }
      try {
        primary.loadMap(map, opts);
      } catch (err) {
        void swapToFallback(`loadMap failed: ${errorText(err)}`);
      }
    },
    setPanels(panels: readonly PanelSpec[]): void {
      lastPanels = [...panels];
      if (!pending) current.setPanels(panels);
    },
    draw(frames: readonly FrameView[]): void {
      if (pending || dead) return;
      if (!onPrimary()) {
        current.draw(frames);
        return;
      }
      try {
        primary.draw(frames);
      } catch (err) {
        void swapToFallback(`draw failed: ${errorText(err)}`);
      }
    },
    screenToWorld(clientX: number, clientY: number): Vec2 | null {
      return pending ? null : current.screenToWorld(clientX, clientY);
    },
    setQuality(tier: QualityTier): void {
      if (!pending) current.setQuality?.(tier);
    },
    destroy(): void {
      if (destroyed) return;
      // A swap still pending destroys its fallback as soon as it resolves.
      destroyed = true;
      current.destroy();
    },
    swapToFallback,
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
