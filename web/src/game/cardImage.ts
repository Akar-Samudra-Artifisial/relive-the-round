import qrcode from "qrcode-generator";
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
const BG = "#1c1714";
const FG = "#f4e4c1";
const DIM = "#a8977d";
const ACCENT = "#5ad1ff";

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

function drawQr(ctx: Ctx2D, m: QrMatrix, x: number, y: number, size: number): void {
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
}

/** 1200×630 PNG score card (social-preview size) with a QR to the challenge link. */
export async function renderCard(result: CardResult, qr: QrMatrix | string): Promise<Blob> {
  const matrix = typeof qr === "string" ? qrMatrix(qr) : qr;
  const { card } = result;
  const { ctx, toBlob } = makeCanvas();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 10);

  ctx.textBaseline = "top";
  ctx.fillStyle = DIM;
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.fillText("RELIVE THE ROUND", 60, 50);
  ctx.fillStyle = FG;
  ctx.font = "bold 64px system-ui, sans-serif";
  ctx.fillText(card.won ? "Clutched!" : "Not this time", 60, 92);
  ctx.fillStyle = DIM;
  ctx.font = "30px system-ui, sans-serif";
  ctx.fillText(result.levelTitle, 60, 172);

  ctx.fillStyle = ACCENT;
  ctx.font = "bold 96px system-ui, sans-serif";
  ctx.fillText(String(card.points), 60, 230);
  ctx.fillStyle = DIM;
  ctx.font = "28px system-ui, sans-serif";
  ctx.fillText("points", 60, 334);

  const rows: [string, string, string][] = [
    ["", "You", "Pro"],
    ["Result", card.won ? "Won" : "Lost", card.proWon ? "Won" : "Lost"],
    ["Time", `${card.timeS.toFixed(1)} s`, `${card.proTimeS.toFixed(1)} s`],
    ["Kills", `${card.kills} / ${card.enemies}`, ""],
    ["HP · Acc", `${card.hpLeft} · ${Math.round(card.accuracy * 100)}%`, ""],
  ];
  ctx.font = "28px system-ui, sans-serif";
  rows.forEach(([label, you, pro], i) => {
    const y = 400 + i * 40;
    ctx.fillStyle = DIM;
    ctx.fillText(label, 60, y);
    ctx.fillStyle = FG;
    ctx.fillText(you, 260, y);
    ctx.fillText(pro, 480, y);
  });

  const qrSize = 400;
  const qrX = W - qrSize - 80;
  drawQr(ctx, matrix, qrX, 70, qrSize);
  ctx.fillStyle = FG;
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.fillText("Beat this score", qrX, 490);
  ctx.fillStyle = DIM;
  ctx.font = "18px system-ui, sans-serif";
  ctx.fillText(result.url.replace(/^https?:\/\//, "").split("#")[0] ?? "", qrX, 530, qrSize);
  return toBlob();
}
