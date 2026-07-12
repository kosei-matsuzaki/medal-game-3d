/** Seedable RNG (mulberry32) — deterministic, testable lottery draws. */
export class Rng {
  private s: number;

  constructor(seed = (Date.now() ^ 0x9e3779b9) >>> 0) {
    this.s = seed >>> 0;
  }

  /** float in [0,1) */
  next(): number {
    this.s |= 0;
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** int in [min,max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** weighted pick: returns index according to weights */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

/** Shared default instance (non-deterministic seed). */
export const rng = new Rng();
