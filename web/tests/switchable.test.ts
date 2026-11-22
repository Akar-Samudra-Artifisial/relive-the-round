import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KILN } from "../src/maps/kiln";
import type { FrameView, GameRenderer, PanelSpec } from "../src/render/renderer";
import { CONTEXT_LOST, createSwitchableRenderer } from "../src/render/switchable";

type FakeCanvas = {
  style: { visibility: string };
  parent: FakeParent | null;
  readonly parentNode: FakeParent | null;
  replaceWith(next: FakeCanvas): void;
};
type FakeParent = { children: FakeCanvas[] };

function fakeCanvas(): FakeCanvas {
  const c: FakeCanvas = {
    style: { visibility: "" },
    parent: null,
    get parentNode() {
      return c.parent;
    },
    replaceWith(next) {
      const p = c.parent;
      if (!p) return;
      p.children[p.children.indexOf(c)] = next;
      next.parent = p;
      c.parent = null;
    },
  };
  return c;
}

type FakeRenderer = GameRenderer & { calls: string[]; fake: FakeCanvas; throwOn?: "loadMap" | "draw" };

function fakeRenderer(kind: "2d" | "3d"): FakeRenderer {
  const fake = fakeCanvas();
  const r: FakeRenderer = {
    kind,
    calls: [],
    fake,
    canvas: fake as unknown as HTMLCanvasElement,
    resize: (w, h) => void r.calls.push(`resize ${w}x${h}`),
    loadMap: (map, opts) => {
      r.calls.push(`loadMap ${map.name} ${opts.cssPxPerUnit ?? "-"}`);
      if (r.throwOn === "loadMap") throw new Error("boom");
    },
    setPanels: (p) => void r.calls.push(`setPanels ${p.length}`),
    draw: (f) => {
      r.calls.push(`draw ${f.length}`);
      if (r.throwOn === "draw") throw new Error("boom");
    },
    screenToWorld: () => ({ x: 1, y: 2 }),
    destroy: () => void r.calls.push("destroy"),
    setQuality: (t) => void r.calls.push(`quality ${t}`),
  };
  return r;
}

const FRAME: FrameView = { player: null, enemies: [], downs: [], spike: null, tracers: [] };
const PANELS: PanelSpec[] = [
  { x: 0, y: 0, size: 100, title: "YOU" },
  { x: 120, y: 0, size: 100, title: "PRO" },
];

