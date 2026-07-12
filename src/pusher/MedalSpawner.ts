import { MedalPool } from './MedalPool';
import { LAYOUT } from './layout';
import { bus } from '../core/EventBus';

/**
 * Drops medals into the cabinet from the chute. Handles both player drops and
 * queued payout/burst dispensing (rate-limited so wins rain in physically).
 */
export class MedalSpawner {
  private queue: Array<{ x: number; jackpot: boolean }> = [];
  private cooldown = 0;
  private dropInterval = 0.05; // seconds between queued drops

  constructor(private pool: MedalPool) {}

  /**
   * Toss a coin INTO the cabinet at the aimed X with a front-to-back parabolic
   * arc: it launches near the player side (front, +Z) at hand height, then flies
   * UP and over toward the BACK of the upper deck while tumbling — landing near
   * the chute, where the pusher feeds it forward. Gives medal insertion a
   * hand-thrown "手前から奥へ放り込む" feel instead of a dead vertical drop.
   */
  toss(x: number): boolean {
    if (this.pool.activeCount >= LAYOUT.maxMedals) {
      return false;
    }
    const hw = LAYOUT.pusher.halfWidth - 0.5;
    const cx = Math.max(-hw, Math.min(hw, x));
    // launch point: player side (front), hand height, just inside the front edge
    const px = cx + (Math.random() - 0.5) * 0.18;
    const py = 1.5;
    const pz = 2.6;
    // up + back velocity → a high arc that clears the field and lands on the back
    // deck (~z -2.0); a touch of lateral scatter and a brisk tumble so coins dance
    const vx = (Math.random() - 0.5) * 0.6;
    const vy = 3.6 + Math.random() * 0.5;
    const vz = -(4.8 + Math.random() * 0.5);
    const spin = 8 + Math.random() * 6;
    const idx = this.pool.spawn(px, py, pz, {
      vx,
      vy,
      vz,
      avx: -spin, // forward tumble over the throw axis as it flies back
      avy: (Math.random() - 0.5) * 6,
      avz: (Math.random() - 0.5) * 4,
    });
    if (idx >= 0) bus.emit('sfx', { name: 'drop' });
    return idx >= 0;
  }

  /** Queue n medals to drop over time (payouts, jackpot rain). */
  dispense(n: number, jackpot = false, spread = LAYOUT.pusher.halfWidth - 0.5): void {
    for (let i = 0; i < n; i++) {
      const x = (Math.random() * 2 - 1) * spread;
      this.queue.push({ x, jackpot });
    }
  }

  fixedUpdate(dt: number): void {
    if (this.queue.length === 0) return;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = this.dropInterval;
    const item = this.queue.shift()!;
    this.pool.spawn(item.x, LAYOUT.chute.y + Math.random() * 0.5, LAYOUT.chute.z + (Math.random() - 0.5) * 0.5, {
      jackpot: item.jackpot,
      vz: 0.1,
      vy: -0.4,
    });
  }
}
