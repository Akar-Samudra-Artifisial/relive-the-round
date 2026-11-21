import { startDebugPage } from "./debug/debugPage";
import { startGame } from "./game/gamePage";

const debug = new URLSearchParams(location.search).has("debug");
const section = document.getElementById(debug ? "debug" : "game");
if (section) section.hidden = false;
document.title = debug ? "Relive the Round — debug" : "Relive the Round";

(debug ? startDebugPage() : startGame()).catch((err: unknown) => {
  const el = document.getElementById("error");
  if (el) el.textContent = err instanceof Error ? err.message : String(err);
  throw err;
});
