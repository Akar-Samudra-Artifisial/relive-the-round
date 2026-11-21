// Draw the 1200x630 social preview (Open Graph / Twitter card) into public/og-image.png.
// Dependency-free and deterministic: original art only (crosshair logo from favicon.svg, an abstract
// made-up floor plan, a built-in 5x7 pixel font). Re-run with `pnpm og-image` after changing it.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const W = 1200;
const H = 630;
const SS = 3; // supersampling factor for anti-aliased edges
const BW = W * SS;
const BH = H * SS;
const buf = new Float32Array(BW * BH * 3);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex("#14110f");
const GRID = hex("#1d1916");
const ROOM = hex("#1f1a17");
const WALL = hex("#4a3f35");
const GOLD = hex("#ffd479");
const RED = hex("#ff7a6b");
const TEXT = hex("#e8e1d6");
const DIM = hex("#a89c8c");

function plot(x, y, c, a = 1) {
  if (x < 0 || y < 0 || x >= BW || y >= BH) return;
  const i = (y * BW + x) * 3;
  for (let k = 0; k < 3; k++) buf[i + k] += (c[k] - buf[i + k]) * a;
}

// All shape coordinates are in output pixels; they are scaled to the supersampled buffer here.
function fill(test, x0, y0, x1, y1, c, a = 1) {
  const sx0 = Math.max(0, Math.floor(x0 * SS));
  const sy0 = Math.max(0, Math.floor(y0 * SS));
  const sx1 = Math.min(BW, Math.ceil(x1 * SS));
  const sy1 = Math.min(BH, Math.ceil(y1 * SS));
  for (let y = sy0; y < sy1; y++) {
    for (let x = sx0; x < sx1; x++) {
      if (test((x + 0.5) / SS, (y + 0.5) / SS)) plot(x, y, c, a);
    }
  }
}

const rect = (x, y, w, h, c, a) => fill(() => true, x, y, x + w, y + h, c, a);
const disc = (cx, cy, r, c, a) =>
  fill((x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r, cx - r, cy - r, cx + r, cy + r, c, a);
const ring = (cx, cy, r, t, c, a) =>
  fill(
    (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= t / 2,
    cx - r - t, cy - r - t, cx + r + t, cy + r + t, c, a,
  );

function segment(ax, ay, bx, by, t, c, a) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const r = t / 2;
  fill(
    (x, y) => {
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      return Math.hypot(x - (ax + u * dx), y - (ay + u * dy)) <= r;
    },
    Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r, c, a,
  );
}

function dashed(points, t, dash, gap, c, a) {
  for (let p = 0; p + 1 < points.length; p++) {
    const [ax, ay] = points[p];
    const [bx, by] = points[p + 1];
    const len = Math.hypot(bx - ax, by - ay);
    for (let s = 0; s < len; s += dash + gap) {
      const e = Math.min(len, s + dash);
      segment(ax + ((bx - ax) * s) / len, ay + ((by - ay) * s) / len,
        ax + ((bx - ax) * e) / len, ay + ((by - ay) * e) / len, t, c, a);
    }
  }
}

const room = (x, y, w, h) => {
  rect(x, y, w, h, WALL);
  rect(x + 4, y + 4, w - 8, h - 8, ROOM);
};

// 5x7 pixel font, one string of 7 rows (5 bits each) per glyph.
const FONT = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110", D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110", J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 10001 11001 10101 10011 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  0: "01110 10001 10011 10101 11001 10001 01110", 1: "00100 01100 00100 00100 00100 00100 01110",
  2: "01110 10001 00001 00010 00100 01000 11111", 3: "11110 00001 00001 01110 00001 00001 11110",
  "?": "01110 10001 00001 00010 00100 00000 00100", "-": "00000 00000 00000 01110 00000 00000 00000",
  ".": "00000 00000 00000 00000 00000 01100 01100", "/": "00001 00010 00010 00100 01000 01000 10000",
  " ": "00000 00000 00000 00000 00000 00000 00000",
};

