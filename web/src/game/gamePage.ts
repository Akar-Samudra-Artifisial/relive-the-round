import { Application, Container, Graphics } from "pixi.js";
import { mapFor } from "../maps";
import { drawMap } from "../render/mapView";
import { DEFUSE_RADIUS, DEFUSE_S, TICK_HZ } from "../sim/constants";
import { segmentClear, type Vec2 } from "../sim/geom";
import { clockAt, NO_INPUT, simTimeAt, type Input, type ShotEvent, type SimState } from "../sim/sim";
import { buildWorld, type World } from "../sim/world";
import { createAutopilot, type Autopilot } from "./autopilot";
import { blocksDefault, mapInput, type Screen } from "./input";
import { addEntry, normalizeInitials, topEntries, validInitials } from "./leaderboard";
import { FEATURED, loadFeatured, type LoadedLevel } from "./levels";
import { scoreRound, type ScoreCard } from "./score";
import { Session } from "./session";
import { COUNTDOWN_S, MAX_SESSION_S, roundLimitS, SCORE_RETURN_S, sessionBudgetS, shouldAbortPlay } from "./timing";

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
      if (blocksDefault(e.code, screen())) e.preventDefault();
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

  const show = (next: Screen): void => {
    screen = next;
    attract.hidden = next !== "attract";
    scoreScreen.hidden = next !== "score";
    hud.hidden = next !== "play";
    countdownEl.hidden = next !== "play";
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

  const startLevel = (l: LoadedLevel): void => {
    const world = worlds.get(l)!;
    current = l;
    session = new Session(world, fixedSeed !== null ? Number(fixedSeed) >>> 0 : randomSeed(), COUNTDOWN_S);
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

  const toAttract = (): void => {
    session = null;
    pilot = null;
    current = null;
    card = null;
    renderBoard();
    show("attract");
  };

  const toScore = (s: SimState, l: LoadedLevel): void => {
    card = scoreRound(l.level, s);
    saved = false;
    scoreDeadline = performance.now() + SCORE_RETURN_S * 1000;
    el<HTMLHeadingElement>("resultTitle").textContent = card.won ? "Clutched!" : "Not this time";
    el<HTMLParagraphElement>("resultReason").textContent = REASON_TEXT[card.reason];
    el<HTMLTableSectionElement>("resultRows").innerHTML = [
      ["Result", card.won ? "Won" : "Lost", card.proWon ? "Won" : "Lost"],
      ["Time", `${card.timeS.toFixed(1)} s`, `${card.proTimeS.toFixed(1)} s`],
      ["Kills", `${card.kills} / ${card.enemies}`, "—"],
      ["HP left", String(card.hpLeft), "—"],
      ["Accuracy", `${Math.round(card.accuracy * 100)}%`, "—"],
    ]
      .map(([a, b, c]) => `<tr><th>${a}</th><td>${b}</td><td>${c}</td></tr>`)
      .join("");
    el<HTMLParagraphElement>("resultPro").textContent = `Pro #1: ${card.proWon ? "won" : "lost"} in ${card.proTimeS.toFixed(1)} s`;
    el<HTMLSpanElement>("resultPoints").textContent = String(card.points);
    const initials = el<HTMLInputElement>("initials");
    initials.value = "";
    el<HTMLButtonElement>("saveScore").disabled = false;
    el<HTMLParagraphElement>("initialsMsg").textContent = INITIALS_HINT;
    show("score");
    if (!auto) initials.focus();
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

  addEventListener("keydown", (e) => {
    // A held Enter/Space must not chain screens (e.g. save → attract → random level).
    if (e.repeat && (e.key === "Enter" || e.code === "Space")) return;
    if (screen === "attract") {
      const n = Number(e.key);
      if (n >= 1 && n <= loaded.length) startLevel(loaded[n - 1]!);
      else if (e.key === "Enter") startRandom();
    } else if (screen === "score" && e.key === "Enter") {
      // Empty box = explicit skip; anything else must be valid initials.
      if (el<HTMLInputElement>("initials").value === "" || saveScore()) toAttract();
    } else if (screen === "play" && e.key === "Escape") {
      toAttract();
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
    if (s.outcome) toScore(s, current);
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
      },
    });
  }

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
