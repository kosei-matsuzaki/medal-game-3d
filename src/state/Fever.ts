import { bus } from '../core/EventBus';
import { FeverAction } from './Economy';

// How many BOARD TURNS a FEVER lasts after the GOAL that started it.
//
// It has to be counted in turns, not seconds. The old course had a 貧乏神 square
// that switched FEVER off; the 50-square GOLD MINE course has no such square, so
// with only the wall-clock timer below — which every turn refreshed — FEVER
// became PERMANENT after a player's first GOAL, quietly doubling every board
// payout for the rest of the session. A turn count cannot be refreshed by
// playing, so it always runs out.
//
// A run is ~14 turns, so 5 doubles roughly a third of them.
const FEVER_TURNS = 5;

// Safety cap: FEVER can't run forever if the board stops turning (the player
// walks away mid-leg). Purely internal — never shown.
const MAX_SEC = 30;

/**
 * FEVER — an INTERNAL payout-multiplier state. Reaching the GOAL turns it on and
 * it runs for the next `FEVER_TURNS` board turns. While active BOARD payouts are
 * doubled (`mult`);
 * the front tray always credits 1 per medal, fever or not.
 * The only on-screen presence is a banner driven by the 'fever:changed' event —
 * there is no charge gauge. A hidden safety timer guarantees it eventually clears
 * even if the player stops feeding the board.
 */
export class Fever {
  private active = false;
  private remain = 0;
  private turnsLeft = 0;

  /** Payout multiplier currently in effect (2 during FEVER, else 1). */
  get mult(): number {
    return this.active ? 2 : 1;
  }
  get isActive(): boolean {
    return this.active;
  }

  /** Apply a board result's FEVER action. Returns true if the state changed. */
  onBoardResult(action: FeverAction | undefined): boolean {
    if (action === 'start') {
      const changed = !this.active;
      this.active = true;
      this.turnsLeft = FEVER_TURNS;
      this.remain = MAX_SEC;
      if (changed) this.emit();
      return changed;
    }
    if (action === 'end' && this.active) {
      this.active = false;
      this.turnsLeft = 0;
      this.remain = 0;
      this.emit();
      return true;
    }
    if (this.active) {
      // The turn that just resolved was a FEVER turn — spend it. The wall-clock
      // timer is refreshed too, but it is only the walk-away backstop; the turn
      // count is what actually ends a FEVER.
      this.remain = MAX_SEC;
      if (--this.turnsLeft <= 0) {
        this.active = false;
        this.emit();
        return true;
      }
    }
    return false;
  }

  /** Debug/testing: jump straight into FEVER. */
  debugActivate(): void {
    if (!this.active) {
      this.active = true;
      this.emit();
    }
    this.turnsLeft = FEVER_TURNS;
    this.remain = MAX_SEC;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.remain -= dt;
    if (this.remain <= 0) {
      this.active = false;
      this.turnsLeft = 0;
      this.emit();
    }
  }

  private emit(): void {
    bus.emit('fever:changed', { active: this.active });
  }
}
