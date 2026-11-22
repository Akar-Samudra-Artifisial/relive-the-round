/**
 * Renderer selection. `pickRenderer` is pure (query string + capabilities in, choice out);
 * `detectCaps` is the only part that touches the browser and stays last in this file.
 * Since phase 8, 3D is the default when WebGL2 is available; `?2d=1` or `?3d=0` force 2D.
 */

export type RendererKind = "2d" | "3d";
export type RendererCaps = { webgl2: boolean };

export function pickRenderer(search: string, caps: RendererCaps): { kind: RendererKind; reason: string } {
  const q = new URLSearchParams(search);
  const want3d = q.get("3d");
  if (q.get("2d") === "1" || want3d === "0") return { kind: "2d", reason: "forced" };
  if (!caps.webgl2) return { kind: "2d", reason: "no webgl2" };
  return { kind: "3d", reason: want3d === "" || want3d === "1" ? "requested" : "default" };
}

export function detectCaps(): RendererCaps {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    // Release the probe context right away: browsers cap live WebGL contexts (~16).
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return { webgl2: !!gl };
  } catch {
    return { webgl2: false };
  }
}
