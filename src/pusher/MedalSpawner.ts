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
  // Player inserts get the same spacing treatment as bulk payouts. Two medals
  // spawned at the SAME point in one physics step start interpenetrating, and
  // Rapier resolves that by flinging them apart — enough of them at once builds
  // a vertical tower of coins up through the cabinet. Hold-to-insert is already
  // rate-limited to 0.12s so this never bites in normal play, but the debug
  // insert hook (and any test driving it) can burst, and a spawner that only
  // behaves when its caller is polite is a trap.
  private tossQueue: number[] = [];
  private tossCooldown = 0;
  private tossInterval = 0.045;

  constructor(private pool: MedalPool) {}

  /**
   * Toss a coin INTO the cabinet at the aimed X with a front-to-back parabolic
   * arc: it launches near the player side (front, +Z) at hand height, then flies
   * UP and over toward the BACK of the upper deck while tumbling — landing near
   * the chute, where the pusher feeds it forward. Gives medal insertion a
   * hand-thrown "手前から奥へ放り込む" feel instead of a dead vertical drop.
   */
  toss(x: number): boolean {
    if (this.pool.activeCount + this.tossQueue.length >= LAYOUT.maxMedals) {
      return false;
    }
    // free slot this step? throw it now; otherwise line it up behind the others
    if (this.tossCooldown > 0) {
      this.tossQueue.push(x);
      return true;
    }
    this.tossCooldown = this.tossInterval;
    return this.throwCoin(x);
  }

  /** The actual parabolic throw. */
  private throwCoin(x: number): boolean {
    const hw = LAYOUT.pusher.halfWidth - 0.5;
    const cx = Math.max(-hw, Math.min(hw, x));
    // launch point: player side (front), hand height, just inside the front edge
    const px = cx + (Math.random() - 0.5) * 0.18;
    const py = 1.5;
    const pz = 2.6;
    // Up + back velocity → a high arc that clears the field and lands on the back
    // deck (~z -2.1); a touch of lateral scatter and a brisk tumble so coins dance.
    //
    // These are tied to gravity, and they have to be re-derived whenever it moves.
    // The medals were made heavier by raising world gravity from -9.81 to -15.5,
    // which cut the flight time from 0.93s to 0.63s and dropped the landing point
    // from z=-2.1 to z=-0.6 — coins were falling in the MIDDLE of the field
    // instead of on the back deck. Solving 1.5 + vy·t - g·t²/2 = 0.85 (deck top)
    // for a 0.75s flight, with vz·t = 4.7, gives the figures below; the arc peaks
    // at y≈2.3, well under the 5.45 glass ceiling.
    const vx = (Math.random() - 0.5) * 0.6;
    const vy = 4.95 + Math.random() * 0.55;
    const vz = -(6.25 + Math.random() * 0.65);
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
    if (this.tossCooldown > 0) this.tossCooldown -= dt;
    if (this.tossQueue.length > 0 && this.tossCooldown <= 0) {
      this.tossCooldown = this.tossInterval;
      this.throwCoin(this.tossQueue.shift()!);
    }

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
