// Draw the 1200x630 social preview (Open Graph / Twitter card) into public/og-image.png.
// Dependency-free and deterministic: original art only (logo mark from favicon.svg, an abstract
// made-up floor plan, a built-in 5x7 pixel font), in the Tactical HUD palette of src/ui/theme.ts.
// Re-run with `pnpm og-image` after changing it; the PNG output is committed.
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

// Palette = THEME in src/ui/theme.ts (Tactical HUD).
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex("#06090d");
const GRID = hex("#0d141b");
const GRID_MAJOR = hex("#16222d");
const FLOOR = hex("#070b10");
const WALL = hex("#111b25");
const SURFACE = hex("#0f1720");
const LINE_HI = hex("#35505f");
const CYAN = hex("#3ee6ff");
const AMBER = hex("#ffb84d");
const RED = hex("#ff5a62");
const TEXT = hex("#e4eef3");
const DIM = hex("#93a7b3");

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

/** Convex/concave polygon fill (even-odd), points in output pixels. */
function poly(pts, c, a) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const inside = (x, y) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  fill(inside, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), c, a);
}

const outline = (pts, t, c, a) => pts.forEach((p, i) => segment(...p, ...pts[(i + 1) % pts.length], t, c, a));

/** Solid wall block: soft cyan halo, dark fill, thin cyan edge (as in mapView.ts). */
const block = (x, y, w, h) => {
  rect(x - 5, y - 5, w + 10, h + 10, CYAN, 0.06);
  rect(x, y, w, h, CYAN, 0.55);
  rect(x + 2, y + 2, w - 4, h - 4, WALL);
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

// Background and a faint tactical grid; cyan rule along the top.
rect(0, 0, W, H, BG);
for (let x = 0; x <= W; x += 40) rect(x, 0, 1, H, x % 200 === 0 ? GRID_MAJOR : GRID);
for (let y = 0; y <= H; y += 40) rect(0, y, W, 1, y % 200 === 0 ? GRID_MAJOR : GRID);
rect(0, 0, W, 6, CYAN);
rect(0, 6, 220, 3, AMBER);

// Abstract original floor plan on the right (not based on any real map), in a bevelled HUD frame.
const MX = 720;
const MY = 60;
const MW = 440;
const MH = 510;
const frame = [[MX, MY], [MX + MW - 24, MY], [MX + MW, MY + 24], [MX + MW, MY + MH], [MX + 24, MY + MH], [MX, MY + MH - 24]];
poly(frame, FLOOR);
for (let x = MX + 40; x < MX + MW; x += 40) rect(x, MY, 1, MH, GRID_MAJOR, 0.6);
for (let y = MY + 40; y < MY + MH; y += 40) rect(MX, y, MW, 1, GRID_MAJOR, 0.6);
outline(frame, 1.5, LINE_HI);
rect(MX, MY, 48, 3, CYAN);

// Site zone (amber tint, dashed edge, corner brackets) with its letter.
const SX = MX + 250;
const SY = MY + 330;
rect(SX, SY, 160, 140, AMBER, 0.08);
dashed([[SX, SY], [SX + 160, SY], [SX + 160, SY + 140], [SX, SY + 140], [SX, SY]], 2, 8, 6, AMBER, 0.55);
for (const [x, y, dx, dy] of [[SX, SY, 1, 1], [SX + 160, SY, -1, 1], [SX + 160, SY + 140, -1, -1], [SX, SY + 140, 1, -1]]) {
  segment(x, y, x + dx * 30, y, 4, AMBER);
  segment(x, y, x, y + dy * 30, 4, AMBER);
}
text("A", SX + 18, SY + 18, 5, AMBER);

// Walls.
block(MX + 30, MY + 40, 180, 26);
block(MX + 30, MY + 40, 26, 200);
block(MX + 270, MY + 40, 26, 170);
block(MX + 296, MY + 184, 120, 26);
block(MX + 120, MY + 150, 90, 70);
block(MX + 30, MY + 300, 150, 26);
block(MX + 154, MY + 326, 26, 150);
block(MX + 330, MY + 260, 50, 40);
block(MX + 60, MY + 420, 50, 50);

// Enemy view cones / rails (red) and the clutcher's path (cyan) ending at the spike.
dashed([[MX + 400, 90], [MX + 360, 240], [MX + 380, 330]], 3, 10, 8, RED, 0.7);
dashed([[MX + 90, 120], [MX + 230, 130]], 3, 10, 8, RED, 0.7);
dashed([[MX + 90, 500], [MX + 220, 470]], 3, 10, 8, RED, 0.7);
const PX = MX + 240;
const PY = MY + 260;
segment(MX + 80, MY + 260, PX, PY, 5, CYAN, 0.85);
segment(PX, PY, SX + 80, SY + 70, 5, CYAN, 0.85);
for (const [x, y] of [[MX + 380, 330], [MX + 230, MY + 70], [MX + 220, MY + 410]]) {
  disc(x, y, 20, RED, 0.15);
  disc(x, y, 11, RED);
}
poly([[SX + 80, SY + 56], [SX + 94, SY + 70], [SX + 80, SY + 84], [SX + 66, SY + 70]], RED); // spike
ring(SX + 80, SY + 70, 30, 3, RED, 0.7);
disc(MX + 80, MY + 260, 26, CYAN, 0.12);
disc(MX + 80, MY + 260, 13, CYAN);
ring(MX + 80, MY + 260, 13, 3, TEXT);

// Logo mark (same geometry as favicon.svg / #rtr-mark, viewBox 64 scaled to 112 px).
const LX = 60;
const LY = 52;
const LS = 112 / 64;
const L = (x, y) => [LX + x * LS, LY + y * LS];
const oct = [L(14, 4), L(50, 4), L(60, 14), L(60, 50), L(50, 60), L(14, 60), L(4, 50), L(4, 14)];
poly(oct, SURFACE);
outline(oct, 3 * LS, LINE_HI);
{
  const [cx, cy] = L(32, 32);
  const r = 14 * LS;
  const t = 4 * LS;
  // Ring with a gap at the top (between -130° and -50°), as the SVG arc.
  fill((x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    if (Math.abs(d - r) > t / 2) return false;
    const ang = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
    return !(ang > -130 && ang < -50);
  }, cx - r - t, cy - r - t, cx + r + t, cy + r + t, CYAN);
  poly([L(37.9, 18.7), L(43.3, 18.6), L(38.8, 24)], CYAN);
  for (const [a, b] of [[[32, 11], [32, 22]], [[32, 42], [32, 53]], [[11, 32], [22, 32]], [[42, 32], [53, 32]]]) {
    segment(...L(...a), ...L(...b), 3 * LS, TEXT);
  }
  disc(cx, cy, 3.5 * LS, AMBER);
}

// Copy.
text("RELIVE", 60, 210, 12, TEXT);
text("THE ROUND", 60, 310, 12, CYAN);
text("COULD YOU HAVE CLUTCHED IT?", 62, 428, 4, TEXT);
text("REAL 1VN PRO CLUTCHES - BEAT THE PRO", 62, 480, 3, DIM);
rect(62, 530, 120, 4, AMBER);
text("RELIVE-THE-ROUND.VERCEL.APP", 62, 556, 3, DIM);

// Subtle scanlines over everything.
for (let y = 0; y < H; y += 3) rect(0, y, W, 1, [0, 0, 0], 0.07);

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
