import qrcode from "qrcode-generator";
import { DISPLAY_FONT, ensureFonts, MONO_FONT } from "../ui/fonts";
import { THEME } from "../ui/theme";
import type { ScoreCard } from "./score";

/** QR modules, row-major; true = dark. */
export type QrMatrix = readonly (readonly boolean[])[];

export type CardResult = {
  readonly levelTitle: string;
  readonly card: ScoreCard;
  /** Shown under the QR code. */
  readonly url: string;
};

const W = 1200;
const H = 630;
const PAD = 60;

/** Logo mark paths (64×64 viewBox), identical to the #rtr-mark symbol in index.html. */
const MARK = {
  frame: "M14 4H50L60 14V50L50 60H14L4 50V14Z",
  ring: "M23 21.3A14 14 0 1 0 41 21.3",
  arrow: "M37.9 18.7L43.3 18.6L38.8 24Z",
  ticks: "M32 11V22M32 42V53M11 32H22M42 32H53",
};

/** QR code (auto version, error correction M) for `text`. */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(): { ctx: Ctx2D; toBlob: () => Promise<Blob> } {
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("card: 2D context unavailable on OffscreenCanvas");
    return { ctx, toBlob: () => c.convertToBlob({ type: "image/png" }) };
  }
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("card: 2D context unavailable on canvas");
  return {
    ctx,
    toBlob: () =>
      new Promise((resolve, reject) =>
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("card: canvas.toBlob returned null"))), "image/png"),
      ),
  };
}

/** Pure black-on-white QR with a 4-module quiet zone; returns the drawn side length (px). */
function drawQr(ctx: Ctx2D, m: QrMatrix, x: number, y: number, size: number): number {
  const quiet = 4;
  const n = m.length + quiet * 2;
  const cell = Math.floor(size / n);
  const px = cell * n;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, px, px);
  ctx.fillStyle = "#000000";
  m.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, cell, cell);
    }),
  );
  return px;
}

/** Bevelled panel (cut top-right / bottom-left corners), the HUD panel shape from theme.css. */
function bevel(ctx: Ctx2D, x: number, y: number, w: number, h: number, b: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - b, y);
  ctx.lineTo(x + w, y + b);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + b, y + h);
  ctx.lineTo(x, y + h - b);
  ctx.closePath();
}

