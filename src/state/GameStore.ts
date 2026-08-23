import { bus } from '../core/EventBus';
import { SaveManager } from '../save/SaveManager';

/**
 * Observable game economy state. Mutations emit events for the HUD and persist
 * through the SaveManager.
 */
export class GameStore {
  constructor(private save: SaveManager) {}

  get credits(): number {
    return this.save.get().credits;
  }
  get jackpotPool(): number {
    return this.save.get().jackpotPool;
  }
  get totalWon(): number {
    return this.save.get().totalWon;
  }
  get bestWin(): number {
    return this.save.get().bestWin;
  }

  // --- progression -------------------------------------------------------
  get level(): number {
    return this.save.get().level;
  }
  get exp(): number {
    return this.save.get().exp;
  }
  setProgress(level: number, exp: number): void {
    const d = this.save.get();
    d.level = level;
    d.exp = exp;
    this.save.save();
  }

  addCredits(delta: number): void {
    const d = this.save.get();
    d.credits = Math.max(0, d.credits + delta);
    if (delta > 0) {
      d.totalWon += delta;
      if (delta > d.bestWin) d.bestWin = delta;
    }
    this.save.save();
    bus.emit('credits:changed', { credits: d.credits, delta });
  }

  /** Returns false if the player can't afford it. */
  spend(amount: number): boolean {
    const d = this.save.get();
    if (d.credits < amount) return false;
    d.credits -= amount;
    this.save.save();
    bus.emit('credits:changed', { credits: d.credits, delta: -amount });
    return true;
  }

  addToJackpot(amount: number): void {
    const d = this.save.get();
    d.jackpotPool += amount;
    this.save.save();
    bus.emit('jackpot:changed', { pool: d.jackpotPool });
  }

  /** Award & reset the jackpot pool (keeps a seed so it never hits zero). */
  awardJackpot(seed = 500): number {
    const d = this.save.get();
    const amount = Math.floor(d.jackpotPool);
    d.jackpotPool = seed;
    this.save.save();
    bus.emit('jackpot:changed', { pool: d.jackpotPool });
    bus.emit('jackpot:won', { amount });
    return amount;
  }
}
