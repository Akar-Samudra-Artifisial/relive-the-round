import { Application, Container, Graphics } from "pixi.js";
import { mapFor } from "../maps";
import { drawMap } from "../render/mapView";
import { DEFUSE_RADIUS, DEFUSE_S, TICK_HZ } from "../sim/constants";
import { segmentClear, type Vec2 } from "../sim/geom";
import { clockAt, NO_INPUT, simTimeAt, type Input, type ShotEvent, type SimState } from "../sim/sim";
import { buildWorld, type World } from "../sim/world";
import { createAutopilot, type Autopilot } from "./autopilot";
import { qrMatrix, renderCard, type QrMatrix } from "./cardImage";
import { challengeLines, landingAction, replayKeyAction } from "./challengeLanding";
import { blocksDefault, mapInput, type Screen } from "./input";
import { addEntry, normalizeInitials, topEntries, validInitials } from "./leaderboard";
import { FEATURED, loadFeatured, type LoadedLevel } from "./levels";
import { buildYouTimeline } from "./replayModel";
import { ReplayView, type ReplaySpeed } from "./replayView";
import { scoreRound, type ScoreCard } from "./score";
import { Session } from "./session";
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

const ENEMY_COLOR = 0xff6b5a;
const PLAYER_COLOR = 0x5ad1ff;
const TRACER_MS = 120;
const INITIALS_HINT = "Type 3 letters and press Enter to save · Enter with an empty box skips";

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`game: missing #${id}`);
  return e as T;
}

type Tracer = { shot: ShotEvent; untilMs: number };

/** Buttons and form fields handle Enter/Space/arrows natively; global shortcuts must not double up. */
function isControl(t: EventTarget | null): boolean {
  return t instanceof HTMLButtonElement || t instanceof HTMLInputElement;
}

/** Paints a QR matrix (with a 4-module quiet zone) onto a small canvas, whole pixels per module. */
function paintQr(canvas: HTMLCanvasElement, m: QrMatrix): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const n = m.length + 8;
  const cell = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / n));
  const off = Math.floor((canvas.width - cell * n) / 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  m.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) ctx.fillRect(off + (c + 4) * cell, off + (r + 4) * cell, cell, cell);
    }),
  );
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
  private aimPx: Vec2 = { x: 0, y: 0 };
  private firing = false;

  constructor(canvas: HTMLCanvasElement, screen: () => Screen) {
    addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      // In the replay a focused control (speed button, slider) keeps its native Space/arrow behaviour.
      if (blocksDefault(e.code, screen()) && !(screen() === "replay" && isControl(e.target))) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => {
      this.keys.clear();
      this.firing = false;
    });
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.aimPx = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = canvas.getBoundingClientRect();
      this.aimPx = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.firing = true;
    });
    addEventListener("pointerup", () => (this.firing = false));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  read(scale: number): Input {
    return mapInput({ keys: this.keys, aimPx: this.aimPx, pointerDown: this.firing }, scale);
  }
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

