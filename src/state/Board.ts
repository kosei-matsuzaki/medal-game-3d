import { bus } from '../core/EventBus';
import { SaveManager } from '../save/SaveManager';
import { Rng, rng as defaultRng } from '../utils/rng';

export type SquareKind =
  /** nothing happens — the breathing room that makes the other squares land */
  | 'empty'
  /** a flat medal payout */
  | 'medal'
  /** feeds the progressive jackpot pool */
  | 'jpup'
  /** a dice minigame: throw again, payout scales with the face */
  | 'dice'
  /** next turn throws TWO dice */
  | 'twice'
  /** next turn the player PICKS the face instead of throwing */
  | 'pick'
  /** next payout doubled */
  | 'boost'
  /** jump forward */
  | 'warp'
  /** slide back */
  | 'back'
  /** the end of the course */
  | 'goal';

export interface Square {
  kind: SquareKind;
  /** medals paid (medal), medals added to the pool (jpup), or squares moved */
  value: number;
  label: string;
}

/**
 * Single global tuning knob for every medal figure on the board. The *shape* of
 * the payout curve is authored below; this scales the whole thing so the payback
 * ratio can be tuned after measuring how much the side drains actually swallow.
 *
 * The drain caps everything: payback is (1-s)(1+w) + jp, where s is the fraction
 * of medals the side holes swallow and w is medals dispensed per medal inserted.
 * It is a WEAK lever, which is worth knowing before reaching for it. At the
 * measured drain the front tray alone returns (1-s) of every medal inserted —
 * about 71% — so the whole board, bowl and jackpot together are only fighting
 * over the last 20 points. Dropping this from 0.50 to 0.30 moved payback by less
 * than four points while making every square on the course look mean.
 *
 * `LAYOUT.medalsPerBall` is the strong one: it changes how many medals a turn
 * COSTS without touching how much a turn PAYS, so it scales payback directly and
 * makes each win rarer and larger at the same time. Tune with that first and use
 * this only to shape the curve.
 */
export const PAYOUT_SCALE = 0.65;

const scale = (v: number): number => Math.max(0, Math.round(v * PAYOUT_SCALE));

/** Values are scaled ONCE, at authoring time, and the label derives from the
 *  scaled number — the board must never print a figure it will not honour. */
const S = (kind: SquareKind, value = 0, label?: string): Square => {
  const v = kind === 'medal' || kind === 'jpup' ? scale(value) : value;
  return {
    kind,
    value: v,
    label:
      label ??
      (kind === 'medal'
        ? `+${v}`
        : kind === 'jpup'
          ? `JP+${v}`
          : ''),
  };
};

/**
 * THE COURSE — a 50-square run from START to the GOLD MINE, not a loop.
 *
 * A ring has no finish line, so nothing on it can ever be a climax; a course
 * does, and the whole board becomes a countdown to it. Reaching the end fires the
 * 抽選ボウル (the JPC draw) and the run resets, so the jackpot is always something
 * the player travelled the length of the board to reach.
 *
 * Density is authored, not random: `empty` squares are the majority so that a
 * payout or a special actually registers when it comes up, specials cluster
 * slightly toward the back half (the run should get more eventful as the mine
 * gets closer), and `back` squares sit just past good ones so losing ground
 * costs something you can see.
 */
const C: Square[] = [
  /* 0 */ S('empty'),
  S('medal', 6),
  S('empty'),
  S('dice', 0, 'ダイス勝負'),
  S('empty'),
  S('jpup', 4),
  S('empty'),
  S('medal', 10),
  S('back', 2, '2もどる'),
  S('empty'),
  /* 10 */ S('twice', 0, 'ダイス2個'),
  S('empty'),
  S('medal', 8),
  S('empty'),
  S('jpup', 6),
  S('warp', 3, '3すすむ'),
  S('empty'),
  S('dice', 0, 'ダイス勝負'),
  S('empty'),
  S('medal', 14),
  /* 20 */ S('empty'),
  S('boost', 0, '配当2倍'),
  S('empty'),
  S('back', 3, '3もどる'),
  S('medal', 10),
  S('empty'),
  S('jpup', 8),
  S('empty'),
  S('pick', 0, '出目えらび'),
  S('empty'),
  /* 30 */ S('dice', 0, 'ダイス勝負'),
  S('medal', 12),
  S('empty'),
  S('warp', 4, '4すすむ'),
  S('empty'),
  S('twice', 0, 'ダイス2個'),
  S('empty'),
  S('jpup', 10),
  S('medal', 16),
  S('back', 3, '3もどる'),
  /* 40 */ S('empty'),
  S('boost', 0, '配当2倍'),
  S('dice', 0, 'ダイス勝負'),
  S('empty'),
  S('medal', 20),
  S('pick', 0, '出目えらび'),
  S('empty'),
  S('jpup', 12),
  S('medal', 24),
  S('empty'),
  /* 50 */ S('goal', 0, 'GOAL'),
];
export const BOARD: readonly Square[] = C;
export const BOARD_SIZE = BOARD.length; // 51 cells: 0..49 plus the goal
export const GOAL = BOARD_SIZE - 1;

