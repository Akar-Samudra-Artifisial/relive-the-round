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
