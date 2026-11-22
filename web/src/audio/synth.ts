/**
 * Tiny Web Audio building blocks shared by the sound effects and the music (lazy chunk only).
 * Every voice is a throw-away oscillator or noise source with its own gain envelope.
 */
export type Synth = {
  readonly ctx: AudioContext;
  /** One shared second of white noise, read at random offsets. */
  readonly noise: AudioBuffer;
  /** Live sound-effect voices (music voices are not counted). */
  active: number;
};

/** Low-priority effects (footsteps, bot shots, ticks) are dropped above this many live voices. */
export const VOICE_CAP = 12;
/** Nothing new starts above this many live voices. */
export const VOICE_HARD_CAP = 20;

export function createSynth(ctx: AudioContext): Synth {
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return { ctx, noise, active: 0 };
}

/** Reserves a voice slot; false when the cap is reached. `counted` is false for music voices. */
function claim(s: Synth, low: boolean, counted: boolean): boolean {
  if (!counted) return true;
  if (s.active >= (low ? VOICE_CAP : VOICE_HARD_CAP)) return false;
  s.active++;
  return true;
}

/** Destination for one voice: through a stereo panner when `pan` is non-zero and supported. */
function output(s: Synth, dest: AudioNode, pan: number): AudioNode {
  if (pan === 0 || typeof s.ctx.createStereoPanner !== "function") return dest;
  const p = s.ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest);
  return p;
}

/** Linear attack to `peak`, exponential decay to silence at t + dur. */
function envelope(s: Synth, t: number, dur: number, peak: number, attack: number): GainNode {
  const g = s.ctx.createGain();
  const a = Math.min(attack, dur * 0.5);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(Math.max(1e-4, peak), t + a);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  return g;
}

export type VoiceOpts = {
  readonly t: number;
  readonly dur: number;
  readonly peak: number;
  readonly attack?: number;
  readonly pan?: number;
  /** Dropped first when many sounds overlap. */
  readonly low?: boolean;
  /** False for music voices (not counted against the effect cap). */
  readonly counted?: boolean;
  /** Optional filter in front of the envelope. */
  readonly filter?: { readonly type: BiquadFilterType; readonly freq: number; readonly freqEnd?: number; readonly q?: number };
};

function chain(s: Synth, dest: AudioNode, o: VoiceOpts, src: AudioScheduledSourceNode): void {
  const g = envelope(s, o.t, o.dur, o.peak, o.attack ?? 0.004);
  let head: AudioNode = g;
  if (o.filter) {
    const f = s.ctx.createBiquadFilter();
    f.type = o.filter.type;
    f.frequency.setValueAtTime(o.filter.freq, o.t);
    if (o.filter.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(o.filter.freqEnd, o.t + o.dur);
    f.Q.value = o.filter.q ?? 0.8;
    f.connect(g);
    head = f;
  }
  src.connect(head);
  g.connect(output(s, dest, o.pan ?? 0));
  if (o.counted !== false) src.onended = () => (s.active = Math.max(0, s.active - 1));
}

/** Oscillator voice, optionally gliding from `f0` to `f1`. */
export function tone(s: Synth, dest: AudioNode, type: OscillatorType, f0: number, f1: number | null, o: VoiceOpts): void {
  if (!claim(s, o.low === true, o.counted !== false)) return;
  const osc = s.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, o.t);
  if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(f1, o.t + o.dur);
  chain(s, dest, o, osc);
  osc.start(o.t);
  osc.stop(o.t + o.dur + 0.02);
}

/** Filtered noise burst from the shared buffer. */
export function noise(s: Synth, dest: AudioNode, o: VoiceOpts): void {
  if (!claim(s, o.low === true, o.counted !== false)) return;
  const src = s.ctx.createBufferSource();
  src.buffer = s.noise;
  src.loop = true;
  chain(s, dest, { ...o, attack: o.attack ?? 0.002 }, src);
  // A random start offset keeps repeated bursts from sounding identical.
  src.start(o.t, Math.random() * (s.noise.duration - 0.01));
  src.stop(o.t + o.dur + 0.02);
}
