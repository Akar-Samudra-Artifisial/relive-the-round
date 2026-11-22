import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ui = vi.fn();
vi.mock("../src/audio/engine", () => ({
  createEngine: () => ({
    onPlay: () => undefined,
    resetTracker: () => undefined,
    replay: () => undefined,
    ui,
    setMood: () => undefined,
    setMusicEnabled: () => undefined,
    frame: () => undefined,
  }),
}));

/** AudioContext stand-in whose resume()/suspend() settle only when the test says so. */
class FakeContext {
  static last: FakeContext | null = null;
  state: AudioContextState = "suspended";
  pending: Array<{ ok: () => void; fail: () => void }> = [];
  constructor() {
    FakeContext.last = this;
  }
  resume(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({
        ok: () => {
          this.state = "running";
          resolve();
        },
        fail: () => reject(new Error("not allowed")),
      });
    });
  }
  suspend(): Promise<void> {
    return Promise.resolve().then(() => {
      this.state = "suspended";
    });
  }
  settle(ok: boolean): void {
    for (const p of this.pending.splice(0)) (ok ? p.ok : p.fail)();
  }
}

const doc = { hidden: false, listeners: [] as Array<() => void>, addEventListener(_t: string, fn: () => void) { this.listeners.push(fn); } };
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function ready() {
  const { createGameAudio } = await import("../src/audio");
  const audio = createGameAudio({ search: "", kiosk: false, storage: null, onChange: () => undefined });
  audio.unlock();
  await vi.waitFor(() => {
    audio.click();
    expect(ui).toHaveBeenCalled();
  });
  ui.mockClear();
  return { audio, ctx: FakeContext.last! };
}

describe("audio facade audibility", () => {
  beforeEach(() => {
    doc.hidden = false;
    doc.listeners = [];
    vi.stubGlobal("document", doc);
    vi.stubGlobal("AudioContext", FakeContext);
    ui.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("plays while the first resume() is still pending", async () => {
    const { audio, ctx } = await ready();
    expect(ctx.state).toBe("suspended");
    audio.click();
    expect(ui).toHaveBeenCalledTimes(1);
  });

  it("goes silent at once on mute and audible at once on unmute", async () => {
    const { audio, ctx } = await ready();
    ctx.settle(true);
    await flush();
    audio.toggleMute();
    audio.click(); // suspend() not settled yet: state is still "running"
    expect(ui).not.toHaveBeenCalled();
    await flush();
    expect(ctx.state).toBe("suspended");
    audio.toggleMute();
    audio.click(); // resume() requested but not settled
    expect(ui).toHaveBeenCalledTimes(1);
  });

  it("stops forwarding when resume() is refused and the context stays suspended", async () => {
    const { audio, ctx } = await ready();
    ctx.settle(false);
    await flush();
    audio.click();
    expect(ui).not.toHaveBeenCalled();
  });

  it("is silent while the tab is hidden and audible again on return", async () => {
    const { audio, ctx } = await ready();
    ctx.settle(true);
    await flush();
    doc.hidden = true;
    doc.listeners.forEach((fn) => fn());
    audio.click();
    expect(ui).not.toHaveBeenCalled();
    await flush();
    doc.hidden = false;
    doc.listeners.forEach((fn) => fn());
    audio.click();
    expect(ui).toHaveBeenCalledTimes(1);
  });
});
