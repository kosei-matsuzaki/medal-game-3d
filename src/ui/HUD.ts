import './hud.css';
import { bus } from '../core/EventBus';
import { GameStore } from '../state/GameStore';
import { LAYOUT } from '../pusher/layout';

const HINT_SEEN_KEY = 'gold-rush-hint-seen';

/**
 * DOM overlay HUD: credits, jackpot pool, medals-in-play, toast messages, and a
 * big result/jackpot overlay. Kept in DOM (not 3D text) for crisp UI and zero
 * render cost.
 *
 * Design rules (docs/design-review.md §C): the three stat panels share ONE type
 * scale (34px primary / 20px secondary), flat single colours rather than
 * gradient text, and colour carries meaning — gold = the player's winnings,
 * cyan = system state, magenta = jackpot. Nothing animates unless it changed.
 */
export class HUD {
  private root: HTMLElement;
  private creditsEl!: HTMLElement;
  private medalsEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private overlayTitle!: HTMLElement;
  private overlaySub!: HTMLElement;
  private hintEl!: HTMLElement;
  private toastTimer = 0;
  private creditDisplay = 0;
  private jackpotDisplay = 0;
  private jackpotSeen = 0;
  private overlayHideTimer: number | null = null;
  private hintTimer: number | null = null;
  private hintDismissed = false;
  // progression elements
  private levelEl!: HTMLElement;
  private rankEl!: HTMLElement;
  private expFillEl!: HTMLElement;
  private medalsMaxEl!: HTMLElement;
  private medalFillEl!: HTMLElement;
  private medalMax = LAYOUT.maxMedals;

  constructor(private store: GameStore) {
    this.root = document.getElementById('ui-root')!;
    this.build();
    this.creditDisplay = store.credits;
    this.jackpotDisplay = store.jackpotPool;
    this.jackpotSeen = store.jackpotPool;
    this.render();

    bus.on('credits:changed', () => this.render());
    // Pulse the jackpot number ONCE when the pool actually grows. A permanent
    // idle animation spends the player's attention on information that has not
    // changed — which is exactly when it should be spending none.
    bus.on('jackpot:changed', ({ pool }) => {
      this.jackpotSeen = pool;
      this.render();
    });
    // NOTE: transient toast 吹き出し are intentionally OFF — per user, no toast
    // messages in any scene. Gameplay 演出 lives on the monitor + big win overlays.

    bus.on('exp:changed', ({ level, exp, need, rank }) => this.setLevel(level, exp, need, rank));

    // the hint has done its job once the player has actually inserted a medal
    bus.on('input:drop', () => this.dismissHint());
  }

