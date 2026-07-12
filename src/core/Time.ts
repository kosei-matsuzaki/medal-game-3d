/** Global timing constants & per-frame clock. */
export const FIXED_DT = 1 / 60; // physics step (s) — 60Hz halves physics CPU vs 120Hz so ~500 medals stay smooth
export const MAX_FRAME_DT = 1 / 15; // clamp huge frame gaps (tab switch)

export class Time {
  /** seconds since start */
  elapsed = 0;
  /** last render frame delta (clamped), seconds */
  delta = 0;
  private last = 0;

  start(nowMs: number): void {
    this.last = nowMs;
  }

  /** advance, returns clamped frame delta in seconds */
  tick(nowMs: number): number {
    let dt = (nowMs - this.last) / 1000;
    this.last = nowMs;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    if (dt < 0) dt = 0;
    this.delta = dt;
    this.elapsed += dt;
    return dt;
  }
}
