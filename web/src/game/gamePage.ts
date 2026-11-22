import { createGameAudio } from "../audio";
import { soundCounts } from "../audio/debugCounts";
import { isMuteKey } from "../audio/keys";
import { mapFor } from "../maps";
import { createFpsWatchdog } from "../render/fpsWatchdog";
import { createPixi2dRenderer } from "../render/pixi2d";
import { initialTier, lowerTier, type QualityTier } from "../render/quality";
import type { FrameView, GameRenderer } from "../render/renderer";
import { detectCaps, pickRenderer } from "../render/select";
import type { SwitchableRenderer } from "../render/switchable";
import { DEFUSE_S, TICK_HZ } from "../sim/constants";
import type { Vec2 } from "../sim/geom";
import { ensureFonts, prefersReducedMotion } from "../ui/fonts";
import { clockAt, NO_INPUT, simTimeAt, type Input, type SimState } from "../sim/sim";
import { buildWorld, type World } from "../sim/world";
import { createAutopilot, type Autopilot } from "./autopilot";
import { drawQr, qrMatrix, renderCard, type QrMatrix } from "./cardImage";
import { challengeLines, landingAction, replayKeyAction } from "./challengeLanding";
import { createFrameLoop } from "./frameLoop";
import { liveFrame, TRACER_MS, type LiveTracer } from "./frameView";
import { blocksDefault, mapInput, type Screen } from "./input";
import { attractSlide, CornerTaps, isResetChord, kioskScoreDeadline, parseKiosk, RESET_CONFIRM_S } from "./kiosk";
import { addEntry, clearEntries, normalizeInitials, topEntries, validInitials } from "./leaderboard";
import { FEATURED, loadFeatured, type LoadedLevel } from "./levels";
import { buildYouTimeline, replayLayout, tickAtTime } from "./replayModel";
import { ReplayPlayer, type ReplaySpeed } from "./replayPlayer";
import { scoreRound, type ScoreCard } from "./score";
import { Session } from "./session";
import { controlsHint, defuseAvailable, goalText, nextTouchActive, type TouchModeEvent } from "./touch";
import { TouchControls } from "./touchControls";
import { challengeFromCard, challengeUrl, publicBaseUrl, type Challenge } from "./share";
import {
  COUNTDOWN_S,
  MAX_SESSION_S,
  REPLAY_MAX_S,
  roundLimitS,
  SCORE_RETURN_S,
  sessionBudgetS,
  shouldAbortPlay,
} from "./timing";

/** Matches the #gameStage / #replayBar spacing (--s-3) in theme.css. */
const STAGE_PAD = 12;
/** HUD turns the HP readout red at or below this value. */
const LOW_HP = 30;
const INITIALS_HINT = "Type 3 letters and press Enter to save · Enter with an empty box skips";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`game: missing #${id}`);
  return e as T;
}

/** Buttons and form fields handle Enter/Space/arrows natively; global shortcuts must not double up. */
function isControl(t: EventTarget | null): boolean {
  return t instanceof HTMLButtonElement || t instanceof HTMLInputElement;
}

/**
 * Paints a QR matrix filling the canvas's content box (its CSS padding is the outer quiet zone).
 * The backing store matches the displayed device pixels, so modules stay sharp without scaling.
 */
function paintQr(canvas: HTMLCanvasElement, m: QrMatrix): void {
  const css = getComputedStyle(canvas);
  const content = parseFloat(css.width) - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const side = Math.max(m.length, Math.round((content > 0 ? content : canvas.width) * (window.devicePixelRatio || 1)));
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (ctx) drawQr(ctx, m, 0, 0, side);
}

const REASON_TEXT: Record<ScoreCard["reason"], string> = {
  elimination: "Eliminated them all",
  defuse: "Spike defused",
  detonate: "Spike detonated",
  time: "Time ran out",
  death: "You went down",
};

/** Mutable keyboard/mouse snapshot, turned into an immutable Input once per frame by `mapInput`. */
class Controls {
  private keys = new Set<string>();
  /** Last pointer aim in world units (cm); kept while the pointer is outside every map panel. */
  private aimWorld: Vec2 = { x: 0, y: 0 };
  /** False until the pointer has moved/pressed on the canvas: (0,0) is not a real aim yet. */
  hasAimed = false;
  private firing = false;

