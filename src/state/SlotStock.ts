import { bus } from '../core/EventBus';

export const STOCK_MAX = 10;
export const MULT_MAX = 5;

/**
 * Slot spin stock with per-spin multipliers.
 *
 * - Each coin through the centre lane stocks one spin (×1) until 10 are held.
 * - When full, further coins UPGRADE multipliers: the first (leftmost) entry at
 *   the current minimum level is bumped, so the stock fills ×1→×2 across all ten,
 *   then ×2→×3, … up to ×5.
 * - The slot consumes spins from the FRONT (oldest), applying that spin's
 *   multiplier. When a spin is consumed (10→9) the next coin refills a ×1 at the
 *   back (the 10th slot).
 */
export class SlotStock {
  /** multipliers, front = next to play; length 0..STOCK_MAX */
  slots: number[] = [];

  /** A coin passed the lane: stock a spin or upgrade when full. */
  add(): void {
    if (this.slots.length < STOCK_MAX) {
      this.slots.push(1);
    } else {
      const min = Math.min(...this.slots);
      if (min >= MULT_MAX) return; // fully maxed — overflow ignored
      const i = this.slots.indexOf(min);
      this.slots[i] = min + 1;
    }
    this.changed();
  }

  /** Consume the next spin's multiplier (front). Returns 1 if empty. */
  consume(): number {
    const m = this.slots.shift() ?? 1;
    this.changed();
    return m;
  }

  get count(): number {
    return this.slots.length;
  }

  private changed(): void {
    bus.emit('stock:changed', { slots: this.slots.slice() });
  }
}