function setup() {
  const primary = fakeRenderer("3d");
  const fallback = fakeRenderer("2d");
  const parent: FakeParent = { children: [primary.fake] };
  primary.fake.parent = parent;
  const onSwap = vi.fn();
  const make = vi.fn(async () => fallback);
  const sw = createSwitchableRenderer(primary, make, onSwap);
  return { primary, fallback, parent, onSwap, make, sw };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("switchable renderer", () => {
  it("forwards every call to the primary", () => {
    const { primary, sw } = setup();
    expect(sw.kind).toBe("3d");
    expect(sw.canvas).toBe(primary.canvas);
    sw.resize(300, 200);
    sw.loadMap(KILN, { cssPxPerUnit: 0.5 });
    sw.setPanels(PANELS);
    sw.draw([FRAME]);
    sw.setQuality?.("low");
    expect(sw.screenToWorld(5, 5)).toEqual({ x: 1, y: 2 });
    sw.destroy();
    expect(primary.calls).toEqual([`resize 300x200`, `loadMap ${KILN.name} 0.5`, "setPanels 2", "draw 1", "quality low", "destroy"]);
  });

  it("swaps: replays resize/loadMap/setPanels in order, replaces the canvas, destroys the old one, warns once", async () => {
    const { primary, fallback, parent, onSwap, sw } = setup();
    sw.loadMap(KILN, { cssPxPerUnit: 0.5 });
    sw.setPanels([PANELS[0]!]);
    sw.resize(640, 480);
    sw.loadMap(KILN, {});
    sw.setPanels(PANELS);
    primary.fake.style.visibility = "hidden";
    await sw.swapToFallback("test");
    expect(fallback.calls).toEqual(["resize 640x480", `loadMap ${KILN.name} -`, "setPanels 2"]);
    expect(primary.calls.at(-1)).toBe("destroy");
    expect(parent.children).toEqual([fallback.fake]);
    expect(fallback.fake.style.visibility).toBe("hidden");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[3d] falling back to 2D: test");
    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(onSwap).toHaveBeenCalledWith(fallback);
    expect(sw.kind).toBe("2d");
    expect(sw.canvas).toBe(fallback.canvas);
    expect(sw.current).toBe(fallback);
    sw.draw([FRAME]);
    expect(fallback.calls.at(-1)).toBe("draw 1");
  });

  it("a second swap is a no-op", async () => {
    const { primary, make, onSwap, sw } = setup();
    const first = sw.swapToFallback("a");
    const second = sw.swapToFallback("b");
    expect(second).toBe(first);
    await first;
    await sw.swapToFallback("c");
    expect(make).toHaveBeenCalledTimes(1);
    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(primary.calls.filter((c) => c === "destroy")).toHaveLength(1);
  });

  it("records calls while the swap is pending and skips draw", async () => {
    const { primary, fallback, sw } = setup();
    sw.resize(100, 100);
    const swap = sw.swapToFallback("pending");
    sw.draw([FRAME]);
    sw.resize(800, 600);
    sw.loadMap(KILN, { cssPxPerUnit: 2 });
    sw.setPanels(PANELS);
    expect(sw.screenToWorld(1, 1)).toBeNull();
    expect(primary.calls).toEqual(["resize 100x100"]);
    await swap;
    expect(fallback.calls).toEqual(["resize 800x600", `loadMap ${KILN.name} 2`, "setPanels 2"]);
  });

  it("primary.loadMap throwing swaps and loads the map on the fallback", async () => {
    const { primary, fallback, onSwap, sw } = setup();
    primary.throwOn = "loadMap";
    sw.resize(500, 500);
    expect(() => sw.loadMap(KILN, { cssPxPerUnit: 1 })).not.toThrow();
    await sw.swapToFallback("ignored");
    expect(fallback.calls).toContain(`loadMap ${KILN.name} 1`);
    expect(warn).toHaveBeenCalledWith("[3d] falling back to 2D: loadMap failed: boom");
    expect(onSwap).toHaveBeenCalledWith(fallback);
  });

  it("primary.draw throwing swaps", async () => {
    const { primary, fallback, sw } = setup();
    primary.throwOn = "draw";
    sw.setPanels([PANELS[0]!]);
    expect(() => sw.draw([FRAME])).not.toThrow();
    await sw.swapToFallback("ignored");
    expect(warn).toHaveBeenCalledWith("[3d] falling back to 2D: draw failed: boom");
    expect(fallback.calls).toEqual(["setPanels 1"]);
  });

  it("primary.onFail triggers the swap and onSwap receives the new renderer", async () => {
    const { primary, fallback, onSwap, sw } = setup();
    expect(typeof primary.onFail).toBe("function");
    primary.onFail?.(CONTEXT_LOST);
    await sw.swapToFallback("ignored");
    expect(warn).toHaveBeenCalledWith("[3d] falling back to 2D: WebGL context lost");
    expect(onSwap).toHaveBeenCalledWith(fallback);
    expect(primary.onFail).toBeUndefined();
  });

  it("a canvas not in the DOM yet is left alone; the wrapper exposes the new canvas", async () => {
    const primary = fakeRenderer("3d");
    const fallback = fakeRenderer("2d");
    const sw = createSwitchableRenderer(primary, async () => fallback, () => {});
    await sw.swapToFallback("early");
    expect(primary.fake.parent).toBeNull();
    expect(sw.canvas).toBe(fallback.canvas);
  });

  it("destroy() during a pending swap destroys the fallback when it resolves", async () => {
    const { primary, fallback, onSwap, sw } = setup();
    const swap = sw.swapToFallback("late");
    sw.destroy();
    await swap;
    expect(primary.calls.filter((c) => c === "destroy")).toHaveLength(1);
    expect(fallback.calls).toEqual(["destroy"]);
    expect(onSwap).not.toHaveBeenCalled();
  });

  describe("when the fallback cannot be created", () => {
    let error: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      error = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      error.mockRestore();
    });

    function failingSetup() {
      const primary = fakeRenderer("3d");
      const make = vi.fn(async (): Promise<GameRenderer> => {
        throw new Error("no 2d");
      });
      const onSwap = vi.fn();
      const sw = createSwitchableRenderer(primary, make, onSwap);
      return { primary, make, onSwap, sw };
    }

    it("stays on the live primary (low fps): catches it up, then forwards and draws again", async () => {
      const { primary, make, onSwap, sw } = failingSetup();
      const swap = sw.swapToFallback("low fps");
      sw.resize(800, 600);
      sw.loadMap(KILN, { cssPxPerUnit: 2 });
      sw.setPanels(PANELS);
      sw.draw([FRAME]);
      await swap;
      expect(primary.calls).toEqual(["resize 800x600", `loadMap ${KILN.name} 2`, "setPanels 2"]);
      sw.draw([FRAME]);
      expect(primary.calls.at(-1)).toBe("draw 1");
      expect(sw.kind).toBe("3d");
      expect(sw.screenToWorld(1, 1)).toEqual({ x: 1, y: 2 });
      await sw.swapToFallback("low fps");
      expect(make).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
      expect(onSwap).not.toHaveBeenCalled();
    });

    it("low fps swap fails, then context loss: stops drawing, one more error, no retry", async () => {
      const { primary, make, sw } = failingSetup();
      await sw.swapToFallback("low fps");
      sw.draw([FRAME]);
      expect(primary.calls.at(-1)).toBe("draw 1");
      primary.onFail?.(CONTEXT_LOST);
      primary.onFail?.(CONTEXT_LOST);
      sw.draw([FRAME]);
      expect(primary.calls.filter((c) => c.startsWith("draw"))).toHaveLength(1);
      expect(make).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(2);
    });

    it("context loss during a pending low-fps swap, fallback fails: dead, primary not resumed", async () => {
      const { primary, make, sw } = failingSetup();
      const swap = sw.swapToFallback("low fps");
      expect(sw.swapping).toBe(true);
      sw.resize(800, 600);
      primary.onFail?.(CONTEXT_LOST);
      await swap;
      expect(sw.swapping).toBe(false);
      sw.draw([FRAME]);
      expect(primary.calls).toEqual([]);
      expect(make).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    });

    it("context loss: logs once, stops trying and stops drawing", async () => {
      const { primary, make, sw } = failingSetup();
      primary.onFail?.(CONTEXT_LOST);
      await sw.swapToFallback("ignored");
      sw.draw([FRAME]);
      primary.throwOn = "draw";
      expect(() => sw.draw([FRAME])).not.toThrow();
      await sw.swapToFallback("again");
      expect(primary.calls.filter((c) => c.startsWith("draw"))).toEqual([]);
      expect(make).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    });
  });
});
