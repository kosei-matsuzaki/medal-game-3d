import './hud.css';
import { bus } from '../core/EventBus';
import { GameStore } from '../state/GameStore';
import { LAYOUT } from '../pusher/layout';

/**
 * DOM overlay HUD: credits, jackpot pool, medals-in-play, toast messages, and a
 * big result/jackpot overlay. Kept in DOM (not 3D text) for crisp UI and zero
 * render cost.
 */
export class HUD {
  private root: HTMLElement;
  private creditsEl!: HTMLElement;
  private jackpotEl!: HTMLElement;
  private medalsEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private overlayTitle!: HTMLElement;
  private overlaySub!: HTMLElement;
  private toastTimer = 0;
  private creditDisplay = 0;
  private jackpotDisplay = 0;
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
    this.render();

    bus.on('credits:changed', () => this.render());
    bus.on('jackpot:changed', () => this.render());
    // NOTE: transient toast 吹き出し are intentionally OFF — per user, no toast
    // messages in any scene. Gameplay 演出 lives on the monitor + big win overlays.

    bus.on('exp:changed', ({ level, exp, need, rank }) => this.setLevel(level, exp, need, rank));
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
        <div class="panel jackpot">
          <div class="stat-label">★ JACKPOT ★</div>
          <div class="stat-value" id="hud-jackpot">0</div>
        </div>
        <div class="panel hud-right">
          <div class="stat-label">MEDALS</div>
          <div class="stat-value medals-value"><span id="hud-medals">0</span><span class="medals-max" id="hud-medals-max">/ 300</span></div>
          <div class="medal-bar"><span id="hud-medal-fill"></span></div>
        </div>
      </div>
      <div class="toast" id="hud-toast"></div>
      <div class="hint">クリック / スペースでメダル投入 ・ ホールドで連続投入</div>
      <div class="hud-bottom">
        <button class="btn primary" id="btn-drop">メダル投入</button>
        <button class="btn" id="btn-camera">視点切替</button>
        <button class="btn" id="btn-mute">🔊</button>
      </div>
      <div class="overlay" id="hud-overlay">
        <div class="overlay-title" id="overlay-title"></div>
        <div class="overlay-sub" id="overlay-sub"></div>
      </div>
    `;
    this.creditsEl = document.getElementById('hud-credits')!;
    this.jackpotEl = document.getElementById('hud-jackpot')!;
    this.medalsEl = document.getElementById('hud-medals')!;
    this.toastEl = document.getElementById('hud-toast')!;
    this.overlayEl = document.getElementById('hud-overlay')!;
    this.overlayTitle = document.getElementById('overlay-title')!;
    this.overlaySub = document.getElementById('overlay-sub')!;
    this.levelEl = document.getElementById('hud-level')!;
    this.rankEl = document.getElementById('hud-rank')!;
    this.expFillEl = document.getElementById('hud-exp')!;
    this.medalsMaxEl = document.getElementById('hud-medals-max')!;
    this.medalFillEl = document.getElementById('hud-medal-fill')!;
    this.medalsMaxEl.textContent = `/ ${this.medalMax}`;

    document.getElementById('btn-drop')!.addEventListener('click', () =>
      bus.emit('input:drop', { x: (Math.random() - 0.5) * 3 })
    );
  }

  onCameraToggle(fn: () => void): void {
    document.getElementById('btn-camera')!.addEventListener('click', fn);
  }

  onMuteToggle(fn: () => boolean): void {
    const btn = document.getElementById('btn-mute')!;
    btn.addEventListener('click', () => {
      const muted = fn();
      btn.textContent = muted ? '🔇' : '🔊';
    });
  }

  setMedalCount(n: number): void {
    this.medalsEl.textContent = `${n}`;
    const pct = Math.max(0, Math.min(1, this.medalMax > 0 ? n / this.medalMax : 0));
    this.medalFillEl.style.width = `${(pct * 100).toFixed(1)}%`;
    // warn (turn the bar amber→red) as the field approaches its insert cap
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

  showOverlay(title: string, sub = ''): void {
    this.overlayTitle.textContent = title;
    this.overlaySub.textContent = sub;
    this.overlayEl.classList.add('show');
  }

  setOverlaySub(text: string): void {
    this.overlaySub.textContent = text;
  }

  setOverlayTitle(text: string): void {
    this.overlayTitle.textContent = text;
  }

  hideOverlay(): void {
    this.overlayEl.classList.remove('show');
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
    this.jackpotEl.textContent = Math.round(this.jackpotDisplay).toLocaleString();

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  private render(): void {
    // immediate values are eased in update(); nothing else needed here
  }
}
