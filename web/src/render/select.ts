/**
 * Renderer selection. `pickRenderer` is pure (query string + capabilities in, choice out);
 * `detectCaps` is the only part that touches the browser and stays last in this file.
 * The default stays 2D until the 3D renderer is complete.
 */

export type RendererKind = "2d" | "3d";
export type RendererCaps = { webgl2: boolean };

export function pickRenderer(search: string, caps: RendererCaps): { kind: RendererKind; reason: string } {
  const q = new URLSearchParams(search);
  if (q.get("2d") === "1") return { kind: "2d", reason: "forced" };
  const want3d = q.get("3d");
  if (want3d === "" || want3d === "1") {
    return caps.webgl2 ? { kind: "3d", reason: "requested" } : { kind: "2d", reason: "no webgl2" };
  }
  return { kind: "2d", reason: "default" };
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
