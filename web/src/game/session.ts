import { DT } from "../sim/constants";
import { initState, step, type Command, type Input, type SimState } from "../sim/sim";
import type { World } from "../sim/world";
import { COUNTDOWN_S } from "./timing";

/** Catch-up limit so a stalled tab does not freeze on a burst of ticks. */
const MAX_STEPS_PER_ADVANCE = 5;

/**
 * One player's round: fixed-step driver around the pure sim, recording every applied input
 * (seed + recording reproduce the round exactly; basis for replay). The sim only starts after
 * the countdown; nothing is recorded during it.
 */
export class Session {
  readonly world: World;
  readonly seed: number;
  state: SimState;
  readonly recording: Command[] = [];
  private accMs = 0;
  private countdownMs: number;

  constructor(world: World, seed: number, countdownS = COUNTDOWN_S) {
    this.world = world;
    this.seed = seed;
    this.state = initState(world, seed);
    this.countdownMs = countdownS * 1000;
  }

  /** Whole seconds left on the pre-round countdown (0 once the round runs). */
  get countdown(): number {
    return Math.ceil(this.countdownMs / 1000);
  }

  /**
   * Feed real elapsed time; runs whole 30 Hz ticks. `input` is either the device snapshot for this
   * frame or a controller asked once per tick with the current state (autopilot), so scripted play
   * does not depend on the frame rate and never runs during the countdown. Returns ticks run.
   */
  advance(elapsedMs: number, input: Input | ((s: SimState) => Input)): number {
    let ms = elapsedMs;
    if (this.countdownMs > 0) {
      const used = Math.min(this.countdownMs, ms);
      this.countdownMs -= used;
      ms -= used;
      if (this.countdownMs > 0) return 0;
    }
    this.accMs = Math.min(this.accMs + ms, MAX_STEPS_PER_ADVANCE * DT * 1000);
    let n = 0;
    while (this.accMs >= DT * 1000 && !this.state.outcome) {
      this.accMs -= DT * 1000;
      const tickInput = typeof input === "function" ? input(this.state) : input;
      const cmd: Command = { ...tickInput, tick: this.state.tick + 1 };
      this.recording.push(cmd);
      this.state = step(this.world, this.state, cmd);
      n++;
    }
    return n;
  }
}
