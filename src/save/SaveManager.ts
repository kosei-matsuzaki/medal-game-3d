export interface SaveData {
  version: number;
  credits: number;
  jackpotPool: number;
  totalWon: number;
  bestWin: number;
  // Player progression: level + experience toward the next level.
  level: number;
  exp: number;
  // すごろく board journey: piece position, current 目的地, owned 物件駅,
  // remaining 貧乏神 
  // turns and the held card. Persisted so a session resumes mid-leg.
  board: { pos: number; runs: number; pending: { twice: boolean; pick: boolean; boost: boolean } };
  settings: {
    quality: 'high' | 'medium' | 'low' | 'auto';
    muted: boolean;
    volume: number;
  };
}

const KEY = 'gold-rush-save';
const CURRENT_VERSION = 6;

const DEFAULT: SaveData = {
  version: CURRENT_VERSION,
  credits: 200,
  jackpotPool: 500,
  totalWon: 0,
  bestWin: 0,
  level: 1,
  exp: 0,
  board: { pos: 0, runs: 0, pending: { twice: false, pick: false, boost: false } },
  settings: { quality: 'auto', muted: false, volume: 0.8 },
};

/** Versioned localStorage persistence with debounced writes & migration. */
export class SaveManager {
  private data: SaveData;
  private timer: number | null = null;

  constructor() {
    this.data = this.load();
  }

  get(): SaveData {
    return this.data;
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT);
      const parsed = JSON.parse(raw) as SaveData;
      return this.migrate(parsed);
    } catch {
      return structuredClone(DEFAULT);
    }
  }

  private migrate(d: Partial<SaveData>): SaveData {
    // merge onto defaults so missing fields are filled; bump version as needed
    const merged: SaveData = {
      ...structuredClone(DEFAULT),
      ...d,
      level: Math.max(1, d.level ?? 1),
      exp: Math.max(0, d.exp ?? 0),
      board: { ...DEFAULT.board, ...(d.board ?? {}) },
      settings: { ...DEFAULT.settings, ...(d.settings ?? {}) },
      version: CURRENT_VERSION,
    };
    return merged;
  }

  /** Debounced save. */
  save(patch?: Partial<SaveData>): void {
    if (patch) Object.assign(this.data, patch);
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      try {
        localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch {
        /* storage full / unavailable — ignore */
      }
    }, 400);
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  reset(): void {
    this.data = structuredClone(DEFAULT);
    this.flush();
  }
}
