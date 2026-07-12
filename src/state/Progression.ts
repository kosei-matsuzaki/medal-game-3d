import { bus } from '../core/EventBus';
import { GameStore } from './GameStore';

interface Rank {
  min: number; // minimum level for this rank
  name: string;
}

// Rank ladder — the title shown next to the level climbs with it.
const RANKS: Rank[] = [
  { min: 1, name: 'ビギナー' },
  { min: 5, name: 'ブロンズ' },
  { min: 10, name: 'シルバー' },
  { min: 18, name: 'ゴールド' },
  { min: 30, name: 'プラチナ' },
  { min: 45, name: 'ダイヤ' },
  { min: 65, name: 'マスター' },
  { min: 90, name: 'レジェンド' },
];

/** EXP needed to clear a given level (grows gently so leveling never stalls). */
export function expForLevel(level: number): number {
  return Math.round(120 + (level - 1) * 70);
}

export function rankFor(level: number): string {
  let name = RANKS[0].name;
  for (const r of RANKS) if (level >= r.min) name = r.name;
  return name;
}

/**
 * Player level / rank progression. EXP is earned from every credit WON (payouts,
 * slot/roulette wins, jackpots). Clearing a level grants a credit bonus and a
 * celebratory event. Persisted through the GameStore.
 */
export class Progression {
  private granting = false;

  constructor(private store: GameStore) {
    // every positive credit gain feeds EXP — but ignore the level-up bonus
    // itself so the reward can't recursively pump EXP.
    bus.on('credits:changed', ({ delta }) => {
      if (delta > 0 && !this.granting) this.gain(delta);
    });
    // announce the starting state so the HUD can paint immediately
    this.emitState();
  }

  private gain(amount: number): void {
    let level = this.store.level;
    let exp = this.store.exp + amount;
    let leveled = false;
    while (exp >= expForLevel(level)) {
      exp -= expForLevel(level);
      level++;
      leveled = true;
    }
    this.store.setProgress(level, exp);
    if (leveled) this.onLevelUp(level);
    this.emitState();
  }

  private onLevelUp(level: number): void {
    const rank = rankFor(level);
    const bonus = 50 + level * 25; // scaling level-up credit reward
    this.granting = true;
    this.store.addCredits(bonus);
    this.granting = false;
    bus.emit('level:up', { level, rank, bonus });
    bus.emit('sfx', { name: 'bigwin' });
  }

  private emitState(): void {
    const level = this.store.level;
    bus.emit('exp:changed', {
      level,
      exp: this.store.exp,
      need: expForLevel(level),
      rank: rankFor(level),
    });
  }
}
