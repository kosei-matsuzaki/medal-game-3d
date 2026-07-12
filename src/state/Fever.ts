import { bus } from '../core/EventBus';
import { FeverAction } from './Economy';

// Safety cap: FEVER can't run forever if the slot stops spinning (e.g. the stock
// empties before an even number ends it). Purely internal — never shown.
const MAX_SEC = 30;

/**
 * FEVER — an INTERNAL payout-multiplier state. It is entered by a slot 7揃い(虹),
 * continues on odd-number / BALL wins (and misses), and ends on an even-number
 * win. While active: ALL payouts are doubled (`mult`) AND the slot wins more often
 * (Economy.slotRoll consults `isActive`). The only on-screen presence is a banner
 * driven by the 'fever:changed' event — there is no charge gauge. A hidden safety
 * timer guarantees it eventually clears even with no further spins.
 */
export class Fever {
  private active = false;
  private remain = 0;

  /** Payout multiplier currently in effect (2 during FEVER, else 1). */
  get mult(): number {
    return this.active ? 2 : 1;
  }
  get isActive(): boolean {
    return this.active;
  }

  /** Apply a slot result's FEVER action. Returns true if the state changed. */
  onSlotResult(action: FeverAction | undefined): boolean {
    if (action === 'start') {
      const changed = !this.active;
      this.active = true;
      this.remain = MAX_SEC;
      if (changed) this.emit();
      return changed;
    }
    if (action === 'end' && this.active) {
      this.active = false;
      this.remain = 0;
      this.emit();
      return true;
    }
    if (this.active) this.remain = MAX_SEC; // any spin while active refreshes the safety timer
    return false;
  }

  /** Debug/testing: jump straight into FEVER. */
  debugActivate(): void {
    if (!this.active) {
      this.active = true;
      this.emit();
    }
    this.remain = MAX_SEC;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.remain -= dt;
    if (this.remain <= 0) {
      this.active = false;
      this.emit();
    }
  }

  private emit(): void {
    bus.emit('fever:changed', { active: this.active });
  }
}
