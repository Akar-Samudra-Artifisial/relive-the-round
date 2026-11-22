import type { SimStats } from "../sim/sim";
import { replayEvents, track, type AudioEvent, type PlaySnapshot, type Tracker } from "./events";
import { createMusic } from "./music";
import type { Mood } from "./pattern";
import { playEvent, playUi, type UiSound } from "./sfx";
import { createSynth } from "./synth";

/**
 * Audio engine (lazy chunk, loaded via import() on the first user gesture). Graph:
 * sfxBus + musicBus → duck → master → DynamicsCompressor → destination.
 */

/** Music drops by 6 dB for this long under explosions and stingers. */
export const DUCK_S = 0.4;
const DUCK_GAIN = 0.5;
const DUCKING: ReadonlySet<AudioEvent["kind"]> = new Set(["explosion", "win", "lose", "death"]);
/** The intense music layer starts below this many seconds left (or once the spike is planted). */
export const INTENSE_BELOW_S = 10;

export type Engine = {
  /** Live round frame: always tracked (so unmuting mid-round has no burst), played when `audible`. */
  onPlay(snap: PlaySnapshot, audible: boolean): void;
  /** Forget the live round (left the play screen). */
  resetTracker(): void;
  replay(a: SimStats, b: SimStats, gainMul: number): void;
  ui(kind: UiSound): void;
  setMood(mood: Mood | null): void;
  setMusicEnabled(enabled: boolean): void;
  /** Once per frame while audible. */
  frame(): void;
};

export function createEngine(ctx: AudioContext): Engine {
  const synth = createSynth(ctx);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp);
  const sfxBus = ctx.createGain();
  sfxBus.connect(master);
  const duck = ctx.createGain();
  duck.connect(master);
  const musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  musicBus.connect(duck);
  const music = createMusic(synth, musicBus);
  let tracker: Tracker | null = null;

  const ducking = (): void => {
    const t = ctx.currentTime;
    duck.gain.cancelScheduledValues(t);
    duck.gain.setValueAtTime(duck.gain.value, t);
    duck.gain.setTargetAtTime(DUCK_GAIN, t, 0.02);
    duck.gain.setTargetAtTime(1, t + DUCK_S, 0.15);
  };

  return {
    onPlay(snap, audible) {
      const r = track(tracker, snap);
      tracker = r.next;
      music.setIntense(snap.clock.spikeActive || snap.clock.secondsLeft < INTENSE_BELOW_S);
      if (!audible) return;
      for (const ev of r.events) {
        playEvent(synth, sfxBus, ev);
        if (DUCKING.has(ev.kind)) ducking();
      }
    },
    resetTracker() {
      tracker = null;
      music.setIntense(false);
    },
    replay(a, b, gainMul) {
      for (const ev of replayEvents(a, b)) playEvent(synth, sfxBus, ev, gainMul);
    },
    ui(kind) {
      playUi(synth, sfxBus, kind);
    },
    setMood: (mood) => music.setMood(mood),
    setMusicEnabled: (enabled) => music.setEnabled(enabled),
    frame: () => music.pump(),
  };
}