export async function startGame(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const auto = params.has("auto");
  const showFps = auto || params.has("fps");
  const fixedSeed = params.get("seed");

  const loaded: LoadedLevel[] = await Promise.all(FEATURED.map(loadFeatured));
  const worlds = new Map<LoadedLevel, World>(loaded.map((l) => [l, buildWorld(mapFor(l.level.map), l.level)]));
  for (const [l, w] of worlds) {
    const budget = sessionBudgetS(w);
    if (budget > MAX_SESSION_S) {
      throw new Error(`game: level ${l.level.id} needs up to ${budget.toFixed(0)} s per player, event limit is ${MAX_SESSION_S} s`);
    }
  }

  const stageEl = el<HTMLDivElement>("gameStage");
  const size = Math.max(480, Math.min(innerWidth - 24, innerHeight - 64));
  const app = new Application();
  await app.init({ width: size, height: size, background: 0x14110f, antialias: true });
  stageEl.appendChild(app.canvas);

  const root = new Container();
  app.stage.addChild(root);
  const dyn = new Graphics();

  const attract = el<HTMLDivElement>("attract");
  const scoreScreen = el<HTMLDivElement>("scoreScreen");
  const hud = el<HTMLDivElement>("hud");
  const fpsEl = el<HTMLDivElement>("fps");
  fpsEl.hidden = !showFps;
  const countdownEl = el<HTMLDivElement>("countdown");

  let screen: Screen = "attract";
  const controls = new Controls(app.canvas, () => screen);
  let session: Session | null = null;
  let pilot: Autopilot | null = null;
  let playStartedMs = 0;
  let current: LoadedLevel | null = null;
  let scale = 1;
  let tracers: Tracer[] = [];
  let scoreDeadline = 0;
  let card: ScoreCard | null = null;
  let saved = false;
  /** Session of the round shown on the score screen (seed + recording feed the replay). */
  let finished: Session | null = null;
  let replay: ReplayView | null = null;
  let replayDeadline = 0;
  let replayEnded = false;
  /** Challenge from `#c=…` waiting on the attract screen. */
  let pending: { challenge: Challenge; level: LoadedLevel } | null = null;
  /** Challenge being played this round (compared on the score screen). */
  let roundChallenge: Challenge | null = null;
  let shareUrl = "";
  let shareQr: QrMatrix | null = null;

  const replayBar = el<HTMLDivElement>("replayBar");
  const replaySlider = el<HTMLInputElement>("replaySlider");
  const replayToggle = el<HTMLButtonElement>("replayToggle");
  const speedButtons = [...replayBar.querySelectorAll<HTMLButtonElement>("button[data-speed]")];
  const shareMsg = el<HTMLParagraphElement>("shareMsg");

  const show = (next: Screen): void => {
    screen = next;
    attract.hidden = next !== "attract";
    scoreScreen.hidden = next !== "score";
    hud.hidden = next !== "play";
    countdownEl.hidden = next !== "play";
    replayBar.hidden = next !== "replay";
    root.visible = next !== "replay";
    app.canvas.style.visibility = next === "attract" ? "hidden" : "visible";
  };

  const renderBoard = (): void => {
    const rows = topEntries()
      .slice(0, 5)
      .map((e, i) => {
        const li = document.createElement("li");
        const who = document.createElement("b");
        who.textContent = normalizeInitials(e.initials);
        const title = document.createElement("span");
        title.className = "dim";
        title.textContent = loaded.find((l) => l.level.id === e.levelId)?.featured.title ?? "?";
        li.append(`${i + 1}. `, who, ` ${Math.round(e.points)} `, title);
        return li;
      });
    if (rows.length === 0) {
      const li = document.createElement("li");
      li.className = "dim";
      li.textContent = "No scores yet — be the first.";
      rows.push(li);
    }
    el<HTMLOListElement>("board").replaceChildren(...rows);
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
    root.removeChildren();
    scale = size / Math.max(world.map.width, world.map.height);
    root.scale.set(scale);
    root.addChild(drawMap(world.map), dyn);
    el<HTMLSpanElement>("hudLevel").textContent = `${l.featured.title}${l.synthetic ? " (synthetic)" : ""}`;
    el<HTMLSpanElement>("hudGoal").textContent =
      l.level.clutcherSide === "defense" ? "Defend: hold E on the spike for 5 s, or win the fight" : "Attack: survive until the spike blows, or win the fight";
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

  /** Tears the replay down (ticker listener + Pixi objects); safe to call when none is open. */
  const closeReplay = (): void => {
    if (replay) app.renderer.resize(size, size);
    replay?.destroy();
    replay = null;
    replayEnded = false;
  };

  const toAttract = (): void => {
    closeReplay();
    session = null;
    pilot = null;
    current = null;
    card = null;
    finished = null;
    roundChallenge = null;
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
    for (const b of speedButtons) b.setAttribute("aria-pressed", String(b.dataset.speed === String(speed)));
  };

  const toReplay = (): void => {
    if (!finished || !card || screen !== "score") return;
    closeReplay();
    const timeline = buildYouTimeline(finished.world, finished.seed, finished.recording);
    // Two square panels side by side: shrink the canvas to their height (+ title row) meanwhile.
    const replayH = Math.ceil((size - 16) / 2) + 40;
    app.renderer.resize(size, replayH);
    const view = new ReplayView({
      world: finished.world,
      timeline,
      width: size,
      height: replayH,
      onTime: (t, startT, endT) => {
        replaySlider.value = String(t);
        const label = `${(t - startT).toFixed(1)} / ${(endT - startT).toFixed(1)} s`;
        el<HTMLSpanElement>("replayTime").textContent = label;
        replaySlider.setAttribute("aria-valuetext", label);
      },
      // Leaving inside the ticker callback would destroy the view mid-update; the main loop does it.
      onEnd: () => (replayEnded = true),
    });
    replay = view;
    replaySlider.min = String(view.startT);
    replaySlider.max = String(view.endT);
    replaySlider.value = String(view.startT);
    app.stage.addChild(view.view);
    view.attach(app.ticker);
    setReplaySpeed(1);
    setReplayPlaying(true);
    replayEnded = false;
    replayDeadline = performance.now() + REPLAY_MAX_S * 1000;
    show("replay");
    if (!auto) replayToggle.focus();
  };

  const downloadCard = async (): Promise<void> => {
    if (!card || !current || !shareQr) return;
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
      const title = document.createElement("b");
      title.textContent = `${i + 1}. ${l.featured.title}`;
      const blurb = document.createElement("span");
      blurb.textContent = l.blurb;
      btn.append(title, blurb);
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
  replaySlider.addEventListener("input", () => replay?.setTime(Number(replaySlider.value)));
  el<HTMLButtonElement>("replayExit").addEventListener("click", backToScore);
  addEventListener("hashchange", () => {
    readHash();
    if (screen === "attract") toAttract();
  });

  addEventListener("keydown", (e) => {
    // A held Enter/Space must not chain screens (e.g. save → attract → random level).
    // A focused button activates itself on Enter; the global shortcut must not fire as well.
    const onButton = e.target instanceof HTMLButtonElement;
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

  app.ticker.add((ticker) => {
    fpsAcc += ticker.deltaMS;
    fpsFrames++;
    if (fpsAcc >= 1000) {
      fpsEl.textContent = `${Math.round((fpsFrames * 1000) / fpsAcc)} fps`;
      fpsAcc = 0;
      fpsFrames = 0;
    }

    if (screen === "replay") {
      // The score timer is paused here; the replay has its own hard cap back to the (unsaved) score
      // screen, which then restarts its own auto-return timer.
      if (performance.now() > replayDeadline) backToScore();
      else if (replayEnded) backToScore();
      return;
    }
    if (screen === "score") {
      const left = Math.max(0, Math.ceil((scoreDeadline - performance.now()) / 1000));
      el<HTMLSpanElement>("returnIn").textContent = String(left);
      if (left === 0) toAttract();
      return;
    }
    if (screen !== "play" || !session || !current) return;

    const world = session.world;
    if (shouldAbortPlay(performance.now() - playStartedMs, session.state.outcome !== null, roundLimitS(world))) {
      toAttract();
      return;
    }
    const before = session.state.tick;
    // Autopilot is consulted once per sim tick (frame-rate independent); humans per frame.
    const human = pilot ? null : controls.read(scale);
    session.advance(ticker.deltaMS, pilot ?? human!);
    const input = human ?? session.recording[session.recording.length - 1] ?? NO_INPUT;
    const cd = session.countdown;
    countdownEl.hidden = cd === 0;
    el<HTMLDivElement>("countdownNum").textContent = String(cd);
    const s = session.state;
    const now = performance.now();
    if (s.tick !== before) for (const shot of s.shots) tracers.push({ shot, untilMs: now + TRACER_MS });
    tracers = tracers.filter((tr) => tr.untilMs > now);

    drawDynamic(dyn, world, s, input, tracers);
    updateHud(world, s);
    if (s.outcome) toScore(s, current, session);
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
      },
    });
  }

  readHash();
  if (auto || params.has("level")) {
    const idx = Math.min(loaded.length - 1, Math.max(0, Number(params.get("level") ?? 0) || 0));
    startLevel(loaded[idx]!);
  } else {
    toAttract();
  }
}

function drawDynamic(g: Graphics, world: World, s: SimState, input: Input, tracers: readonly Tracer[]): void {
  g.clear();
  const p = s.clutcher;
  if (world.spike && clockAt(world, simTimeAt(world, s.tick)).spikeActive) {
    const sp = world.spike;
    g.circle(sp.x, sp.y, DEFUSE_RADIUS).stroke({ width: 14, color: 0xff3b3b, alpha: 0.6 });
    g.rect(sp.x - 60, sp.y - 60, 120, 120).fill({ color: 0xff3b3b });
    if (p.defuseTicks > 0) {
      const frac = p.defuseTicks / (DEFUSE_S * TICK_HZ);
      g.rect(sp.x - 200, sp.y + 240, 400 * frac, 50).fill({ color: 0x6bff95 });
    }
  }
  for (const e of s.enemies) {
    if (!e.alive) {
      g.moveTo(e.x - 80, e.y - 80).lineTo(e.x + 80, e.y + 80).moveTo(e.x + 80, e.y - 80).lineTo(e.x - 80, e.y + 80);
      g.stroke({ width: 24, color: ENEMY_COLOR, alpha: 0.5 });
      continue;
    }
    // Fog of war: only enemies in the clutcher's line of sight are drawn.
    if (!segmentClear(world.map.walls, p, e)) continue;
    g.circle(e.x, e.y, 110).fill({ color: ENEMY_COLOR });
    g.moveTo(e.x, e.y).lineTo(e.x + e.fx * 220, e.y + e.fy * 220).stroke({ width: 22, color: 0xffffff, alpha: 0.8 });
  }
  g.moveTo(p.x, p.y).lineTo(input.aim.x, input.aim.y).stroke({ width: 8, color: PLAYER_COLOR, alpha: 0.25 });
  g.circle(p.x, p.y, 120).fill({ color: PLAYER_COLOR }).stroke({ width: 16, color: 0xffffff });
  for (const { shot } of tracers) {
    const color = shot.by === "P0" ? 0xfff3b0 : 0xff8a7a;
    g.moveTo(shot.from.x, shot.from.y).lineTo(shot.to.x, shot.to.y).stroke({ width: 14, color, alpha: 0.85 });
  }
}

function updateHud(world: World, s: SimState): void {
  const clock = clockAt(world, simTimeAt(world, s.tick));
  el<HTMLSpanElement>("hudHp").textContent = String(s.clutcher.hp);
  el<HTMLSpanElement>("hudEnemies").textContent = `${s.enemies.filter((e) => e.alive).length} / ${s.enemies.length}`;
  el<HTMLSpanElement>("hudClock").textContent = `${Math.max(0, clock.secondsLeft).toFixed(1)} s`;
  const enemyDefuse = Math.max(0, ...s.enemies.filter((e) => e.alive).map((e) => e.defuseTicks));
  const pct = (ticks: number): number => Math.round((ticks / (DEFUSE_S * TICK_HZ)) * 100);
  el<HTMLSpanElement>("hudSpike").textContent = clock.spikeActive
    ? s.clutcher.defuseTicks > 0
      ? `defusing ${pct(s.clutcher.defuseTicks)}%`
      : enemyDefuse > 0
        ? `ENEMY DEFUSING ${pct(enemyDefuse)}%`
        : "planted"
    : "not planted";
}
