// sfc32 PRNG. State is a plain tuple so it can live inside SimState and be hashed.

export type RngState = readonly [number, number, number, number];

export function seedRng(seed: number): RngState {
  // splitmix32-style expansion of a 32-bit seed into 4 words.
  let s = seed >>> 0;
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    words.push((z ^ (z >>> 16)) >>> 0);
  }
  let st: RngState = [words[0]!, words[1]!, words[2]!, words[3]!];
  for (let i = 0; i < 12; i++) st = nextU32(st)[1];
  return st;
}

/** Returns [uint32, nextState]. */
export function nextU32(st: RngState): [number, RngState] {
  let [a, b, c, d] = st;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = ((c << 21) | (c >>> 11)) >>> 0;
  c = (c + t) >>> 0;
  return [t, [a >>> 0, b, c, d]];
}

/** Uniform float in [0, 1). */
export function nextFloat(st: RngState): [number, RngState] {
  const [u, n] = nextU32(st);
  return [u / 4294967296, n];
}
