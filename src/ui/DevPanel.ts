import { bus } from '../core/EventBus';
import { LAYOUT } from '../pusher/layout';
import { GameStateMachine } from '../state/GameStateMachine';
import { GameStore } from '../state/GameStore';
import { BallManager } from '../pusher/BallManager';
import { MedalSpawner } from '../pusher/MedalSpawner';
import { MedalPool } from '../pusher/MedalPool';

/** Systems the developer panel pokes at. */
export interface DevPanelDeps {
  fsm: GameStateMachine;
  store: GameStore;
  balls: BallManager;
  spawner: MedalSpawner;
  pool: MedalPool;
}

/**
 * On-screen DEVELOPER MODE panel — buttons to freely trigger the disc / JP
 * challenges and tweak game state, without typing into the `window.__medal`
 * console. Hidden by default; toggle with the 🛠 tab or the backtick (`) / F2 key.
 * Always available so the developer can summon it at any time.
 */
export class DevPanel {
  private panel!: HTMLElement;
  private stateEl!: HTMLElement;
  private chuckerBtn!: HTMLElement;
  private open = false;

  constructor(private deps: DevPanelDeps) {
    this.build();
    this.wire();
    // open immediately when launched with ?dev or ?debug
    if (/[?&](dev|debug)\b/.test(location.search)) this.toggle(true);
  }

  private build(): void {
    const root = document.getElementById('ui-root') ?? document.body;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <button id="dev-toggle" class="dev-toggle" title="開発者モード (\` / F2)">🛠</button>
      <div id="dev-panel" class="dev-panel hidden">
        <div class="dev-head">
          <span>🛠 開発者モード</span>
          <span class="dev-state" id="dev-state">idle</span>
          <button class="dev-x" id="dev-close">✕</button>
        </div>
        <div class="dev-sec">ミニゲーム</div>
        <div class="dev-grid">
          <button data-act="disc">ディスクチャレンジ</button>
          <button data-act="jp">JP チャレンジ</button>
          <button data-act="slot">スロット</button>
          <button data-act="idle">アイドルに戻す</button>
        </div>
        <div class="dev-sec">ディスク</div>
        <div class="dev-grid">
          <button data-act="discJpSet">JP 確定セット</button>
          <button data-act="discReset">ディスクリセット</button>
          <button data-act="ball">ボール投入</button>
          <button data-act="balls4">ボール×4 (JP発動)</button>
        </div>
        <div class="dev-sec">リソース / その他</div>
        <div class="dev-grid">
          <button data-act="credits">クレジット +1000</button>
          <button data-act="pool">JP プール +5000</button>
          <button data-act="medals">メダル +20</button>
          <button data-act="clear">メダル全消去</button>
          <button data-act="chucker" id="dev-chucker">自動投入: ON</button>
        </div>
      </div>
    `;
    root.appendChild(wrap);
    this.panel = document.getElementById('dev-panel')!;
    this.stateEl = document.getElementById('dev-state')!;
    this.chuckerBtn = document.getElementById('dev-chucker')!;
  }

  private wire(): void {
    document.getElementById('dev-toggle')!.addEventListener('click', () => this.toggle());
    document.getElementById('dev-close')!.addEventListener('click', () => this.toggle(false));
    this.panel.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) =>
      b.addEventListener('click', () => this.act(b.dataset.act!))
    );
    // hotkey: backtick or F2
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' || e.code === 'F2') {
        e.preventDefault();
        this.toggle();
      }
    });
    bus.on('state:changed', ({ to }) => (this.stateEl.textContent = to));
  }

  private toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.panel.classList.toggle('hidden', !this.open);
  }

  /** Start a minigame, aborting any running one first so dev triggers always work. */
  private startGame(kind: 'disc' | 'jackpot' | 'slot'): void {
    this.deps.fsm.devReset();
    this.deps.fsm.forceEnter(kind);
  }

  private act(a: string): void {
    const { fsm, store, balls, spawner, pool } = this.deps;
    switch (a) {
      case 'disc': this.startGame('disc'); break;
      case 'jp': this.startGame('jackpot'); break;
      case 'slot': this.startGame('slot'); break;
      case 'idle': fsm.devReset(); break;
      case 'discJpSet': {
        const { count, jpIndex } = LAYOUT.disc;
        for (let i = 0; i < count; i++) if (i !== jpIndex) store.fillDiscHole(i);
        this.msg('ディスク: JP 以外を全て埋めた（次はJP確定）');
        break;
      }
      case 'discReset': store.resetDisc(); this.msg('ディスクをリセット'); break;
      case 'ball': balls.spawn(); break;
      case 'balls4': for (let i = 0; i < LAYOUT.ballsPerDisc; i++) bus.emit('ball:dropped', {}); break;
      case 'credits': store.addCredits(1000); this.msg('クレジット +1000'); break;
      case 'pool': store.addToJackpot(5000); this.msg('JP プール +5000'); break;
      case 'medals': spawner.dispense(20, false); break;
      case 'clear': pool.drainAll(); this.msg('メダルを全消去'); break;
      case 'chucker': {
        fsm.ignoreChuckers = !fsm.ignoreChuckers;
        this.chuckerBtn.textContent = `自動投入: ${fsm.ignoreChuckers ? 'OFF' : 'ON'}`;
        this.chuckerBtn.classList.toggle('off', fsm.ignoreChuckers);
        break;
      }
    }
  }

  private msg(text: string): void {
    bus.emit('ui:message', { text, duration: 1.2 });
  }
}
