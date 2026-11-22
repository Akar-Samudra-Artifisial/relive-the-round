/**
 * Generative background music (pure): an original loop in D minor over Dm - Bb - Gm - A,
 * 16 steps (sixteenth notes) per bar, 4 bars per cycle. The engine asks for the notes of a step
 * range and schedules them; nothing here touches Web Audio.
 */
export type Mood = "menu" | "round" | "calm";
export type Voice = "pad" | "arp" | "bass" | "kick" | "hat" | "stab";

/** `step`: absolute step index; `steps`: length in steps; `gain`: 0..1 before the mood gain. */
export type Note = { readonly step: number; readonly voice: Voice; readonly freq: number; readonly steps: number; readonly gain: number };

export const STEPS_PER_BAR = 16;
export const MOODS: Record<Mood, { readonly bpm: number; readonly gain: number }> = {
  menu: { bpm: 92, gain: 0.28 },
  round: { bpm: 120, gain: 0.22 },
  calm: { bpm: 92, gain: 0.15 },
};

/** Chord tones (MIDI) per bar and the bass root, one octave apart. */
const CHORDS: readonly { readonly tones: readonly [number, number, number]; readonly root: number }[] = [
  { tones: [62, 65, 69], root: 38 }, // Dm
  { tones: [58, 62, 65], root: 34 }, // Bb
  { tones: [55, 58, 62], root: 31 }, // Gm
  { tones: [57, 61, 64], root: 33 }, // A
];

export function mtof(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Seconds per step (a sixteenth note) at the mood's tempo. */
export function stepSeconds(mood: Mood): number {
  return 60 / MOODS[mood].bpm / 4;
}

function chordAt(step: number): (typeof CHORDS)[number] {
  return CHORDS[Math.floor(step / STEPS_PER_BAR) % CHORDS.length]!;
}

function notesAt(step: number, mood: Mood, intense: boolean, out: Note[]): void {
  const pos = step % STEPS_PER_BAR;
  const bar = Math.floor(step / STEPS_PER_BAR);
  const chord = chordAt(step);
  if (mood === "menu" || mood === "calm") {
    if (pos === 0) for (const t of chord.tones) out.push({ step, voice: "pad", freq: mtof(t), steps: STEPS_PER_BAR, gain: 0.35 });
    const arpAt = mood === "menu" ? [0, 6, 10, 12] : [8];
    const k = arpAt.indexOf(pos);
    if (k >= 0) {
      const tone = chord.tones[(bar + k) % 3]!;
      out.push({ step, voice: "arp", freq: mtof(tone + 12), steps: 3, gain: mood === "menu" ? 0.5 : 0.35 });
    }
    if (mood === "menu" && pos === 0) out.push({ step, voice: "bass", freq: mtof(chord.root + 12), steps: 12, gain: 0.4 });
    return;
  }
  // Round: eighth-note bass (octave jump on the off-beat), four-on-the-floor kick, off-beat hat.
  if (pos % 2 === 0) out.push({ step, voice: "bass", freq: mtof(chord.root + (pos % 4 === 2 ? 12 : 0) + 12), steps: 2, gain: 0.6 });
  if (pos % 4 === 0) out.push({ step, voice: "kick", freq: 55, steps: 1, gain: 0.9 });
  if (pos % 4 === 2) out.push({ step, voice: "hat", freq: 8000, steps: 1, gain: 0.35 });
  if (pos === 0) for (const t of chord.tones) out.push({ step, voice: "pad", freq: mtof(t), steps: STEPS_PER_BAR, gain: 0.18 });
  if (!intense) return;
  // Intense layer (spike planted or under 10 s): sixteenth hats, chord stabs and a rising arpeggio.
  if (pos % 2 === 1) out.push({ step, voice: "hat", freq: 9000, steps: 1, gain: 0.2 });
  if (pos === 0 || pos === 10) for (const t of chord.tones) out.push({ step, voice: "stab", freq: mtof(t + 12), steps: 1, gain: 0.3 });
  if (pos % 2 === 0) out.push({ step, voice: "arp", freq: mtof(chord.tones[(pos / 2) % 3]! + 24), steps: 1, gain: 0.25 });
}

/** Notes starting in steps [fromStep, toStep) for the mood (`intense` only changes the round mood). */
export function musicNotes(fromStep: number, toStep: number, mood: Mood, intense = false): Note[] {
  const out: Note[] = [];
  for (let step = Math.max(0, Math.floor(fromStep)); step < toStep; step++) notesAt(step, mood, intense, out);
  return out;
}
