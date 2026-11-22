import type { SimStats } from "../sim/sim";
import type { Engine } from "./engine";
import type { PlaySnapshot } from "./events";
import type { Mood } from "./pattern";
import { baseSettings, loadSettings, saveSettings, settingsContext, toggleMuted, type AudioSettings, type SettingsStore } from "./settings";

/**
 * Small entry-chunk facade. Browsers only allow audio after a user gesture (iOS also needs the
 * AudioContext created and resumed synchronously inside it), so `unlock` must be called from
 * gesture handlers; it then loads the engine chunk via import(). Until then every call is a no-op.
 */

export type AudioScene = "attract" | "idle" | "play" | "score" | "replay";

const SCENE_MOOD: Record<AudioScene, Mood> = { attract: "menu", idle: "menu", play: "round", score: "calm", replay: "calm" };
/** Replay sounds (YOU panel) play at this fraction of the live loudness. */
export const REPLAY_GAIN = 0.45;
/** Replay slider scrub ticks are throttled to one per this many ms. */
export const SCRUB_GAP_MS = 60;

export type GameAudio = {
  readonly settings: AudioSettings;
  unlock(): void;
  toggleMute(): void;
  setScene(scene: AudioScene): void;
  onPlay(snap: PlaySnapshot): void;
  onReplay(a: SimStats, b: SimStats): void;
  click(): void;
  scrub(nowMs: number): void;
  /** Once per frame (music scheduling). */
  frame(): void;
};

export type GameAudioOptions = {
  readonly search: string;
  readonly kiosk: boolean;
  readonly storage: SettingsStore | null;
  readonly onChange: (s: AudioSettings) => void;
};

export function createGameAudio(opts: GameAudioOptions): GameAudio {
  const cfg = settingsContext(opts.search, opts.kiosk);
  let settings = loadSettings(cfg, opts.storage);
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== "undefined" ? AudioContext : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  let ac: AudioContext | null = null;
  let engine: Engine | null = null;
  let loading = false;
  let scene: AudioScene | null = null;
  let lastScrubMs = -Infinity;

  // resume()/suspend() settle asynchronously: `wanted` follows the latest request and `resuming`
  // counts unsettled resume calls, so sounds play right after unmute/tab return (no dropped frames)
  // and stop at once on mute/hide, without queueing onto a context that stays suspended.
  let wanted = false;
  let resuming = 0;
  const audible = (): boolean => !settings.muted && wanted && ac !== null && (ac.state === "running" || resuming > 0);
  const suspend = (): void => {
    wanted = false;
    void ac?.suspend().catch(() => undefined);
  };
  const resume = (): void => {
    if (!ac || settings.muted || document.hidden) return;
    wanted = true;
    // Also when "running": a suspend() may still be in flight and would otherwise win.
    resuming++;
    ac.resume()
      .catch(() => undefined)
      .finally(() => resuming--);
  };

  const unlock = (): void => {
    if (settings.muted || !Ctor) return;
    if (!ac) {
      try {
        ac = new Ctor({ latencyHint: "interactive" });
      } catch (err) {
        console.warn("[audio] AudioContext unavailable", err);
        return;
      }
    }
    resume();
    if (engine || loading) return;
    loading = true;
    const ctx = ac;
    import("./engine")
      .then((m) => {
        engine = m.createEngine(ctx);
        engine.setMusicEnabled(settings.music);
        engine.setMood(scene ? SCENE_MOOD[scene] : null);
      })
      .catch((err: unknown) => {
        loading = false;
        console.warn("[audio] engine failed to load", err);
      });
  };

  /** `gesture`: called from a user gesture, so the context may be created now. */
  const apply = (next: AudioSettings, gesture: boolean): void => {
    settings = next;
    engine?.setMusicEnabled(next.music);
    if (next.muted) suspend();
    else if (gesture) unlock();
    else resume();
    opts.onChange(next);
  };

  document.addEventListener("visibilitychange", () => (document.hidden ? suspend() : resume()));

  return {
    get settings() {
      return settings;
    },
    unlock,
    toggleMute() {
      const next = toggleMuted(settings);
      saveSettings(cfg, opts.storage, next);
      apply(next, true);
    },
    setScene(next) {
      // A booth returns to its defaults for the next visitor.
      if (next === "idle" && opts.kiosk) apply(baseSettings(cfg), false);
      if (next !== "play") engine?.resetTracker();
      scene = next;
      engine?.setMood(SCENE_MOOD[next]);
    },
    onPlay(snap) {
      engine?.onPlay(snap, audible());
    },
    onReplay(a, b) {
      if (audible()) engine?.replay(a, b, REPLAY_GAIN);
    },
    click() {
      if (audible()) engine?.ui("click");
    },
    scrub(nowMs) {
      if (!audible() || nowMs - lastScrubMs < SCRUB_GAP_MS) return;
      lastScrubMs = nowMs;
      engine?.ui("scrub");
    },
    frame() {
      if (audible()) engine?.frame();
    },
  };
}
