import { countSound } from "./debugCounts";
import { MOODS, musicNotes, stepSeconds, type Mood, type Note } from "./pattern";
import { noise, tone, type Synth } from "./synth";

/** Music is scheduled this far ahead of the audio clock, from the page's frame loop. */
export const LOOKAHEAD_S = 0.3;

export type Music = {
  setMood(mood: Mood | null): void;
  setIntense(intense: boolean): void;
  setEnabled(enabled: boolean): void;
  /** Call once per frame: schedules every note that starts within the lookahead. */
  pump(): void;
};

function voice(s: Synth, bus: AudioNode, n: Note, t: number, stepS: number): void {
  const dur = n.steps * stepS;
  const o = { t, peak: n.gain, counted: false } as const;
  countSound("music");
  switch (n.voice) {
    case "pad":
      tone(s, bus, "triangle", n.freq, null, { ...o, dur, attack: Math.min(0.6, dur / 3), peak: n.gain * 0.5 });
      tone(s, bus, "sawtooth", n.freq * 1.004, null, { ...o, dur, attack: Math.min(0.6, dur / 3), peak: n.gain * 0.2, filter: { type: "lowpass", freq: 900 } });
      return;
    case "arp":
      tone(s, bus, "triangle", n.freq, null, { ...o, dur });
      return;
    case "bass":
      tone(s, bus, "sawtooth", n.freq, null, { ...o, dur: dur * 0.9, filter: { type: "lowpass", freq: 520, q: 4 } });
      return;
    case "kick":
      tone(s, bus, "sine", 120, 45, { ...o, dur: 0.16 });
      return;
    case "hat":
      noise(s, bus, { ...o, dur: 0.03, filter: { type: "highpass", freq: n.freq } });
      return;
    case "stab":
      tone(s, bus, "square", n.freq, null, { ...o, dur: Math.max(0.08, dur), filter: { type: "lowpass", freq: 1600 } });
      return;
  }
}

/** `bus`: the music bus; its gain follows the mood (0 when disabled). */
export function createMusic(s: Synth, bus: GainNode): Music {
  let mood: Mood | null = null;
  let intense = false;
  let enabled = true;
  let step = 0;
  let nextT = 0;

  const fadeTo = (gain: number, delay: number): void => {
    const t = s.ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.setTargetAtTime(0, t, 0.08);
    if (gain > 0) bus.gain.setTargetAtTime(gain, t + delay, 0.5);
  };

  return {
    setMood(next) {
      if (next === mood) return;
      mood = next;
      step = 0;
      nextT = s.ctx.currentTime + 0.35;
      fadeTo(mood && enabled ? MOODS[mood].gain : 0, 0.3);
    },
    setIntense(v) {
      intense = v;
    },
    setEnabled(v) {
      if (v === enabled) return;
      enabled = v;
      fadeTo(mood && enabled ? MOODS[mood].gain : 0, 0.05);
      nextT = s.ctx.currentTime + 0.1;
    },
    pump() {
      if (!mood || !enabled) return;
      const now = s.ctx.currentTime;
      const stepS = stepSeconds(mood);
      // After a stall (hidden tab, suspended context) restart just ahead instead of a burst of notes.
      if (nextT < now - 0.1) nextT = now + 0.05;
      while (nextT < now + LOOKAHEAD_S) {
        for (const n of musicNotes(step, step + 1, mood, intense)) voice(s, bus, n, nextT, stepS);
        step++;
        nextT += stepS;
      }
    },
  };
}
