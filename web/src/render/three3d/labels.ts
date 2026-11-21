import * as THREE from "three";
import type { LabelStyle, MakeLabel } from "./mapScene";

/** Canvas font size (px) labels are rasterised at; the plane is then scaled to world units. */
const RASTER_PX = 128;
const PAD_PX = 8;

/**
 * Browser label factory: draws bold text on a 2D canvas (fonts are already loaded by
 * `ensureFonts`), wraps it in an sRGB CanvasTexture and returns a transparent plane in the XY
 * plane (text up = +Y), centred on its origin and sized so the font is `style.sizeWorld` tall.
 */
export const makeCanvasLabel: MakeLabel = (text: string, style: LabelStyle) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const pxPerWorld = RASTER_PX / style.sizeWorld;
  const spacing = (style.letterSpacing ?? 0) * pxPerWorld;
  const font = `700 ${RASTER_PX}px ${style.font}`;
  ctx.font = font;
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const textW = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  canvas.width = Math.ceil(textW + PAD_PX * 2);
  canvas.height = Math.ceil(RASTER_PX * 1.3 + PAD_PX * 2);
  // Resizing the canvas resets the context state.
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = `#${style.color.toString(16).padStart(6, "0")}`;
  let x = PAD_PX;
  chars.forEach((c, i) => {
    ctx.fillText(c, x, canvas.height / 2);
    x += widths[i]! + spacing;
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // Like the 2D map, labels draw over walls (DEF SPAWN sits on a wall on Kiln), hence no depth test.
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: style.alpha,
    depthWrite: false,
    depthTest: false,
  });
  const geo = new THREE.PlaneGeometry(canvas.width / pxPerWorld, canvas.height / pxPerWorld);
  return new THREE.Mesh(geo, mat);
};
