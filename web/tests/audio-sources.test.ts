import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const entries = Object.entries(sources);
const audio = (name: string): string => entries.find(([p]) => p.endsWith(`/src/audio/${name}`))?.[1] ?? "";

/** Lazy-chunk modules: only reachable through import() from the facade. */
const LAZY = ["engine", "sfx", "music", "synth", "events", "pattern"];
const staticImport = (mod: string): RegExp => new RegExp(`^\\s*import\\s+(?!type\\b)[^;]*?from\\s*["'][./]*(audio/)?${mod}["']`, "m");

describe("audio module boundaries", () => {
  it("finds the audio sources", () => {
    for (const name of ["index.ts", "events.ts", "pattern.ts", "settings.ts", "engine.ts", "sfx.ts", "music.ts", "synth.ts"]) {
      expect(audio(name), name).not.toBe("");
    }
  });

  it("pure modules use no Web Audio, DOM or timers", () => {
    for (const name of ["events.ts", "pattern.ts", "settings.ts", "keys.ts"]) {
      expect(audio(name), name).not.toBe("");
      expect(audio(name), name).not.toMatch(/AudioContext|\bdocument\b|\bwindow\b|localStorage|setTimeout|setInterval|Math\.random/);
    }
  });

  it("the sim never imports audio", () => {
    const offenders = entries.filter(([p, src]) => p.includes("/src/sim/") && /from\s*["'][^"']*audio/.test(src)).map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it("lazy modules are imported statically only inside the lazy chunk", () => {
    const lazyFiles = LAZY.map((m) => `/src/audio/${m}.ts`);
    const offenders: string[] = [];
    for (const [p, src] of entries) {
      if (lazyFiles.some((f) => p.endsWith(f))) continue;
      for (const m of LAZY) if (staticImport(m).test(src)) offenders.push(`${p} → ${m}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the facade loads the engine via import() and never uses AudioWorklet, blobs or fetch", () => {
    expect(audio("index.ts")).toMatch(/import\(\s*["']\.\/engine["']\s*\)/);
    for (const [p, src] of entries.filter(([q]) => q.includes("/src/audio/"))) {
      expect(src, p).not.toMatch(/AudioWorklet|audioWorklet|createObjectURL|new Blob|fetch\(|decodeAudioData/);
    }
  });

  it("no setInterval in the audio code (music runs from the frame loop)", () => {
    for (const [p, src] of entries.filter(([q]) => q.includes("/src/audio/"))) expect(src, p).not.toMatch(/setInterval/);
  });
});