/** What landing on a square did. `medals` is the physical payout (may be 0). */
export interface Landing {
  square: Square;
  index: number;
  medals: number;
  /** medals added to the progressive pool */
  jpAdded: number;
  /** squares a warp/back moved the piece AFTER the throw */
  shifted: number;
  /** the run finished — the caller runs the bowl draw and resets */
  goal: boolean;
  /** a dice minigame should be played out before the turn ends */
  diceGame: boolean;
  headline: string;
  detail: string;
}

/** Modifiers armed for the NEXT turn. */
export interface Pending {
  twice: boolean;
  pick: boolean;
  boost: boolean;
}

/**
 * The course state: how far along the run the piece is, and which modifiers are
 * armed for the next throw. Persisted so a session resumes mid-run.
 */
export class Board {
  pos = 0;
  /** completed runs — shown as a lap counter, and it never resets */
  runs = 0;
  pending: Pending = { twice: false, pick: false, boost: false };

  constructor(private save: SaveManager, private rng: Rng = defaultRng) {
    const b = save.get().board;
    this.pos = Math.max(0, Math.min(GOAL, b.pos | 0));
    this.runs = b.runs ?? 0;
    this.pending = {
      twice: !!b.pending?.twice,
      pick: !!b.pending?.pick,
      boost: !!b.pending?.boost,
    };
    this.emit();
  }

  /** Squares still to travel. */
  get toGoal(): number {
    return GOAL - this.pos;
  }

  /** How many dice this turn throws. */
  get diceCount(): number {
    return this.pending.twice ? 2 : 1;
  }

  /** Advance and resolve. `steps` is the total pipped on the dice. */
  advance(steps: number): Landing {
    // consumed by the throw that just happened
    this.pending.twice = false;
    this.pending.pick = false;

    const landing = this.step(steps);
    // warp / back move once more and resolve where they land; only once, so a
    // chain can never run away with the whole course
    if ((landing.square.kind === 'warp' || landing.square.kind === 'back') && !landing.goal) {
      const dir = landing.square.kind === 'warp' ? 1 : -1;
      const after = this.step(dir * landing.square.value);
      after.shifted = dir * landing.square.value;
      after.headline = landing.square.label + ' → ' + after.headline;
      this.persist();
      this.emit();
      return after;
    }
    this.persist();
    this.emit();
    return landing;
  }

  private step(steps: number): Landing {
    this.pos = Math.max(0, Math.min(GOAL, this.pos + steps));
    const square = BOARD[this.pos];
    const landing: Landing = {
      square,
      index: this.pos,
      medals: 0,
      jpAdded: 0,
      shifted: 0,
      goal: this.pos === GOAL,
      diceGame: false,
      headline: square.label,
      detail: '',
    };
    this.resolve(square, landing);
    return landing;
  }

  private resolve(square: Square, l: Landing): void {
    switch (square.kind) {
      case 'empty':
        l.headline = '——';
        l.detail = 'なにもなし';
        break;
      case 'medal':
        l.medals = square.value;
        l.headline = `+${l.medals} メダル`;
        break;
      case 'jpup':
        l.jpAdded = square.value;
        l.headline = `ジャックポット +${l.jpAdded}`;
        l.detail = 'プールが増えた';
        break;
      case 'dice':
        l.diceGame = true;
        l.headline = 'ダイス勝負!';
        l.detail = '出目 × 配当';
        break;
      case 'twice':
        this.pending.twice = true;
        l.headline = '次はダイス2個!';
        l.detail = '出目が合計される';
        break;
      case 'pick':
        this.pending.pick = true;
        l.headline = '出目えらび!';
        l.detail = '次は好きな目を選べる';
        break;
      case 'boost':
        this.pending.boost = true;
        l.headline = '配当2倍!';
        l.detail = '次の獲得が倍に';
        break;
      case 'warp':
      case 'back':
        l.headline = square.label;
        break;
      case 'goal':
        l.headline = 'GOAL!!';
        l.detail = 'JPCチャレンジへ';
        break;
    }

    if (this.pending.boost && l.medals > 0) {
      l.medals *= 2;
      l.headline += ' ×2!';
      this.pending.boost = false;
    }
  }

  /** Payout for a dice-minigame square, given the face thrown. */
  diceGamePayout(face: number): number {
    // steep on purpose: a 6 should feel like it was worth watching
    const table = [0, 4, 6, 9, 14, 20, 32];
    let m = scale(table[Math.max(1, Math.min(6, face))]);
    if (this.pending.boost) {
      m *= 2;
      this.pending.boost = false;
    }
    return m;
  }

  /** Start the next run. */
  resetRun(): void {
    this.pos = 0;
    this.runs++;
    this.pending = { twice: false, pick: false, boost: false };
    this.persist();
    this.emit();
  }

  private persist(): void {
    const d = this.save.get();
    d.board = { pos: this.pos, runs: this.runs, pending: { ...this.pending } };
    this.save.save();
  }

  private emit(): void {
    bus.emit('board:changed', {
      pos: this.pos,
      toGoal: this.toGoal,
      runs: this.runs,
      twice: this.pending.twice,
      pick: this.pending.pick,
      boost: this.pending.boost,
    });
  }

  /** Debug/testing: drop the piece on a square. */
  debugSetPos(i: number): void {
    this.pos = Math.max(0, Math.min(GOAL, i));
    this.persist();
    this.emit();
  }

  /** Debug/testing: stand one square short of the goal. */
  debugGoalNear(): void {
    this.debugSetPos(GOAL - 1);
  }
}
