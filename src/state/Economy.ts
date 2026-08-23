import { Rng, rng as defaultRng } from '../utils/rng';
import { GameStore } from './GameStore';

// The すごろく run, the jackpot bowl it hands off to at the GOAL, and the
// チンチロ multiplier that rides on whatever the bowl awarded. Keep the union
// tight so the state machine & event payloads stay honest.
export type MiniGameKind = 'sugoroku' | 'bowl' | 'chinchiro';

// How a board result affects the (internal) FEVER state:
//  - 'start' : 目的地到着 → enter FEVER (all payouts doubled for a while)
//  - 'end'   : 貧乏神とりつき → leave FEVER
//  - 'none'  : every other square → no change
export type FeverAction = 'start' | 'end' | 'none';

/**
 * Central RNG & payout authority. All randomness flows through here so odds are
 * tunable and (with a seeded Rng) testable.
 */
export class Economy {
  constructor(private store: GameStore, private rng: Rng = defaultRng) {}

  // --- jackpot accrual ---------------------------------------------------
  // In steady state a progressive pool pays out exactly what it takes in, so
  // these rates ARE a slice of the payback ratio, not free money. They are split
  // by SOURCE because the two sources have wildly different volumes: with the
  // side holes swallowing ~1.6 medals per medal inserted, a single shared rate
  // tuned for inserts turns the jackpot into the dominant payout channel. (It
  // did: measured at 0.35/medal the pool alone was returning ~75% of inserts.)
  // Together these land the jackpot at ~6% of the ~90% total. Every point spent
  // here is a point the board cannot pay out, so it is kept lean.
  static readonly JP_PER_INSERT = 0.05;
  static readonly JP_PER_LOSS = 0.015;

  /** The player fed a medal in. */
  fundFromInsert(): void {
    this.store.addToJackpot(Economy.JP_PER_INSERT);
  }

  /** Medals the player lost outright — side holes and 赤マス deductions. */
  fundFromLoss(medals: number): void {
    this.store.addToJackpot(medals * Economy.JP_PER_LOSS);
  }

  /** Board dice, exposed here so every draw in the game flows through one Rng. */
  roll(min = 1, max = 6): number {
    return this.rng.int(min, max);
  }

  // Square payouts live in Board.ts (BOARD + PAYOUT_SCALE); the bowl's prize is
  // decided by REAL physics in JackpotBowl (when the ball drops through decides
  // which roulette wedge is under the pointer). Nothing else here rolls for money.
}
