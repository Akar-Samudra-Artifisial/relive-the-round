import { REVISION, WebGLRenderer } from "three";

/**
 * Phase 0 of the optional 3D renderer: proves that three ships as a lazy chunk and runs under the
 * CSP. Only loaded via a dynamic import when the URL has `?3d`; never throws.
 */
export interface ThreeProbeResult {
  revision: string;
  webgl2: boolean;
}

export async function probeThree(): Promise<ThreeProbeResult> {
  let webgl2 = false;
  try {
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(1, 1)
        : document.createElement("canvas");
    const renderer = new WebGLRenderer({
      canvas: canvas as unknown as HTMLCanvasElement,
      antialias: false,
    });
    webgl2 =
      typeof WebGL2RenderingContext !== "undefined" &&
      renderer.getContext() instanceof WebGL2RenderingContext;
    renderer.forceContextLoss();
    renderer.dispose();
  } catch {
    webgl2 = false;
  }
  return { revision: REVISION, webgl2 };
}