  /**
   * `toWorld`: pointer client px → world point via the renderer (null outside the map panels).
   * While touch mode is on, finger taps on the canvas are ignored (the on-screen sticks aim and fire).
   */
  constructor(
    canvas: HTMLCanvasElement,
    screen: () => Screen,
    private readonly toWorld: (clientX: number, clientY: number) => Vec2 | null,
    private readonly touch: TouchControls,
    private readonly touchActive: () => boolean,
  ) {
    addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      // In the replay a focused control (speed button, slider) keeps its native Space/arrow behaviour.
      if (blocksDefault(e.code, screen()) && !(screen() === "replay" && isControl(e.target))) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => {
      this.keys.clear();
      this.firing = false;
      touch.release();
    });
    addEventListener("pointerup", () => (this.firing = false));
    this.bindCanvas(canvas);
  }

  /** Pointer aim/fire listeners on the game canvas; called again when the renderer swaps canvases. */
  bindCanvas(canvas: HTMLCanvasElement): void {
    const ignored = (e: PointerEvent): boolean => e.pointerType === "touch" && this.touchActive();
    const aimAt = (e: PointerEvent): void => {
      const w = this.toWorld(e.clientX, e.clientY);
      if (!w) return;
      this.aimWorld = w;
      this.hasAimed = true;
    };
    canvas.addEventListener("pointermove", (e) => {
      if (ignored(e)) return;
      aimAt(e);
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || ignored(e)) return;
      aimAt(e);
      this.firing = true;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** `player`: clutcher position (cm), the origin of the touch aim. */
  read(player: Vec2): Input {
    const touch = this.touch.overrides(player);
    if (touch?.aim) this.hasAimed = true;
    // The renderer already converted the pointer to world units, hence scale 1.
    return mapInput({ keys: this.keys, aimPx: this.aimWorld, pointerDown: this.firing, touch }, 1);
  }
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

/**
 * Lazily loads the three.js renderer; any import or WebGL init error warns once and falls back to
 * Pixi 2D. A working 3D renderer is wrapped so it can still swap to 2D at runtime.
 */
async function create3dOr2d(
  size: number,
  tier: QualityTier,
  onSwap: (next: GameRenderer) => void,
): Promise<{ renderer: GameRenderer; switchable: SwitchableRenderer | null }> {
  const make2d = (): Promise<GameRenderer> => createPixi2dRenderer({ width: size, height: size });
  try {
    // The runtime switch only matters for 3D, so it stays out of the entry chunk too.
    const [{ createThree3dRenderer }, { createSwitchableRenderer }] = await Promise.all([
      import("../render/three3d/three3d"),
      import("../render/switchable"),
    ]);
    const primary = await createThree3dRenderer({ width: size, height: size, tier });
    const switchable = createSwitchableRenderer(primary, make2d, onSwap);
    return { renderer: switchable, switchable };
  } catch (err) {
    console.warn("[renderer] 3D unavailable, falling back to 2D", err);
    return { renderer: await make2d(), switchable: null };
  }
}

export async function startGame(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const auto = params.has("auto");
  const showFps = auto || params.has("fps");
  const fixedSeed = params.get("seed");
  const kiosk = parseKiosk(location.search);
  const rendererPick = pickRenderer(location.search, detectCaps());

  const loaded: LoadedLevel[] = await Promise.all(FEATURED.map(loadFeatured));
  const worlds = new Map<LoadedLevel, World>(loaded.map((l) => [l, buildWorld(mapFor(l.level.map), l.level)]));
  for (const [l, w] of worlds) {
    const budget = sessionBudgetS(w);
    if (budget > MAX_SESSION_S) {
      throw new Error(`game: level ${l.level.id} needs up to ${budget.toFixed(0)} s per player, event limit is ${MAX_SESSION_S} s`);
    }
  }

  // Pixi Text (site letters, replay headers) must not rasterise with a fallback font.
  await ensureFonts();
  const stageEl = el<HTMLDivElement>("gameStage");
  // Leaves room for the HUD strip above the canvas; CSS scales the canvas down on narrow screens.
  const size = Math.max(480, Math.min(innerWidth - 24, innerHeight - 104));
  let tier = initialTier(location.search, { coarse: matchMedia("(pointer: coarse)").matches });
  // A swap can finish before `controls` exists; the canvas appended below is already the current one.
  let ready = false;
  const { renderer, switchable }: { renderer: GameRenderer; switchable: SwitchableRenderer | null } =
    rendererPick.kind === "3d"
      ? await create3dOr2d(size, tier, (next) => onRendererSwap(next))
      : { renderer: await createPixi2dRenderer({ width: size, height: size }), switchable: null };
  const watchdog = switchable ? createFpsWatchdog() : null;
  stageEl.appendChild(renderer.canvas);

  const attract = el<HTMLDivElement>("attract");
  const idleEl = el<HTMLDivElement>("idle");
  const scoreScreen = el<HTMLDivElement>("scoreScreen");
  const hud = el<HTMLDivElement>("hud");
  const fpsEl = el<HTMLDivElement>("fps");
  fpsEl.hidden = !showFps;
  const countdownEl = el<HTMLDivElement>("countdown");

  let screen: Screen = "attract";
  const touchControls = new TouchControls(el<HTMLDivElement>("touchControls"));
  // ?touch=1 pins touch mode on (desktop testing); otherwise coarse pointers start in touch mode.
  const touchForced = params.get("touch") === "1";
  let touchActive = touchForced || matchMedia("(pointer: coarse)").matches;
  const controls = new Controls(renderer.canvas, () => screen, (x, y) => renderer.screenToWorld(x, y), touchControls, () => touchActive);
  ready = true;
  let session: Session | null = null;
  let pilot: Autopilot | null = null;
  let playStartedMs = 0;
  let current: LoadedLevel | null = null;
  /** CSS px per world unit of the live map (label minimum sizes), restored after a replay. */
  let liveCssPxPerUnit = 1;
  let tracers: LiveTracer[] = [];
  /** Last live frame: drawn during play and kept on the canvas behind the score screen. */
  let lastLive: FrameView | null = null;
  let scoreDeadline = 0;
  /** Kiosk score timer: when the score screen (re)appeared, when initials were saved, last input. */
  let scoreShownMs = 0;
  let savedAtMs: number | null = null;
  let lastActivityMs = performance.now();
  /** Kiosk operator reset panel is open (pauses the attract loop). */
  let resetOpen = false;
  let card: ScoreCard | null = null;
  let saved = false;
  /** Session of the round shown on the score screen (seed + recording feed the replay). */
  let finished: Session | null = null;
  let replay: ReplayPlayer | null = null;
  let replayDeadline = 0;
  let replayEnded = false;
  /** Challenge from `#c=…` waiting on the attract screen. */
  let pending: { challenge: Challenge; level: LoadedLevel } | null = null;
  /** Challenge being played this round (compared on the score screen). */
  let roundChallenge: Challenge | null = null;
  let shareUrl = "";
  let shareQr: QrMatrix | null = null;

  const replayBar = el<HTMLDivElement>("replayBar");
  const gameEl = el<HTMLDivElement>("game");
  const replaySlider = el<HTMLInputElement>("replaySlider");
  const replayToggle = el<HTMLButtonElement>("replayToggle");
  const speedButtons = [...replayBar.querySelectorAll<HTMLButtonElement>("button[data-speed]")];
  const shareMsg = el<HTMLParagraphElement>("shareMsg");
  /** YOU-panel states of the open replay (index = tick) and its speed, for replay sounds. */
  let replayTimeline: readonly SimState[] = [];
  let replaySpeed: ReplaySpeed = 1;

  // Sound: synthesized at runtime, silent until the first user gesture unlocks it.
  const muteBtn = el<HTMLButtonElement>("muteToggle");
  const showMuted = (muted: boolean): void => {
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.title = muted ? "Sound off (M)" : "Sound on (M)";
  };
  const audio = createGameAudio({
    search: location.search,
    kiosk: kiosk.enabled,
    storage: (() => {
      try {
        return localStorage;
      } catch {
        return null;
      }
    })(),
    onChange: (s) => showMuted(s.muted),
  });
  showMuted(audio.settings.muted);
  muteBtn.addEventListener("click", (e) => {
    audio.toggleMute();
    // After a pointer click Space (the fire key) must not toggle the button again.
    if (e.detail > 0) muteBtn.blur();
  });
  // Bubble phase: clicks the kiosk swallows in the capture phase stay silent too.
  gameEl.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("button")) audio.click();
  });

  const show = (next: Screen): void => {
    audio.setScene(next);
    screen = next;
    gameEl.dataset.screen = next;
    attract.hidden = next !== "attract";
    idleEl.hidden = next !== "idle";
    scoreScreen.hidden = next !== "score";
    hud.hidden = next !== "play";
    countdownEl.hidden = next !== "play";
    replayBar.hidden = next !== "replay";
    renderer.canvas.style.visibility = next === "attract" || next === "idle" ? "hidden" : "visible";
    if (next !== "play") touchControls.reset();
    applyInputMode();
  };

  /** Overlay visibility and control hints follow the active input (touch vs. keyboard/mouse). */
  function applyInputMode(): void {
    gameEl.dataset.touch = touchActive ? "1" : "0";
    touchControls.setVisible(screen === "play" && touchActive);
    el<HTMLDivElement>("countdownHint").textContent = controlsHint(touchActive);
    if (current) el<HTMLSpanElement>("hudGoal").textContent = goalText(current.level.clutcherSide, touchActive);
  }
  const inputEvent = (ev: TouchModeEvent): void => {
    const next = nextTouchActive(touchActive, ev, touchForced);
    if (next === touchActive) return;
    touchActive = next;
    applyInputMode();
  };
  addEventListener("pointerdown", (e) => inputEvent(e.pointerType === "touch" ? "touch" : e.pointerType === "pen" ? "pen" : "mouse"), { capture: true });
  addEventListener("keydown", () => inputEvent("key"), { capture: true });
  // Audio unlock must run inside a user gesture; registered before the kiosk handlers that may
  // stop the event.
  for (const type of ["pointerdown", "pointerup", "keydown", "touchend"]) addEventListener(type, () => audio.unlock(), { capture: true });

  /** Top-5 rows for the level select and the kiosk attract loop (fresh nodes per call). */
  const boardRows = (): HTMLLIElement[] => {
    const rows = topEntries()
      .slice(0, 5)
      .map((e, i) => {
        const li = document.createElement("li");
        const rank = document.createElement("span");
        rank.className = "rank";
        rank.textContent = `${i + 1}.`;
        const who = document.createElement("b");
        who.className = "who";
        who.textContent = normalizeInitials(e.initials);
        const title = document.createElement("span");
        title.className = "lvl";
        title.textContent = loaded.find((l) => l.level.id === e.levelId)?.featured.title ?? "?";
        const pts = document.createElement("span");
        pts.className = "pts";
        pts.textContent = String(Math.round(e.points));
        li.append(rank, " ", who, " ", title, " ", pts);
        return li;
      });
    if (rows.length === 0) {
      const li = document.createElement("li");
      li.className = "dim";
      li.textContent = "No scores yet — be the first.";
      rows.push(li);
    }
    return rows;
  };
  const renderBoard = (): void => el<HTMLOListElement>("board").replaceChildren(...boardRows());

  let idleSlide = -1;
  const renderIdleSlide = (): void => {
    const i = attractSlide(performance.now(), loaded.length);
    if (i === idleSlide) return;
    idleSlide = i;
    const l = loaded[i];
    el<HTMLElement>("idleSlideTitle").textContent = l ? `${i + 1}. ${l.featured.title}` : "";
    el<HTMLElement>("idleSlideBlurb").textContent = l?.blurb ?? "";
  };

  /** Kiosk only: the attract loop over an untouched level select. */
  const toIdle = (): void => {
    // A focused button would otherwise activate on the dismissing key.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    el<HTMLOListElement>("idleBoard").replaceChildren(...boardRows());
    idleSlide = -1;
    renderIdleSlide();
    show("idle");
  };

  const renderChallenge = (): void => {
    el<HTMLElement>("challenge").hidden = pending === null;
    if (!pending) return;
    el<HTMLParagraphElement>("challengeLevel").textContent = `Round: ${pending.level.featured.title}`;
    el<HTMLUListElement>("challengeStats").replaceChildren(
      ...challengeLines(pending.challenge).map((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        return li;
      }),
    );
  };

  /** Reads `#c=…`; anything invalid is ignored and the normal attract screen shows. */
  const readHash = (): void => {
    const action = landingAction(
      location.hash,
      loaded.map((l) => l.level.id),
    );
    pending = action.kind === "challenge" ? { challenge: action.challenge, level: loaded[action.levelIndex]! } : null;
    renderChallenge();
  };

  const startLevel = (l: LoadedLevel, seed?: number): void => {
    const world = worlds.get(l)!;
    current = l;
    finished = null;
    const s = seed ?? (fixedSeed !== null ? Number(fixedSeed) >>> 0 : randomSeed());
    session = new Session(world, s, COUNTDOWN_S);
    pilot = auto ? createAutopilot(world) : null;
    playStartedMs = performance.now();
    tracers = [];
    lastLive = null;
    const scale = size / Math.max(world.map.width, world.map.height);
    // CSS px per world unit (the canvas shrinks on narrow screens), for minimum label sizes.
    const cssK = Math.min(1, (innerWidth - 2 * STAGE_PAD) / size);
    liveCssPxPerUnit = scale * cssK;
    showLiveMap(world);
    el<HTMLSpanElement>("hudLevel").textContent = `${l.featured.title}${l.synthetic ? " (synthetic)" : ""}`;
    touchControls.reset();
    touchControls.setDefuseVisible(false);
    show("play");
  };

  const beatChallenge = (): void => {
    if (!pending) return;
    const { challenge, level } = pending;
    pending = null;
    // One-shot: the next player on this kiosk gets the normal attract screen.
    history.replaceState(null, "", location.pathname + location.search);
    renderChallenge();
    roundChallenge = challenge;
    startLevel(level, challenge.seed);
  };

  /** One square panel filling the live canvas. */
  function showLiveMap(world: World): void {
    renderer.loadMap(world.map, { cssPxPerUnit: liveCssPxPerUnit });
    renderer.setPanels([{ x: 0, y: 0, size }]);
  }

  /** Tears the replay down and restores the live canvas; safe to call when none is open. */
  const closeReplay = (): void => {
    if (replay) {
      replay.pause();
      renderer.resize(size, size);
      if (current) showLiveMap(worlds.get(current)!);
    }
    replay = null;
    replayEnded = false;
    replayTimeline = [];
  };

  const toAttract = (): void => {
    closeReplay();
    session = null;
    pilot = null;
    current = null;
    card = null;
    finished = null;
    roundChallenge = null;
    // The idle countdown starts fresh each time the level select appears.
    if (kiosk.enabled) lastActivityMs = performance.now();
    renderBoard();
    renderChallenge();
    show("attract");
    if (pending && !auto) el<HTMLButtonElement>("beatThis").focus();
  };

  const toScore = (s: SimState, l: LoadedLevel, sess: Session): void => {
    card = scoreRound(l.level, s);
    finished = sess;
    saved = false;
    scoreDeadline = performance.now() + SCORE_RETURN_S * 1000;
    scoreShownMs = performance.now();
    savedAtMs = null;
    scoreScreen.dataset.result = card.won ? "won" : "lost";
    el<HTMLHeadingElement>("resultTitle").textContent = card.won ? "Clutched!" : "Not this time";
    el<HTMLParagraphElement>("resultReason").textContent = REASON_TEXT[card.reason];
    const rows: [string, string, string][] = [
      ["Result", card.won ? "Won" : "Lost", card.proWon ? "Won" : "Lost"],
      ["Time", `${card.timeS.toFixed(1)} s`, `${card.proTimeS.toFixed(1)} s`],
      ["Kills", `${card.kills} / ${card.enemies}`, "—"],
      ["HP left", String(card.hpLeft), "—"],
      ["Accuracy", `${Math.round(card.accuracy * 100)}%`, "—"],
    ];
    el<HTMLTableSectionElement>("resultRows").replaceChildren(
      ...rows.map(([label, you, pro]) => {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.scope = "row";
        th.textContent = label;
        const a = document.createElement("td");
        a.textContent = you;
        const b = document.createElement("td");
        b.textContent = pro;
        tr.append(th, a, b);
        return tr;
      }),
    );
    el<HTMLParagraphElement>("resultPro").textContent = `Pro #1: ${card.proWon ? "won" : "lost"} in ${card.proTimeS.toFixed(1)} s`;
    el<HTMLSpanElement>("resultPoints").textContent = String(card.points);
    const vs = el<HTMLParagraphElement>("resultChallenge");
    vs.hidden = roundChallenge === null;
    if (roundChallenge) {
      vs.textContent =
        card.points > roundChallenge.points
          ? `You beat the challenge (${roundChallenge.points} points)!`
          : `Challenge: ${roundChallenge.points} points — not beaten this time.`;
    }
    shareUrl = challengeUrl(publicBaseUrl(), challengeFromCard(l.level.id, sess.seed, card));
    shareQr = qrMatrix(shareUrl);
    paintQr(el<HTMLCanvasElement>("resultQr"), shareQr);
    shareMsg.textContent = "";
    el<HTMLButtonElement>("downloadCard").disabled = false;
    const initials = el<HTMLInputElement>("initials");
    initials.value = "";
    el<HTMLButtonElement>("saveScore").disabled = false;
    el<HTMLParagraphElement>("initialsMsg").textContent = INITIALS_HINT;
    show("score");
    if (!auto) initials.focus();
  };

  /** Back from the replay: the score screen gets a fresh auto-return timer. */
  const backToScore = (): void => {
    closeReplay();
    scoreDeadline = performance.now() + SCORE_RETURN_S * 1000;
    scoreShownMs = performance.now();
    show("score");
    if (!auto) el<HTMLButtonElement>("watchReplay").focus();
  };

  const setReplayPlaying = (playing: boolean): void => {
    if (!replay) return;
    if (playing) replay.play();
    else replay.pause();
    replayToggle.textContent = playing ? "Pause" : "Play";
  };

  const setReplaySpeed = (speed: ReplaySpeed): void => {
    replay?.setSpeed(speed);
    replaySpeed = speed;
    for (const b of speedButtons) b.setAttribute("aria-pressed", String(b.dataset.speed === String(speed)));
  };

  const toReplay = (): void => {
    if (!finished || !card || screen !== "score") return;
    closeReplay();
    const timeline = buildYouTimeline(finished.world, finished.seed, finished.recording);
    replayTimeline = timeline;
    // Two square panels as large as the viewport allows (minus the replay bar), side by side or
    // stacked on portrait phones; CSS centres canvas + bar vertically. Measured before the first paint.
    replayBar.hidden = false;
    const barH = replayBar.offsetHeight;
    const fit = replayLayout(innerWidth - 2 * STAGE_PAD, innerHeight - barH - 4 * STAGE_PAD);
    renderer.resize(fit.width, fit.height);
    const view = new ReplayPlayer({
      world: finished.world,
      timeline,
      onTime: (t, startT, endT) => {
        replaySlider.value = String(t);
        const label = `${(t - startT).toFixed(1)} / ${(endT - startT).toFixed(1)} s`;
        el<HTMLSpanElement>("replayTime").textContent = label;
        replaySlider.setAttribute("aria-valuetext", label);
      },
      // Leaving inside the player update would close the replay mid-update; the main loop does it.
      onEnd: () => (replayEnded = true),
    });
    replay = view;
    // The replay canvas is sized to the viewport, so logical px == CSS px (no cssPxPerUnit).
    renderer.loadMap(finished.world.map, {});
    renderer.setPanels(view.panels(fit.width, fit.height, fit.layout));
    replaySlider.min = String(view.startT);
    replaySlider.max = String(view.endT);
    replaySlider.value = String(view.startT);
    setReplaySpeed(1);
    setReplayPlaying(true);
    replayEnded = false;
    replayDeadline = performance.now() + REPLAY_MAX_S * 1000;
    show("replay");
    if (!auto) replayToggle.focus();
  };

  const downloadCard = async (): Promise<void> => {
    if (kiosk.enabled || !card || !current || !shareQr) return;
    const btn = el<HTMLButtonElement>("downloadCard");
    const result = { levelTitle: current.featured.title, card, url: shareUrl };
    btn.disabled = true;
    shareMsg.textContent = "Creating card…";
    try {
      const blob = await renderCard(result, shareQr);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `relive-the-round-${result.card.points}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      shareMsg.textContent = "Card downloaded.";
    } catch {
      shareMsg.textContent = "Could not create the card on this device.";
    } finally {
      btn.disabled = false;
    }
  };

  // Attract screen buttons.
  el<HTMLDivElement>("levelButtons").replaceChildren(
    ...loaded.map((l, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.level = String(i);
      btn.dataset.map = l.featured.map;
      const thumb = document.createElement("span");
      thumb.className = "lvl-thumb";
      const map = document.createElement("span");
      map.className = "lvl-map";
      map.textContent = l.featured.map;
      thumb.append(map);
      const key = document.createElement("span");
      key.className = "lvl-key";
      key.textContent = String(i + 1);
      const title = document.createElement("b");
      title.className = "lvl-title";
      title.textContent = l.featured.title;
      const blurb = document.createElement("span");
      blurb.className = "lvl-blurb";
      blurb.textContent = l.blurb;
      btn.append(thumb, key, title, blurb);
      return btn;
    }),
  );
  el<HTMLDivElement>("levelButtons").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-level]");
    if (btn) startLevel(loaded[Number(btn.dataset.level)]!);
  });
  const startRandom = (): void => startLevel(loaded[Math.floor(Math.random() * loaded.length)]!);
  el<HTMLButtonElement>("randomLevel").addEventListener("click", startRandom);

  const initialsMsg = el<HTMLParagraphElement>("initialsMsg");
  /** Returns true when the player may leave the score screen (saved, or storage unavailable). */
  const saveScore = (): boolean => {
    if (!card || !current) return true;
    if (saved) return true;
    const initials = normalizeInitials(el<HTMLInputElement>("initials").value);
    if (!validInitials(initials)) {
      initialsMsg.textContent = "Need exactly 3 letters (A–Z) — or clear the box and press Enter to skip.";
      return false;
    }
    saved = true;
    savedAtMs = performance.now();
    el<HTMLButtonElement>("saveScore").disabled = true;
    initialsMsg.textContent = addEntry({ initials, points: card.points, levelId: current.level.id })
      ? `Saved as ${initials}.`
      : "Could not save on this device (storage unavailable).";
    return true;
  };
  el<HTMLButtonElement>("saveScore").addEventListener("click", () => void saveScore());
  el<HTMLButtonElement>("nextPlayer").addEventListener("click", toAttract);
  el<HTMLInputElement>("initials").addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    input.value = normalizeInitials(input.value);
  });

  el<HTMLButtonElement>("beatThis").addEventListener("click", beatChallenge);
  el<HTMLButtonElement>("watchReplay").addEventListener("click", toReplay);
  el<HTMLButtonElement>("downloadCard").addEventListener("click", () => void downloadCard());
  replayToggle.addEventListener("click", () => setReplayPlaying(!(replay?.isPlaying ?? false)));
  for (const b of speedButtons) b.addEventListener("click", () => setReplaySpeed(Number(b.dataset.speed) as ReplaySpeed));
  replaySlider.addEventListener("input", () => {
    replay?.setTime(Number(replaySlider.value));
    audio.scrub(performance.now());
  });
  el<HTMLButtonElement>("replayExit").addEventListener("click", backToScore);
  addEventListener("hashchange", () => {
    // A booth machine never opens challenge links.
    if (kiosk.enabled) return;
    readHash();
    if (screen === "attract") toAttract();
  });

  if (kiosk.enabled) {
    // Visitors scan the QR on their phone; nothing gets downloaded onto the booth machine.
    el<HTMLButtonElement>("downloadCard").hidden = true;
    const touch = (): void => {
      lastActivityMs = performance.now();
    };
    let lastMove: { x: number; y: number } | null = null;
    addEventListener("keydown", touch, { capture: true });
    addEventListener("pointerdown", touch, { capture: true });
    addEventListener("wheel", touch, { capture: true, passive: true });
    addEventListener(
      "pointermove",
      (e) => {
        // A jittery mouse must not keep the booth awake forever.
        if (lastMove && Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y) < 4) return;
        lastMove = { x: e.clientX, y: e.clientY };
        touch();
      },
      { capture: true, passive: true },
    );

    // Hidden operator reset (level select / attract loop only): Ctrl+Shift+Alt+R or 5 quick taps
    // in the top-left corner open an in-page confirm (kiosk browsers often block window.confirm).
    const resetPanel = el<HTMLDivElement>("kioskReset");
    const resetMsg = el<HTMLParagraphElement>("kioskResetMsg");
    const resetClear = el<HTMLButtonElement>("kioskResetClear");
    const corner = new CornerTaps();
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    const closeReset = (): void => {
      clearTimeout(resetTimer);
      resetPanel.hidden = true;
      resetOpen = false;
      lastActivityMs = performance.now();
    };
    const openReset = (): void => {
      if (screen === "idle") toAttract();
      resetOpen = true;
      resetMsg.textContent = "";
      resetClear.disabled = false;
      resetPanel.hidden = false;
      resetClear.focus();
      clearTimeout(resetTimer);
      resetTimer = setTimeout(closeReset, RESET_CONFIRM_S * 1000);
    };
    resetClear.addEventListener("click", () => {
      const ok = clearEntries();
      renderBoard();
      resetClear.disabled = true;
      resetMsg.textContent = ok ? "Scores cleared." : "Could not clear scores (storage unavailable).";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(closeReset, 2000);
    });
    el<HTMLButtonElement>("kioskResetCancel").addEventListener("click", closeReset);
    const onMenu = (): boolean => screen === "attract" || screen === "idle";

    // The first input on the attract loop only dismisses it: nothing passes through, so it can
    // never start a level (also not via a held key or the click that follows the pointerdown).
    let swallowKey: string | null = null;
    let swallowClick = false;
    const dismissIdle = (e: Event): boolean => {
      if (screen !== "idle") return false;
      e.preventDefault();
      e.stopImmediatePropagation();
      toAttract();
      return true;
    };
    addEventListener(
      "keydown",
      (e) => {
        if (resetOpen) {
          // Buttons keep their native Enter/Space; level shortcuts must not fire behind the panel.
          e.stopImmediatePropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            closeReset();
          }
          return;
        }
        if (onMenu() && isResetChord(e)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          openReset();
          return;
        }
        if (swallowKey !== null && e.repeat && e.code === swallowKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        if (dismissIdle(e)) swallowKey = e.code;
      },
      { capture: true },
    );
    addEventListener("keyup", (e) => {
      if (e.code === swallowKey) swallowKey = null;
    });
    addEventListener(
      "pointerdown",
      (e) => {
        if (resetOpen) {
          // Only the panel is live; nothing behind it may start a round.
          if (!(e.target instanceof Node && resetPanel.contains(e.target))) {
            e.preventDefault();
            e.stopImmediatePropagation();
            swallowClick = true;
          }
          return;
        }
        if (onMenu() && corner.tap(e.clientX, e.clientY, performance.now())) {
          e.preventDefault();
          e.stopImmediatePropagation();
          swallowClick = true;
          openReset();
          return;
        }
        if (dismissIdle(e)) swallowClick = true;
      },
      { capture: true },
    );
    addEventListener(
      "click",
      (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      { capture: true },
    );
    addEventListener("pointerup", () => setTimeout(() => (swallowClick = false), 0));
  }

  addEventListener("keydown", (e) => {
    // A held Enter/Space must not chain screens (e.g. save → attract → random level).
    // A focused button activates itself on Enter; the global shortcut must not fire as well.
    const onButton = e.target instanceof HTMLButtonElement;
    if (isMuteKey(e, e.target instanceof HTMLElement ? e.target : null)) {
      audio.toggleMute();
      return;
    }
    if (e.repeat && (e.key === "Enter" || e.code === "Space")) {
      // Auto-repeat would click the freshly focused button (Watch replay / Beat this) over and over.
      if (onButton) e.preventDefault();
      return;
    }
    if (screen === "attract") {
      const n = Number(e.key);
      if (n >= 1 && n <= loaded.length) startLevel(loaded[n - 1]!);
      else if (e.key === "Enter" && !onButton) {
        if (pending) beatChallenge();
        else startRandom();
      }
    } else if (screen === "score" && e.key === "Enter" && !onButton) {
      // Empty box = explicit skip; anything else must be valid initials.
      if (el<HTMLInputElement>("initials").value === "" || saveScore()) toAttract();
    } else if (screen === "play" && e.key === "Escape") {
      toAttract();
    } else if (screen === "replay" && replay) {
      const action = replayKeyAction(e.key);
      if (!action) return;
      // Focused controls keep their native Space/arrow handling (no double toggle/seek).
      if (isControl(e.target) && (e.key === " " || e.key.startsWith("Arrow"))) return;
      if (action.kind === "toggle") setReplayPlaying(!replay.isPlaying);
      else if (action.kind === "speed") setReplaySpeed(action.speed);
      else if (action.kind === "seek") replay.setTime(replay.time + action.deltaS);
      else backToScore();
    }
  });

  let fpsAcc = 0;
  let fpsFrames = 0;

  /**
   * Screen logic for one frame (`nowMs` = the frame clock). Returns the live state to show in the
   * HUD when the play branch ran.
   */
  const step = (deltaMS: number, nowMs: number): { world: World; s: SimState } | null => {
    if (screen === "replay") {
      // The score timer is paused here; the replay has its own hard cap back to the (unsaved) score
      // screen, which then restarts its own auto-return timer.
      if (nowMs > replayDeadline) backToScore();
      else if (replayEnded) backToScore();
      return null;
    }
    if (kiosk.enabled && screen === "attract" && !resetOpen && nowMs - lastActivityMs > kiosk.attractIdleS * 1000) {
      toIdle();
      return null;
    }
    if (screen === "idle") {
      renderIdleSlide();
      return null;
    }
    if (screen === "score") {
      const deadline = kiosk.enabled ? kioskScoreDeadline({ shownAtMs: scoreShownMs, savedAtMs, lastActivityMs }) : scoreDeadline;
      const left = Math.max(0, Math.ceil((deadline - nowMs) / 1000));
      el<HTMLSpanElement>("returnIn").textContent = String(left);
      if (left === 0) toAttract();
      return null;
    }
    if (screen !== "play" || !session || !current) return null;

    const world = session.world;
    if (shouldAbortPlay(nowMs - playStartedMs, session.state.outcome !== null, roundLimitS(world))) {
      toAttract();
      return null;
    }
    const before = session.state.tick;
    // Autopilot is consulted once per sim tick (frame-rate independent); humans per frame.
    const human = pilot ? null : controls.read(session.state.clutcher);
    session.advance(deltaMS, pilot ?? human!);
    const input = human ?? session.recording[session.recording.length - 1] ?? NO_INPUT;
    const cd = session.countdown;
    countdownEl.hidden = cd === 0;
    el<HTMLDivElement>("countdownNum").textContent = String(cd);
    const s = session.state;
    if (s.tick !== before) for (const shot of s.shots) tracers.push({ shot, untilMs: nowMs + TRACER_MS });
    audio.onPlay({ session, countdown: cd, state: s, clock: clockAt(world, simTimeAt(world, s.tick)), nowMs });
    tracers = tracers.filter((tr) => tr.untilMs > nowMs);

    // Fog of war, defuse arcs and tracer fade are decided in liveFrame; the renderer only draws.
    // Autopilot input always carries a real aim; a human's only after the pointer touched the canvas.
    lastLive = liveFrame(world, s, pilot || controls.hasAimed ? input.aim : null, tracers, nowMs, { reducedMotion: prefersReducedMotion() });
    touchControls.setDefuseVisible(touchControls.visible && defuseAvailable(world, s));
    if (s.outcome) toScore(s, current, session);
    return { world, s };
  };

  /** The 3D renderer was replaced by 2D: the round, session, replay and panels carry on untouched. */
  function onRendererSwap(next: GameRenderer): void {
    if (!ready) return;
    controls.bindCanvas(next.canvas);
    if ((screen === "play" || screen === "score") && lastLive) renderer.draw([lastLive]);
  }

  /** Watchdog verdict: one quality tier down, or 2D once the lowest tier is still too slow. */
  const degradeQuality = (): void => {
    if (switchable?.swapping) return;
    const next = lowerTier(tier);
    if (!next) {
      void switchable?.swapToFallback("low fps");
      return;
    }
    console.info(`[3d] quality ${tier} -> ${next}`);
    tier = next;
    renderer.setQuality?.(next);
  };

  /**
   * Feeds the watchdog only while 3D is actually drawing in a visible, focused window: an unfocused
   * window throttles rAF (~5 fps) without hiding the page. Resuming after a skip restarts the warm-up.
   */
  let watchdogPaused = true;
  const feedWatchdog = (nowMs: number, drawing: boolean): void => {
    if (!watchdog || !switchable || renderer.kind !== "3d") return;
    if (!drawing || switchable.swapping || document.hidden || !document.hasFocus()) {
      watchdogPaused = true;
      return;
    }
    if (watchdogPaused) {
      watchdogPaused = false;
      watchdog.reset(nowMs);
      return;
    }
    if (watchdog.sample(nowMs) === "degrade") degradeQuality();
  };

  /**
   * YOU-panel shots and kills while the replay plays normally at 1x/2x. Slider and key seeks
   * happen outside `update`, so a frame's own advance is never a scrub jump.
   */
  const replaySounds = (fromT: number, toT: number): void => {
    if (replaySpeed > 2 || !finished || replayTimeline.length === 0) return;
    const a = tickAtTime(finished.world, fromT, replayTimeline.length);
    const b = tickAtTime(finished.world, toT, replayTimeline.length);
    if (b > a && b - a <= 4) audio.onReplay(replayTimeline[a]!.stats, replayTimeline[b]!.stats);
  };

  // The only animation loop on the page: game logic, replay playback, one render, then the HUD.
  const loop = createFrameLoop((deltaMS, nowMs) => {
    fpsAcc += deltaMS;
    fpsFrames++;
    if (fpsAcc >= 1000) {
      fpsEl.textContent = `${Math.round((fpsFrames * 1000) / fpsAcc)} fps`;
      fpsAcc = 0;
      fpsFrames = 0;
    }
    const played = step(deltaMS, nowMs);
    const replayFrom = screen === "replay" && replay ? replay.time : null;
    replay?.update(deltaMS);
    if (replay && replayFrom !== null) replaySounds(replayFrom, replay.time);
    audio.frame();
    // The canvas is hidden on the attract and idle screens; the score screen keeps the last live frame.
    const frames = screen === "replay" && replay ? replay.frames() : (screen === "play" || screen === "score") && lastLive ? [lastLive] : null;
    feedWatchdog(nowMs, frames !== null);
    if (frames) renderer.draw(frames);
    if (played) updateHud(played.world, played.s);
  });

  if (import.meta.env.DEV) {
    // Dev-only probe for browser automation (stripped from production builds).
    Object.defineProperty(window, "__rtr", {
      configurable: true,
      value: {
        screen: () => screen,
        state: () => session?.state ?? null,
        countdown: () => session?.countdown ?? null,
        recording: () => session?.recording.length ?? 0,
        replay: () => (replay ? { t: replay.time, startT: replay.startT, endT: replay.endT, playing: replay.isPlaying } : null),
        shareUrl: () => shareUrl,
        challenge: () => pending?.challenge ?? null,
        kiosk: () => ({ ...kiosk, lastActivityMs, savedAtMs, idleSlide: screen === "idle" ? idleSlide : null }),
        loseContext: (): boolean => {
          if (renderer.kind !== "3d") return false;
          const ext = renderer.canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context");
          ext?.loseContext();
          return ext != null;
        },
        quality: () => ({ tier, kind: renderer.kind }),
        sounds: (): Record<string, number> => ({ ...soundCounts }),
      },
    });
  }

  if (!kiosk.enabled) readHash();
  if (auto || params.has("level")) {
    const idx = Math.min(loaded.length - 1, Math.max(0, Number(params.get("level") ?? 0) || 0));
    startLevel(loaded[idx]!);
  } else {
    toAttract();
  }
  loop.start();
}

function updateHud(world: World, s: SimState): void {
  const clock = clockAt(world, simTimeAt(world, s.tick));
  const hp = el<HTMLSpanElement>("hudHp");
  hp.textContent = String(s.clutcher.hp);
  hp.dataset.low = String(s.clutcher.hp <= LOW_HP);
  el<HTMLSpanElement>("hudEnemies").textContent = `${s.enemies.filter((e) => e.alive).length} / ${s.enemies.length}`;
  el<HTMLSpanElement>("hudClock").textContent = `${Math.max(0, clock.secondsLeft).toFixed(1)} s`;
  const enemyDefuse = Math.max(0, ...s.enemies.filter((e) => e.alive).map((e) => e.defuseTicks));
  const pct = (ticks: number): number => Math.round((ticks / (DEFUSE_S * TICK_HZ)) * 100);
  const spike = el<HTMLSpanElement>("hudSpike");
  const state = !clock.spikeActive ? "idle" : s.clutcher.defuseTicks > 0 ? "defusing" : enemyDefuse > 0 ? "enemy" : "planted";
  spike.dataset.state = state;
  spike.textContent =
    state === "defusing"
      ? `defusing ${pct(s.clutcher.defuseTicks)}%`
      : state === "enemy"
        ? `ENEMY DEFUSING ${pct(enemyDefuse)}%`
        : state === "planted"
          ? "planted"
          : "not planted";
}
