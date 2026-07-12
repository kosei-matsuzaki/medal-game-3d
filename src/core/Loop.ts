import { FIXED_DT, Time } from './Time';

/**
 * Fixed-timestep accumulator loop.
 * - fixedUpdate(dt) runs at a constant FIXED_DT for deterministic physics.
 * - update(dt) runs once per render frame (variable) for visuals/tweens.
 * - render(alpha) gets an interpolation factor in [0,1) for smooth display.
 */
export class Loop {
  private time = new Time();
  private acc = 0;
  private running = false;
  private rafId = 0;
  private maxSteps = 6; // avoid spiral-of-death

  fixedUpdate: (dt: number) => void = () => {};
  update: (dt: number) => void = () => {};
  render: (alpha: number) => void = () => {};

  start(): void {
    if (this.running) return;
    this.running = true;
    this.time.start(performance.now());
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = this.time.tick(now);
      this.acc += dt;
      let steps = 0;
      try {
        while (this.acc >= FIXED_DT && steps < this.maxSteps) {
          this.fixedUpdate(FIXED_DT);
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

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  get elapsed(): number {
    return this.time.elapsed;
  }
}