function setSpacing(ctx: Ctx2D, px: number): void {
  if ("letterSpacing" in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${px}px`;
}

function drawMark(ctx: Ctx2D, x: number, y: number, size: number): void {
  if (typeof Path2D === "undefined") return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 64, size / 64);
  ctx.lineJoin = "miter";
  ctx.fillStyle = THEME.surface;
  ctx.fill(new Path2D(MARK.frame));
  ctx.lineWidth = 3;
  ctx.strokeStyle = THEME.lineHi;
  ctx.stroke(new Path2D(MARK.frame));
  ctx.lineWidth = 4;
  ctx.lineCap = "butt";
  ctx.strokeStyle = THEME.cyan;
  ctx.stroke(new Path2D(MARK.ring));
  ctx.fillStyle = THEME.cyan;
  ctx.fill(new Path2D(MARK.arrow));
  ctx.lineWidth = 3;
  ctx.strokeStyle = THEME.text;
  ctx.stroke(new Path2D(MARK.ticks));
  ctx.fillStyle = THEME.amber;
  ctx.beginPath();
  ctx.arc(32, 32, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 1200×630 PNG score card (social-preview size) with a QR to the challenge link. */
export async function renderCard(result: CardResult, qr: QrMatrix | string): Promise<Blob> {
  await ensureFonts();
  const matrix = typeof qr === "string" ? qrMatrix(qr) : qr;
  const { card } = result;
  const { ctx, toBlob } = makeCanvas();
  const resultColor = card.won ? THEME.green : THEME.red;

  // Ground, faint tactical grid, top accent rule.
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = THEME.bgRaised;
  for (let x = 0; x <= W; x += 40) ctx.fillRect(x, 0, 1, H);
  for (let y = 0; y <= H; y += 40) ctx.fillRect(0, y, W, 1);
  ctx.fillStyle = THEME.cyan;
  ctx.fillRect(0, 0, W, 6);
  ctx.fillStyle = resultColor;
  ctx.fillRect(0, 6, 220, 3);

  // Wordmark.
  ctx.textBaseline = "alphabetic";
  drawMark(ctx, PAD, 40, 56);
  ctx.fillStyle = THEME.text;
  ctx.font = `700 26px ${DISPLAY_FONT}`;
  setSpacing(ctx, 4);
  ctx.fillText("RELIVE", PAD + 72, 64);
  ctx.fillStyle = THEME.cyan;
  ctx.fillText("THE ROUND", PAD + 72, 92);

  // Result.
  ctx.font = `700 15px ${MONO_FONT}`;
  setSpacing(ctx, 3);
  ctx.fillStyle = resultColor;
  ctx.fillText(card.won ? "● ROUND WON" : "● ROUND LOST", PAD, 150);
  setSpacing(ctx, 0);
  ctx.fillStyle = THEME.text;
  ctx.font = `700 68px ${DISPLAY_FONT}`;
  ctx.fillText(card.won ? "Clutched!" : "Not this time", PAD, 216, 600);
  ctx.fillStyle = THEME.textDim;
  ctx.font = `600 26px ${DISPLAY_FONT}`;
  ctx.fillText(result.levelTitle, PAD, 256, 600);

  // Points.
  ctx.fillStyle = THEME.cyan;
  ctx.font = `700 104px ${MONO_FONT}`;
  ctx.fillText(String(card.points), PAD - 4, 364);
  const ptsW = ctx.measureText(String(card.points)).width;
  ctx.fillStyle = THEME.textDim;
  ctx.font = `700 16px ${MONO_FONT}`;
  setSpacing(ctx, 3);
  ctx.fillText("POINTS", PAD + ptsW + 12, 362);

  // Stats panel.
  const tx = PAD;
  const ty = 396;
  const tw = 600;
  const th = 186;
  bevel(ctx, tx, ty, tw, th, 16);
  ctx.fillStyle = THEME.surface;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = THEME.line;
  ctx.stroke();
  const cols = [tx + 22, tx + 230, tx + 430];
  ctx.font = `700 13px ${MONO_FONT}`;
  ctx.fillStyle = THEME.textMute;
  ctx.fillText("STAT", cols[0]!, ty + 30);
  ctx.fillStyle = THEME.cyan;
  ctx.fillText("YOU", cols[1]!, ty + 30);
  ctx.fillStyle = THEME.amber;
  ctx.fillText("PRO", cols[2]!, ty + 30);
  ctx.fillStyle = THEME.line;
  ctx.fillRect(tx + 22, ty + 42, tw - 44, 1);
  const rows: [string, string, string][] = [
    ["RESULT", card.won ? "Won" : "Lost", card.proWon ? "Won" : "Lost"],
    ["TIME", `${card.timeS.toFixed(1)} s`, `${card.proTimeS.toFixed(1)} s`],
    ["KILLS", `${card.kills} / ${card.enemies}`, "—"],
    ["HP · ACC", `${card.hpLeft} · ${Math.round(card.accuracy * 100)}%`, "—"],
  ];
  rows.forEach(([label, you, pro], i) => {
    const y = ty + 74 + i * 32;
    setSpacing(ctx, 2);
    ctx.font = `700 13px ${MONO_FONT}`;
    ctx.fillStyle = THEME.textDim;
    ctx.fillText(label, cols[0]!, y);
    setSpacing(ctx, 0);
    ctx.font = `400 22px ${MONO_FONT}`;
    ctx.fillStyle = THEME.text;
    ctx.fillText(you, cols[1]!, y);
    ctx.fillText(pro, cols[2]!, y);
  });

  // QR panel: white QR on a dark bevelled plate, caption below.
  const qrSize = 360;
  const px = W - PAD - qrSize - 40;
  const py = 70;
  bevel(ctx, px, py, qrSize + 40, 500, 20);
  ctx.fillStyle = THEME.surface;
  ctx.fill();
  ctx.strokeStyle = THEME.lineHi;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = THEME.cyan;
  ctx.fillRect(px, py, 40, 3);
  const side = drawQr(ctx, matrix, px + 20, py + 24, qrSize);
  const capY = py + 24 + side + 44;
  ctx.fillStyle = THEME.text;
  ctx.font = `700 26px ${DISPLAY_FONT}`;
  setSpacing(ctx, 2);
  ctx.fillText("BEAT THIS SCORE", px + 20, capY, qrSize);
  setSpacing(ctx, 0);
  ctx.fillStyle = THEME.textDim;
  ctx.font = `400 15px ${MONO_FONT}`;
  ctx.fillText(result.url.replace(/^https?:\/\//, "").split("#")[0] ?? "", px + 20, capY + 30, qrSize);
  return toBlob();
}
