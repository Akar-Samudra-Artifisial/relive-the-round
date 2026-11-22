// Pixi's shader/uniform sync uses `new Function` by default; this module swaps in eval-free
// implementations so the CSP can keep `script-src 'self'` without 'unsafe-eval'.
import "pixi.js/unsafe-eval";
import "./ui/theme.css";
import { startGame } from "./game/gamePage";

// The debug page is dev-only: the dynamic import sits behind import.meta.env.DEV so production
// builds drop it (and its calibration overlays) from the bundle entirely.
const debug = import.meta.env.DEV && new URLSearchParams(location.search).has("debug");
const section = document.getElementById(debug ? "debug" : "game");
if (section) section.hidden = false;
document.title = debug ? "Relive the Round — debug" : "Relive the Round";

async function start(): Promise<void> {
  if (import.meta.env.DEV && debug) {
    const { startDebugPage } = await import("./debug/debugPage");
    return startDebugPage();
  }
  return startGame();
}

// Experimental 3D renderer, phase 0: `?3d` lazily loads a three.js probe chunk. Fire-and-forget,
// so it never blocks or breaks the game; without the param the chunk is never requested.
if (new URLSearchParams(location.search).has("3d")) {
  import("./render/three3d/probe")
    .then(({ probeThree }) => probeThree())
    .then((result) => console.info("[3d probe]", result))
    .catch((err: unknown) => console.warn("[3d probe] failed", err));
}

start().catch((err: unknown) => {
  const el = document.getElementById("error");
  if (el) el.textContent = err instanceof Error ? err.message : String(err);
  throw err;
});
