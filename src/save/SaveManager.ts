export interface SaveData {
  version: number;
  credits: number;
  jackpotPool: number;
  totalWon: number;
  bestWin: number;
  // Player progression: level + experience toward the next level.
  level: number;
  exp: number;
  // Disc (円盤) JP challenge persistent state: which of the 6 holes are filled.
  // The JP-Chance hole is never marked filled; it stays open until it is hit.
  disc: { filled: boolean[] };
  settings: {
    quality: 'high' | 'medium' | 'low' | 'auto';
    muted: boolean;
    volume: number;
  };
}

const KEY = 'gold-rush-save';
const CURRENT_VERSION = 3;
export const DISC_HOLES = 6;

const DEFAULT: SaveData = {
  version: CURRENT_VERSION,
  credits: 200,
  jackpotPool: 500,
  totalWon: 0,
  bestWin: 0,
  level: 1,
  exp: 0,
  disc: { filled: new Array(DISC_HOLES).fill(false) },
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
      disc: { filled: this.normalizeDisc(d.disc?.filled) },
      settings: { ...DEFAULT.settings, ...(d.settings ?? {}) },
      version: CURRENT_VERSION,
    };
    return merged;
  }

  /** Coerce a persisted disc.filled array to exactly DISC_HOLES booleans. */
  private normalizeDisc(filled?: boolean[]): boolean[] {
    const out = new Array(DISC_HOLES).fill(false);
    if (Array.isArray(filled)) {
      for (let i = 0; i < DISC_HOLES; i++) out[i] = !!filled[i];
    }
    return out;
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
