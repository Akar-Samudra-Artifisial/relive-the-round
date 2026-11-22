import { countSound } from "./debugCounts";
import type { AudioEvent } from "./events";
import { noise, tone, type Synth } from "./synth";

/** Sound-effect recipes (lazy chunk). Every sound is synthesized; there are no audio files. */

export type UiSound = "click" | "scrub";

/** D major arpeggio (win, defuse complete) and its falling minor counterpart (loss). */
const WIN_NOTES = [293.66, 369.99, 440, 587.33];
const LOSE_NOTES = [440, 349.23, 293.66, 220];

export function playUi(s: Synth, bus: AudioNode, kind: UiSound): void {
  const t = s.ctx.currentTime;
  countSound(kind);
  if (kind === "click") tone(s, bus, "sine", 600, null, { t, dur: 0.03, peak: 0.18 });
  else tone(s, bus, "sine", 1200, null, { t, dur: 0.015, peak: 0.06, low: true });
}

function arpeggio(s: Synth, bus: AudioNode, notes: readonly number[], t: number, gap: number, peak: number): void {
  notes.forEach((f, i) => tone(s, bus, "triangle", f, null, { t: t + i * gap, dur: gap * 1.8, peak }));
}

/** `gainMul` scales the whole sound (the replay plays quieter). */
export function playEvent(s: Synth, bus: AudioNode, ev: AudioEvent, gainMul = 1): void {
  const t = s.ctx.currentTime + 0.005;
  const k = gainMul;
  countSound(ev.kind === "step" && ev.enemy ? "enemyStep" : ev.kind);
  switch (ev.kind) {
    case "shot":
      noise(s, bus, { t, dur: 0.08, peak: 0.5 * k, filter: { type: "bandpass", freq: 1800, q: 1 } });
      tone(s, bus, "square", 180, 60, { t, dur: 0.08, peak: 0.22 * k });
      return;
    case "botShot":
      noise(s, bus, { t, dur: 0.09, peak: 0.45 * ev.gain * k, pan: ev.pan, low: true, filter: { type: "lowpass", freq: 1200 } });
      tone(s, bus, "square", 150, 50, { t, dur: 0.09, peak: 0.16 * ev.gain * k, pan: ev.pan, low: true, filter: { type: "lowpass", freq: 900 } });
      return;
    case "hit":
      tone(s, bus, "sine", 1400, null, { t, dur: 0.04, peak: 0.22 * k });
      return;
    case "kill":
      tone(s, bus, "sine", 880, null, { t, dur: 0.07, peak: 0.24 * k });
      tone(s, bus, "sine", 1320, null, { t: t + 0.07, dur: 0.11, peak: 0.24 * k });
      return;
    case "hurt":
      tone(s, bus, "sawtooth", 140, 110, { t, dur: 0.14, peak: 0.2 * k, filter: { type: "lowpass", freq: 1200 } });
      noise(s, bus, { t, dur: 0.1, peak: 0.18 * k, filter: { type: "lowpass", freq: 800 } });
      return;
    case "death":
      tone(s, bus, "sawtooth", 200, 40, { t, dur: 0.9, peak: 0.3 * k, filter: { type: "lowpass", freq: 1400, freqEnd: 200 } });
      return;
    case "step":
      noise(s, bus, { t, dur: 0.05, peak: 0.32 * ev.gain * k, pan: ev.pan, low: true, filter: { type: "lowpass", freq: 300 } });
      return;
    case "defuseStart":
      tone(s, bus, "square", 520, null, { t, dur: 0.06, peak: 0.1 * k, filter: { type: "lowpass", freq: 2000 } });
      return;
    case "defuseTick":
      tone(s, bus, "sine", 600 + ev.progress * 600, null, { t, dur: 0.05, peak: 0.15 * k, low: true });
      return;
    case "defuseDone":
      arpeggio(s, bus, WIN_NOTES.map((f) => f * 2), t, 0.06, 0.12 * k);
      return;
    case "enemyDefuse":
      tone(s, bus, "sawtooth", 330, null, { t, dur: 0.12, peak: 0.12 * k, filter: { type: "lowpass", freq: 1500 } });
      tone(s, bus, "sawtooth", 330, null, { t: t + 0.18, dur: 0.12, peak: 0.12 * k, filter: { type: "lowpass", freq: 1500 } });
      return;
    case "beep":
      tone(s, bus, "sine", ev.hz >= 8 ? 1800 : 1500, null, { t, dur: 0.06, peak: 0.12 * k, low: true });
      return;
    case "explosion":
      noise(s, bus, { t, dur: 1.2, peak: 0.8 * k, attack: 0.01, filter: { type: "lowpass", freq: 3000, freqEnd: 120 } });
      tone(s, bus, "sine", 60, 35, { t, dur: 1.2, peak: 0.6 * k, attack: 0.01 });
      return;
    case "win":
      arpeggio(s, bus, WIN_NOTES, t + 0.15, 0.1, 0.18 * k);
      return;
    case "lose":
      arpeggio(s, bus, LOSE_NOTES, t + 0.15, 0.14, 0.16 * k);
      return;
    case "countdown":
      tone(s, bus, "sine", ev.go ? 990 : 660, null, { t, dur: ev.go ? 0.25 : 0.12, peak: 0.22 * k });
      return;
  }
}
