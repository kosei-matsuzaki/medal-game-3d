import { FIXED_DT, Time } from './Time';

/**
 * Fixed-timestep accumulator loop.
 * - fixedUpdate(dt) runs at a constant FIXED_DT for deterministic physics.
 * - update(dt) runs once per render frame (variable) for visuals/tweens.
 * - render(alpha) gets an interpolation factor in [0,1) for smooth display.
 *
 * `turbo` exists for measurement. Anything about this machine that has to be
 * measured rather than reasoned about — how much of the field the side holes
 * actually swallow, what the long-run payback is — needs thousands of medals to
 * resolve, and under software GL a headless browser renders far slower than real
 * time, so a useful sample took a quarter of an hour of pinned CPU. With turbo on
 * the loop runs N extra physics+logic steps per frame and stops drawing entirely:
 * the same simulation, ~100× the game time per wall-second, and almost no GPU
 * load. It is a test instrument, reachable only through the ?debug console.
 */
export class Loop {
  private time = new Time();
  private acc = 0;
  private running = false;
  private rafId = 0;
  private maxSteps = 6; // avoid spiral-of-death

  /** Extra fixed steps per frame; rendering is skipped while this is > 0. */
  turbo = 0;

  /** Total simulated time, in seconds. Advances with the physics, not the clock. */
  gameTime = 0;

  fixedUpdate: (dt: number) => void = () => {};
  update: (dt: number) => void = () => {};
  /**
   * The subset of `update` that turbo runs: game LOGIC only, no presentation.
   *
   * Turbo has to tick logic every step or in-game timers would run at a
   * different rate from the physics they are timing. But the presentation half
   * of `update` — redrawing the monitor's canvas, re-uploading its texture,
   * post-FX, HUD — costs far more than a physics step and produces nothing
   * anyone will see, and running it 70× per frame made turbo SLOWER than real
   * time. Game supplies the logic-only half here.
   */
  turboUpdate: (dt: number) => void = () => {};
  render: (alpha: number) => void = () => {};

  start(): void {
    if (this.running) return;
    this.running = true;
    this.time.start(performance.now());
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = this.time.tick(now);

      // Turbo: burn through game time without drawing. Each iteration is a full
      // fixed step plus one logic update at the SAME dt, so every timer in the
      // game advances exactly as it would at 60fps — turbo changes how fast the
      // simulation is played back, never what it simulates.
      if (this.turbo > 0) {
        try {
          for (let i = 0; i < this.turbo; i++) {
            this.fixedUpdate(FIXED_DT);
            this.turboUpdate(FIXED_DT);
            this.gameTime += FIXED_DT;
          }
        } catch (err) {
          console.error('[Loop] turbo step threw:', err);
        }
        this.acc = 0;
        this.rafId = requestAnimationFrame(frame);
        return;
      }

      this.acc += dt;
      let steps = 0;
      try {
        while (this.acc >= FIXED_DT && steps < this.maxSteps) {
          this.fixedUpdate(FIXED_DT);
          this.gameTime += FIXED_DT;
          this.acc -= FIXED_DT;
          steps++;
        }
      } catch (err) {
        console.error('[Loop] fixedUpdate threw:', err);
        this.acc = 0;
      }
      if (steps === this.maxSteps) this.acc = 0; // drop backlog
      try {
        this.update(dt);
        this.render(this.acc / FIXED_DT);
      } catch (err) {
        console.error('[Loop] update/render threw:', err);
      }
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /**
   * Run `n` fixed steps RIGHT NOW, synchronously, without touching the clock.
   *
   * Turbo alone is not enough for measurement: a headless browser throttles
   * requestAnimationFrame to roughly 1fps whatever the page does, which caps
   * turbo at a couple of times real time no matter how many steps each frame
   * takes. Driving the steps straight from the test — one call, n steps, no
   * frames involved — takes the browser's frame scheduler out of the loop
   * entirely.
   *
   * Same fixedUpdate and same logic tick as normal play, so the simulation is
   * identical; only the thing deciding WHEN to step is different.
   */
  runSteps(n: number): number {
    const steps = Math.max(0, Math.min(20000, n | 0));
    for (let i = 0; i < steps; i++) {
      this.fixedUpdate(FIXED_DT);
      this.turboUpdate(FIXED_DT);
      this.gameTime += FIXED_DT;
    }
    return this.gameTime;
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  get elapsed(): number {
    return this.time.elapsed;
  }
}
