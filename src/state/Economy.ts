import { Rng, rng as defaultRng } from '../utils/rng';
import { GameStore } from './GameStore';

// The slot, the disc (円盤) JP challenge, and the jackpot (JP) drop stage it chains
// into. Keep the union tight so the state machine & event payloads stay honest.
export type MiniGameKind = 'slot' | 'disc' | 'jackpot';

// 10 reel symbols: numbers 1-9 plus a BALL mark.
export const SLOT_SYMBOLS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'BALL'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

// How a spin's outcome affects the (internal) FEVER state:
//  - 'start' : 7揃い(虹) → enter FEVER
//  - 'end'   : even-number win → leave FEVER
//  - 'none'  : odd-number win / BALL / miss → no change (FEVER continues)
export type FeverAction = 'start' | 'end' | 'none';

export interface SlotResult {
  reels: [SlotSymbol, SlotSymbol, SlotSymbol];
  payout: number; // matched number × 10 (0 for lose / ball)
  ball: boolean; // three BALLs → eject a ball (→ JP challenge)
  jackpot: boolean;
  feverAction: FeverAction;
  label: string;
}

/**
 * Central RNG & payout authority. All randomness flows through here so odds are
 * tunable and (with a seeded Rng) testable.
 */
export class Economy {
  constructor(private store: GameStore, private rng: Rng = defaultRng) {}

  // --- jackpot accrual ---------------------------------------------------
  /** Fraction of every spent/lost medal feeds the progressive jackpot. */
  accrue(medals: number): void {
    this.store.addToJackpot(medals * 0.35);
  }

  // --- slot --------------------------------------------------------------
  // Odds are LOW and FIXED, like a conventional slot (no ceiling / 天井). Every
  // probability below is an absolute per-spin chance; they're checked on a single
  // cumulative roll, so they must sum to < 1 (the remainder is a MISS).
  //   7揃い(虹)  → enter FEVER (and pays 70)
  //   number     → pays number×10 (excludes 7; odd continues FEVER, even ends it)
  //   BALL       → ejects a field ball (→ disc / JP challenge)
  static readonly SEVEN_CHANCE = 0.012; // triple-7 → FEVER
  static readonly NUMBER_CHANCE = 0.05; // any non-7 number match
  static readonly BALL_CHANCE = 0.08; // BALL match → field ball
  // During FEVER the slot pays out far more readily (numbers & 7 both boosted).
  static readonly FEVER_NUMBER_MULT = 4; // ~0.20 number-match chance in FEVER
  static readonly FEVER_SEVEN_MULT = 2; // 7揃い easier to extend FEVER

  slotRoll(feverActive = false): SlotResult {
    const sevenChance = Economy.SEVEN_CHANCE * (feverActive ? Economy.FEVER_SEVEN_MULT : 1);
    const numberChance = Economy.NUMBER_CHANCE * (feverActive ? Economy.FEVER_NUMBER_MULT : 1);
    const r = this.rng.next();
    // 1) 7揃い(虹) — rarest. Pays 70 AND triggers FEVER.
    if (r < sevenChance) {
      return {
        reels: ['7', '7', '7'],
        payout: 70,
        ball: false,
        jackpot: false,
        feverAction: 'start',
        label: '7揃い!! FEVER',
      };
    }
    // 2) number match (1-9 excluding 7) — lower numbers more common.
    if (r < sevenChance + numberChance) {
      const nums = [1, 2, 3, 4, 5, 6, 8, 9];
      const idx = this.rng.weightedIndex([8, 7, 6, 5, 4, 3, 2, 1]); // bias to low numbers
      const num = nums[idx];
      const s = String(num) as SlotSymbol;
      const feverAction: FeverAction = num % 2 === 0 ? 'end' : 'none'; // even ends FEVER
      return { reels: [s, s, s], payout: num * 10, ball: false, jackpot: false, feverAction, label: `${num} 揃い  +${num * 10}` };
    }
    // 3) BALL match — ejects a field ball (FEVER continues).
    if (r < sevenChance + numberChance + Economy.BALL_CHANCE) {
      return { reels: ['BALL', 'BALL', 'BALL'], payout: 0, ball: true, jackpot: false, feverAction: 'none', label: 'BALL!! JPチャンス' };
    }
    return { reels: this.loseReels(), payout: 0, ball: false, jackpot: false, feverAction: 'none', label: 'MISS' };
  }

  private loseReels(): [SlotSymbol, SlotSymbol, SlotSymbol] {
    // numbers only (exclude BALL), and never an accidental 3-of-a-kind
    const r = () => String(this.rng.int(1, 9)) as SlotSymbol;
    let a: SlotSymbol, b: SlotSymbol, c: SlotSymbol;
    do {
      a = r();
      b = r();
      c = r();
    } while (a === b && b === c);
    return [a, b, c];
  }

  // The disc (円盤) and JP (jackpot) stage outcomes are decided by REAL physics in
  // DiscChallenge / JackpotChallenge — no RNG roll here.
}