  private build(): void {
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="panel credits">
          <div class="stat-label">CREDITS</div>
          <div class="stat-value" id="hud-credits">0</div>
          <div class="level-row">
            <span class="rank" id="hud-rank">ビギナー</span>
            <span class="level" id="hud-level">Lv.1</span>
          </div>
          <div class="exp-bar"><span id="hud-exp"></span></div>
        </div>
      </div>
      <div class="toast" id="hud-toast"></div>
      <div class="hint" id="hud-hint">クリック / スペースでメダル投入 ・ ホールドで連続投入</div>
      <div class="hud-bottom">
        <div class="panel medals-inline hud-right">
          <div class="stat-label">MEDALS</div>
          <div class="stat-value medals-value"><span id="hud-medals">0</span><span class="medals-max" id="hud-medals-max">/ 300</span></div>
          <div class="medal-bar"><span id="hud-medal-fill"></span></div>
        </div>
        <button class="btn primary" id="btn-drop">メダル投入</button>
        <button class="btn" id="btn-camera">視点切替</button>
        <button class="btn-icon" id="btn-help" title="操作説明" aria-label="操作説明">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9.1 9.2a2.9 2.9 0 1 1 3.6 2.8c-.9.3-1.4 1-1.4 1.9v.6" />
            <circle cx="11.3" cy="17.9" r="1.05" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button class="btn-icon" id="btn-mute" title="音量" aria-label="ミュート">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9.4h3.3L11.6 5.8v12.4L7.3 14.6H4z" />
            <path class="ic-wave" d="M15 9.4a3.7 3.7 0 0 1 0 5.2M17.7 6.9a7.2 7.2 0 0 1 0 10.2" />
            <path class="ic-cross" d="M15.2 9.6l5.2 4.8M20.4 9.6l-5.2 4.8" />
          </svg>
        </button>
      </div>
      <div class="overlay" id="hud-overlay">
        <div class="overlay-title" id="overlay-title"></div>
        <div class="overlay-sub" id="overlay-sub"></div>
      </div>
    `;
    this.creditsEl = document.getElementById('hud-credits')!;
    this.medalsEl = document.getElementById('hud-medals')!;
    this.toastEl = document.getElementById('hud-toast')!;
    this.overlayEl = document.getElementById('hud-overlay')!;
    this.overlayTitle = document.getElementById('overlay-title')!;
    this.overlaySub = document.getElementById('overlay-sub')!;
    this.hintEl = document.getElementById('hud-hint')!;
    this.levelEl = document.getElementById('hud-level')!;
    this.rankEl = document.getElementById('hud-rank')!;
    this.expFillEl = document.getElementById('hud-exp')!;
    this.medalsMaxEl = document.getElementById('hud-medals-max')!;
    this.medalFillEl = document.getElementById('hud-medal-fill')!;
    this.medalsMaxEl.textContent = `/ ${this.medalMax}`;

    // returning players already know the controls — never show it unasked again
    if (this.readHintSeen()) {
      this.hintDismissed = true;
    } else {
      this.hintEl.classList.add('show');
    }

    document.getElementById('btn-drop')!.addEventListener('click', () =>
      bus.emit('input:drop', { x: (Math.random() - 0.5) * 3 })
    );
    document.getElementById('btn-help')!.addEventListener('click', () => this.toggleHint());
  }

  onCameraToggle(fn: () => void): void {
    document.getElementById('btn-camera')!.addEventListener('click', fn);
  }

  onMuteToggle(fn: () => boolean): void {
    const btn = document.getElementById('btn-mute')!;
    btn.addEventListener('click', () => {
      const muted = fn();
      btn.classList.toggle('muted', muted);
      btn.setAttribute('aria-label', muted ? 'ミュート解除' : 'ミュート');
    });
  }

  // --- controls hint --------------------------------------------------------

  /** Fade the hint out 3s after the first insert, then leave it to the ? button. */
  private dismissHint(): void {
    if (this.hintDismissed) return;
    this.hintDismissed = true;
    this.writeHintSeen();
    this.clearHintTimer();
    this.hintTimer = window.setTimeout(() => {
      this.hintEl.classList.remove('show');
      this.hintTimer = null;
    }, 3000);
  }

  /** The `?` button: bring the hint back (and let it go away again). */
  private toggleHint(): void {
    this.clearHintTimer();
    const showing = this.hintEl.classList.toggle('show');
    if (showing) {
      this.hintTimer = window.setTimeout(() => {
        this.hintEl.classList.remove('show');
        this.hintTimer = null;
      }, 6000);
    }
  }

  private clearHintTimer(): void {
    if (this.hintTimer !== null) {
      window.clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
  }

  private readHintSeen(): boolean {
    try {
      return localStorage.getItem(HINT_SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  private writeHintSeen(): void {
    try {
      localStorage.setItem(HINT_SEEN_KEY, '1');
    } catch {
      /* private mode — the hint simply reappears next session */
    }
  }

  setMedalCount(n: number): void {
    this.medalsEl.textContent = `${n}`;
    const pct = Math.max(0, Math.min(1, this.medalMax > 0 ? n / this.medalMax : 0));
    this.medalFillEl.style.width = `${(pct * 100).toFixed(1)}%`;
    // the bar reads as system state (cyan) and only turns gold at the field cap
    this.medalFillEl.classList.toggle('full', pct >= 0.9);
  }

  setLevel(level: number, exp: number, need: number, rank: string): void {
    this.levelEl.textContent = `Lv.${level}`;
    this.rankEl.textContent = rank;
    const pct = Math.max(0, Math.min(1, need > 0 ? exp / need : 0));
    this.expFillEl.style.width = `${(pct * 100).toFixed(1)}%`;
  }

  toast(text: string, duration = 1.6): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = duration;
  }

  /**
   * Big centre callout. `light` draws it WITHOUT the screen dim and without
   * swallowing pointer events — used for the slot reach, which fires often and
   * must never block a medal insert.
   */
  showOverlay(title: string, sub = '', light = false): void {
    this.clearOverlayTimer();
    this.overlayTitle.textContent = title;
    this.overlaySub.textContent = sub;
    this.overlayEl.classList.toggle('light', light);
    this.overlayEl.classList.add('show');
  }

  /** Hide after `sec`, superseding any hide already queued. */
  hideOverlayAfter(sec: number): void {
    this.clearOverlayTimer();
    this.overlayHideTimer = window.setTimeout(() => {
      this.overlayHideTimer = null;
      this.hideOverlay();
    }, sec * 1000);
  }

  setOverlaySub(text: string): void {
    this.overlaySub.textContent = text;
  }

  setOverlayTitle(text: string): void {
    this.overlayTitle.textContent = text;
  }

  hideOverlay(): void {
    this.clearOverlayTimer();
    this.overlayEl.classList.remove('show');
  }

  private clearOverlayTimer(): void {
    if (this.overlayHideTimer !== null) {
      window.clearTimeout(this.overlayHideTimer);
      this.overlayHideTimer = null;
    }
  }

  /** Smoothly animate the big numbers; tick toast timer. */
  update(dt: number): void {
    // ease counters toward targets
    const ct = this.store.credits;
    const jt = this.store.jackpotPool;
    this.creditDisplay += (ct - this.creditDisplay) * Math.min(1, dt * 8);
    this.jackpotDisplay += (jt - this.jackpotDisplay) * Math.min(1, dt * 8);
    if (Math.abs(ct - this.creditDisplay) < 0.5) this.creditDisplay = ct;
    if (Math.abs(jt - this.jackpotDisplay) < 0.5) this.jackpotDisplay = jt;
    this.creditsEl.textContent = Math.round(this.creditDisplay).toLocaleString();
    // the jackpot lives on the cabinet monitor now — see Sugoroku.drawHeader
    bus.emit('jackpot:display', { amount: Math.round(this.jackpotDisplay) });

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  private render(): void {
    // immediate values are eased in update(); nothing else needed here
  }
}