/** Draw text with `s` output pixels per font pixel; returns the advance width. */
function text(str, x, y, s, c) {
  let cx = x;
  for (const ch of str) {
    const g = FONT[ch];
    if (!g) throw new Error(`make-og-image: no glyph for '${ch}'`);
    g.split(" ").forEach((row, ry) => {
      for (let rx = 0; rx < 5; rx++) if (row[rx] === "1") rect(cx + rx * s, y + ry * s, s, s, c);
    });
    cx += 6 * s;
  }
  return cx - x - s;
}

// Background and a faint tactical grid.
rect(0, 0, W, H, BG);
for (let x = 0; x <= W; x += 40) rect(x, 0, 1, H, GRID);
for (let y = 0; y <= H; y += 40) rect(0, y, W, 1, GRID);

// Abstract original floor plan on the right (not based on any real map).
const MX = 730;
room(MX, 70, 200, 150);
room(MX + 240, 70, 200, 230);
room(MX, 260, 140, 300);
room(MX + 180, 340, 260, 220);
rect(MX + 196, 130, 48, 40, ROOM); // doorways
rect(MX + 60, 216, 50, 48, ROOM);
rect(MX + 136, 420, 48, 50, ROOM);
rect(MX + 330, 296, 60, 48, ROOM);
rect(MX + 250, 420, 40, 40, WALL); // crate
rect(MX + 60, 320, 36, 36, WALL);

// Enemy rails (dashed red) and the clutcher's path (gold).
dashed([[MX + 400, 110], [MX + 360, 250], [MX + 360, 320], [MX + 400, 420]], 4, 12, 9, RED, 0.75);
dashed([[MX + 40, 110], [MX + 160, 150], [MX + 290, 130]], 4, 12, 9, RED, 0.75);
dashed([[MX + 60, 520], [MX + 90, 440], [MX + 230, 445]], 4, 12, 9, RED, 0.75);
segment(MX + 80, 300, MX + 160, 445, 6, GOLD, 0.9);
segment(MX + 160, 445, MX + 330, 500, 6, GOLD, 0.9);
for (const [x, y] of [[MX + 400, 420], [MX + 290, 130], [MX + 230, 445]]) {
  disc(x, y, 14, RED);
  disc(x, y, 6, BG);
}
disc(MX + 330, 500, 16, GOLD);
ring(MX + 330, 500, 28, 4, GOLD, 0.6);

// Crosshair logo (same motif as favicon.svg).
const LX = 96;
const LY = 104;
ring(LX, LY, 30, 8, GOLD);
for (const [ax, ay, bx, by] of [[0, -50, 0, -22], [0, 22, 0, 50], [-50, 0, -22, 0], [22, 0, 50, 0]]) {
  segment(LX + ax, LY + ay, LX + bx, LY + by, 8, GOLD);
}
disc(LX, LY, 8, RED);

// Copy.
text("RELIVE", 60, 190, 12, GOLD);
text("THE ROUND", 60, 290, 12, GOLD);
text("COULD YOU HAVE CLUTCHED IT?", 62, 412, 4, TEXT);
text("REAL 1VN PRO CLUTCHES - BEAT THE PRO", 62, 470, 3, DIM);
rect(62, 530, 120, 4, RED);
text("RELIVE-THE-ROUND.VERCEL.APP", 62, 556, 3, DIM);

// Downsample and encode as an 8-bit RGB PNG.
const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const row = y * (1 + W * 3);
  raw[row] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    for (let k = 0; k < 3; k++) {
      let sum = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) sum += buf[((y * SS + dy) * BW + x * SS + dx) * 3 + k];
      }
      raw[row + 1 + x * 3 + k] = Math.round(sum / (SS * SS));
    }
  }
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  let c = 0xffffffff;
  for (const b of td) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  td.copy(out, 4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolor RGB, deflate, no filter, no interlace
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "og-image.png");
writeFileSync(out, png);
console.log(`make-og-image: wrote public/og-image.png (${W}x${H}, ${png.length} bytes)`);
