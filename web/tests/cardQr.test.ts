import { describe, expect, it } from "vitest";
import { drawQr, QR_QUIET, qrLayout, type QrMatrix } from "../src/game/cardImage";

describe("QR layout", () => {
  it("keeps a quiet zone of at least QR_QUIET modules, counting outside white", () => {
    for (const n of [21, 25, 29, 33, 37]) {
      for (const [size, outer] of [
        [360, 0],
        [104, 4],
        [208, 8],
        [312, 12],
      ] as const) {
        const { start, end, module } = qrLayout(n, size, outer);
        expect(end - start).toBeGreaterThanOrEqual(n);
        expect(start + outer).toBeGreaterThanOrEqual(QR_QUIET * module - 1e-9);
        expect(size - end + outer).toBeGreaterThanOrEqual(QR_QUIET * module - 1e-9);
        // As large as allowed: at most one device pixel per side short of the ideal module.
        const ideal = (size + 2 * outer) / (n + 2 * QR_QUIET);
        expect(module).toBeGreaterThan(ideal - 2 / n);
      }
    }
  });

  it("uses white padding outside the box so the symbol grows", () => {
    expect(qrLayout(29, 104, 4).module).toBeGreaterThan(qrLayout(29, 104, 0).module);
  });

  it("paints seamless whole-pixel modules inside the symbol edges", () => {
    const n = 29;
    const m: QrMatrix = Array.from({ length: n }, () => Array.from({ length: n }, () => true));
    const rects: number[][] = [];
    const ctx = { fillStyle: "", fillRect: (x: number, y: number, w: number, h: number) => void rects.push([x, y, w, h]) };
    drawQr(ctx, m, 0, 0, 360);
    const { start, end } = qrLayout(n, 360);
    const modules = rects.slice(1);
    expect(modules).toHaveLength(n * n);
    for (const [x, y, w, h] of modules) {
      expect(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(w) && Number.isInteger(h)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(start);
      expect(x! + w!).toBeLessThanOrEqual(end);
    }
    // Row 0: each module starts where the previous one ends (no seams).
    const row = modules.slice(0, n);
    for (let i = 1; i < n; i++) expect(row[i]![0]).toBe(row[i - 1]![0]! + row[i - 1]![2]!);
  });
});
