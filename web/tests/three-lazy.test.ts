import { describe, expect, it } from "vitest";

// three.js must stay out of the main entry chunk: only a dynamic import() behind `?3d` may pull it in.
const sources = import.meta.glob("../src/main.ts", { query: "?raw", import: "default", eager: true });
const main = String(Object.values(sources)[0] ?? "");

describe("three.js lazy loading", () => {
  it("reads the main entry source", () => {
    expect(main).toContain("startGame");
  });

  it("main entry does not statically import three", () => {
    expect(main).not.toMatch(/^\s*import\s[^(]*?from\s*["']three/m);
    expect(main).not.toMatch(/^\s*import\s*["']three/m);
  });

  it("main entry does not statically import the 3D renderer modules", () => {
    expect(main).not.toMatch(/^\s*import\s[^(]*?from\s*["']\.\/render\/three3d\//m);
    expect(main).not.toMatch(/^\s*import\s*["']\.\/render\/three3d\//m);
  });

  it("main entry loads the probe via dynamic import()", () => {
    expect(main).toMatch(/import\(\s*["']\.\/render\/three3d\/probe["']\s*\)/);
  });
});

const allSources = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

describe("three.js stays inside render/three3d", () => {
  const importsThree = /(^\s*import\s[^;]*?from\s*["']three["'])|(^\s*import\s*["']three["'])|(import\(\s*["']three["']\s*\))/m;

  it("scans the sources", () => {
    expect(Object.keys(allSources).length).toBeGreaterThan(20);
    expect(Object.keys(allSources).some((p) => p.includes("/render/three3d/mapScene.ts"))).toBe(true);
  });

  it("only files under src/render/three3d/ import three", () => {
    const offenders = Object.entries(allSources)
      .filter(([path, src]) => !path.includes("/src/render/three3d/") && importsThree.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("the renderer switch, quality tiers and fps watchdog import neither pixi nor three", () => {
    for (const name of ["switchable.ts", "quality.ts", "fpsWatchdog.ts"]) {
      const src = Object.entries(allSources).find(([p]) => p.endsWith(`/src/render/${name}`))?.[1];
      expect(src, name).toBeDefined();
      expect(src, name).not.toMatch(/["']pixi\.js/);
      expect(src, name).not.toMatch(importsThree);
      expect(src, name).not.toMatch(/["']\.\.?\/(render\/)?(pixi2d|three3d\/)/);
    }
  });

  it("gamePage reaches the 3D renderer only via import()", () => {
    const page = Object.entries(allSources).find(([p]) => p.endsWith("/src/game/gamePage.ts"))?.[1] ?? "";
    expect(page).toContain("startGame");
    expect(page).not.toMatch(/^\s*import\s[^(]*?from\s*["']\.\.\/render\/three3d\//m);
    expect(page).not.toMatch(/^\s*import\s*["']\.\.\/render\/three3d\//m);
    expect(page).toMatch(/import\(\s*["']\.\.\/render\/three3d\/three3d["']\s*\)/);
  });
});
