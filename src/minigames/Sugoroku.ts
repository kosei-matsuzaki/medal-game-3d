import * as THREE from 'three';
import { MiniGame, MiniGameContext, MiniGameResult } from './MiniGame';
import { Board, BOARD, BOARD_SIZE, GOAL, Landing } from '../state/Board';
import { DiceTray } from './DiceTray';
import { create2D } from '../render/canvasText';
import { anchorToMonitor } from '../ui/monitorAnchor';
import { CameraRig } from '../camera/CameraRig';
import { bus } from '../core/EventBus';
import {
  INK, KIND_STYLE, FONT_DISPLAY, FONT_UI, Course, WINDOW,
  roundRect, drawTile, drawIcon, drawCourse, drawPiece, drawDieFace,
  drawProgress, drawStock, windowPoint,
} from './boardArt';

const CW = 1152;
const CH = 640;

/** The visible window: 12 squares as two serpentine rows of six. */
// Pulled in from the canvas edges to leave room for the S-bend: the return leg
// swings 0.62 of a column pitch OUTSIDE the row on both sides, so a course that
// filled the full width would run the connector off the monitor.
const COURSE: Course = { x: 158, y: 232, cols: 6, pitchX: 166, pitchY: 180 };
const TILE = 126;

// --- timing -----------------------------------------------------------------
const HOP_TIME = 0.24; // per square
const EFFECT_TIME = 1.9;
const GOAL_TIME = 2.4;
const DICE_SHOW = 1.0; // pause on the settled die before the token starts

/**
 * すごろく — the board run, played on the back-top monitor with a REAL die.
 *
 * One mini cube dropped off the front buys one turn: the camera swings to the
 * dice tray, a physical die is thrown, and whatever face lands up is the number
 * of squares the token walks. Nothing is drawn in advance — the die decides, the
 * same way the bowl decides the jackpot.
 *
 * The run ends at the GOAL, which hands off to the 抽選ボウル and starts a new
 * run. All board *state* lives in Board; this class owns presentation, the
 * turn's timeline, and the dice hand-off.
 */
export class Sugoroku implements MiniGame {
  readonly kind = 'sugoroku';
  readonly group = new THREE.Group();

  private ctx!: MiniGameContext;
  private onDone!: (r: MiniGameResult) => void;

  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private dirty = true;

  private phase: 'idle' | 'throw' | 'shown' | 'move' | 'effect' | 'minigame' = 'idle';
  private timer = 0;
  private faces: number[] = [];
  private total = 0;
  private stepsLeft = 0;

  // continuous token position — animating this is what makes the walk read as
  // one square at a time rather than a jump
  private piecePos = 0;
  private hopFrom = 0;
  private hopTo = 0;
  private hopT = 1;
  private hopDir = 1;

  private landing: Landing | null = null;
  private gameFace = 0;
  private gamePay = 0;
  private pickBtns: HTMLElement | null = null;
  /** first board index shown in the window; recomputed only between turns */
  private winStart = 0;
  private pending = 0;
  private jackpot = 0;

  constructor(scene: THREE.Scene, private board: Board, private dice: DiceTray) {
    anchorToMonitor(this.group);
    this.group.translateY(0.12);
    [this.canvas, this.g] = create2D(CW, CH);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;

    this.group.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(4.7, 2.6),
        new THREE.MeshBasicMaterial({ map: this.tex, transparent: true })
      )
    );

    this.piecePos = board.pos;
    scene.add(this.group);
    this.group.visible = true;

    bus.on('board:changed', () => {
      if (this.phase === 'idle') this.refresh();
    });
    bus.on('jackpot:display', ({ amount }) => {
      if (amount === this.jackpot) return;
      this.jackpot = amount;
      this.dirty = true;
    });
    bus.on('board:stock', ({ pending }) => {
      this.pending = pending;
      if (this.phase === 'idle') this.refresh();
      else this.dirty = true;
    });
    this.refresh();
  }

  start(ctx: MiniGameContext, onDone: (r: MiniGameResult) => void): void {
    this.ctx = ctx;
    this.onDone = onDone;
    this.piecePos = this.board.pos;
    this.hopFrom = this.hopTo = this.board.pos;
    this.hopT = 1;
    this.landing = null;
    this.faces = [];
    this.gamePay = 0;
    this.recomputeWindow();

    if (this.board.pending.pick) this.offerPick();
    else this.beginThrow();
  }

  // --- the throw ------------------------------------------------------------

  /** 出目えらび: the square earned the right to choose, so ask. */
  private offerPick(): void {
    this.phase = 'throw';
    this.timer = 0;
    this.dirty = true;
    this.ctx.camera.setPose(CameraRig.SLOT);

    const wrap = document.createElement('div');
    wrap.className = 'dice-pick show';
    wrap.innerHTML =
      '<div class="dice-pick-label">出目をえらぶ</div><div class="dice-pick-row"></div>';
    const row = wrap.querySelector('.dice-pick-row')!;
    for (let v = 1; v <= 6; v++) {
      const b = document.createElement('button');
      b.className = 'dice-pick-btn';
      b.textContent = String(v);
      b.addEventListener('click', () => {
        this.clearPick();
        this.faces = [v];
        this.total = v;
        this.showResultThenMove();
      });
      row.appendChild(b);
    }
    (document.getElementById('ui-root') ?? document.body).appendChild(wrap);
    this.pickBtns = wrap;
    // never stall on a player who walked away
    window.setTimeout(() => {
      if (this.pickBtns) {
        this.clearPick();
        this.beginThrow();
      }
    }, 8000);
  }

  private clearPick(): void {
    this.pickBtns?.remove();
    this.pickBtns = null;
    this.board.pending.pick = false;
  }

  /** Throw the physical die (or two), and watch the tray until it settles. */
  private beginThrow(): void {
    this.phase = 'throw';
    this.timer = 0;
    this.faces = [];
    this.dirty = true;
    this.ctx.camera.setPose(CameraRig.DICE);

    // Both dice go in together on a ダイス2個 turn. Throwing them one after the
    // other doubles the wait for a turn that is supposed to feel like a BONUS.
    this.dice.throwDice(this.board.diceCount, (v) => {
      this.faces = v;
      this.total = this.faces.reduce((a, b) => a + b, 0);
      this.showResultThenMove();
    });
  }

  /** Hold on the settled die for a beat, then walk. */
  private showResultThenMove(): void {
    this.phase = 'shown';
    this.timer = DICE_SHOW;
    this.dirty = true;
    bus.emit('fx:flash', { bloom: 0.5 });
    this.ctx.hud.showOverlay(
      this.faces.length > 1 ? this.faces.join(' + ') + ' = ' + this.total : String(this.total),
      this.faces.length > 1 ? 'ダイス2個' : '',
      true
    );
  }

  private beginMove(): void {
    this.ctx.camera.setPose(CameraRig.SLOT);
    this.stepsLeft = Math.min(this.total, this.board.toGoal);
    this.hopDir = 1;
    this.phase = 'move';
    this.timer = 0;
    this.dirty = true;

    const to = this.board.toGoal;
    if (to > 0 && this.total >= to) {
      bus.emit('board:near', { toGoal: to, big: true });
      bus.emit('sfx', { name: 'reach' });
      bus.emit('fx:flash', { bloom: 0.9 });
    }

    if (this.stepsLeft > 0) {
      this.stepsLeft--;
      this.hopFrom = this.board.pos;
      this.hopTo = this.hopFrom + 1;
      this.hopT = 0;
    }
  }

  // --- loop -----------------------------------------------------------------

  update(dt: number): void {
    this.dice.update(dt);

    switch (this.phase) {
      case 'shown':
        this.timer -= dt;
        if (this.timer <= 0) this.beginMove();
        break;
      case 'move':
        this.tickMove(dt);
        break;
      case 'minigame':
        this.timer -= dt;
        if (this.timer <= 0) this.finish();
        break;
      case 'effect':
        this.timer -= dt;
        if (this.timer <= 0) this.afterEffect();
        break;
      default:
        break;
    }
    if (this.dirty) {
      this.draw();
      this.dirty = false;
    }
  }

  private tickMove(dt: number): void {
    if (this.hopT < 1) {
      this.hopT = Math.min(1, this.hopT + dt / HOP_TIME);
      this.piecePos = this.hopFrom + (this.hopTo - this.hopFrom) * this.easeHop(this.hopT);
      this.dirty = true;
      if (this.hopT < 1) return;
    }
    if (this.stepsLeft > 0) {
      this.stepsLeft--;
      this.hopFrom = this.hopTo;
      this.hopTo = this.hopFrom + this.hopDir;
      this.hopT = 0;
      bus.emit('sfx', { name: 'coin' });
      return;
    }

    this.landing = this.board.advance(this.total);
    this.piecePos = this.landing.index;
    this.hopFrom = this.hopTo = this.landing.index;
    this.hopT = 1;
    this.phase = 'effect';
    this.timer = this.landing.goal
      ? GOAL_TIME
      : this.landing.shifted !== 0
        ? EFFECT_TIME + 0.7
        : EFFECT_TIME;
    this.dirty = true;
    this.reveal(this.landing);
  }

  private easeHop(t: number): number {
    return 1 - Math.pow(1 - t, 2.2);
  }

  private get hopLift(): number {
    return this.hopT >= 1 ? 0 : Math.sin(this.hopT * Math.PI) * 22;
  }

  /** A ダイス勝負 square throws once more, and the face IS the payout. */
  private afterEffect(): void {
    if (this.landing?.diceGame && this.gamePay === 0) {
      this.phase = 'throw';
      this.dirty = true;
      this.ctx.camera.setPose(CameraRig.DICE);
      this.dice.throwDie((v) => {
        this.gameFace = v;
        this.gamePay = this.board.diceGamePayout(v);
        this.phase = 'minigame';
        this.timer = 2.0;
        this.dirty = true;
        this.ctx.camera.setPose(CameraRig.SLOT);
        const big = v >= 5;
        bus.emit('sfx', { name: big ? 'bigwin' : 'win' });
        bus.emit('board:outcome', { kind: big ? 'bigwin' : 'win' });
        bus.emit('fx:flash', { bloom: big ? 1.3 : 0.7 });
        this.ctx.hud.showOverlay(`${v} → ${this.gamePay} メダル`, 'ダイス勝負', true);
      });
      return;
    }
    this.finish();
  }

  private reveal(l: Landing): void {
    const m = this.ctx;
    const mon = { x: 0, y: 3.75, z: -2.95 };
    if (l.goal) {
      m.particles.emit(mon.x, mon.y, mon.z + 1, 150, new THREE.Color(0xffe24a), 8);
      bus.emit('sfx', { name: 'jackpot' });
      bus.emit('board:outcome', { kind: 'bigwin' });
      bus.emit('fx:flash', { bloom: 1.7 });
      bus.emit('fx:shake', { intensity: 0.35, duration: 0.6 });
      m.hud.showOverlay('GOAL!!', 'JPCチャレンジへ！', true);
      return;
    }
    if (l.medals > 0) {
      const big = l.medals >= 16;
      m.particles.emit(mon.x, mon.y, mon.z + 1, big ? 90 : 46, new THREE.Color(big ? 0xffe24a : 0xffd060), big ? 8 : 6);
      bus.emit('sfx', { name: big ? 'bigwin' : 'win' });
      bus.emit('board:outcome', { kind: big ? 'bigwin' : 'win' });
      bus.emit('fx:flash', { bloom: big ? 1.2 : 0.6 });
      if (big) m.hud.showOverlay(l.headline, '', true);
      return;
    }
    if (l.jpAdded > 0) {
      bus.emit('sfx', { name: 'win' });
      bus.emit('board:outcome', { kind: 'win' });
      bus.emit('fx:flash', { bloom: 0.8 });
      m.hud.showOverlay('JP +' + l.jpAdded, 'ジャックポットが育った', true);
      return;
    }
    if (l.square.kind === 'twice' || l.square.kind === 'pick' || l.square.kind === 'boost') {
      bus.emit('sfx', { name: 'reach' });
      bus.emit('board:outcome', { kind: 'win' });
      bus.emit('fx:flash', { bloom: 0.7 });
      m.hud.showOverlay(l.headline, l.detail, true);
      return;
    }
    if (l.square.kind === 'back' || l.shifted < 0) {
      bus.emit('sfx', { name: 'nearmiss' });
      bus.emit('board:outcome', { kind: 'near' });
      return;
    }
    bus.emit('board:outcome', { kind: 'miss' });
  }

  private finish(): void {
    const l = this.landing;
    this.phase = 'idle';
    if (!l) {
      this.onDone({ payout: 0, label: '—' });
      return;
    }
    const goal = l.goal;
    if (goal) this.board.resetRun();
    this.onDone({
      payout: l.medals + this.gamePay,
      jpAdd: l.jpAdded,
      bonus: goal ? 'station' : undefined,
      feverAction: goal ? 'start' : 'none',
      label: goal ? 'GOAL' : l.headline,
    });
  }

  stop(): void {
    this.phase = 'idle';
    this.clearPick();
    this.dice.clear();
    this.refresh();
    if (this.ctx) this.ctx.hud.hideOverlayAfter(0.35);
  }

  // --- drawing --------------------------------------------------------------

  private draw(): void {
    const g = this.g;
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = INK.bg;
    g.fillRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(120, 180, 255, 0.03)';
    for (let y = 0; y < CH; y += 4) g.fillRect(0, y, CW, 2);
    g.strokeStyle = INK.line;
    g.lineWidth = 3;
    roundRect(g, 8, 8, CW - 16, CH - 16, 16);
    g.stroke();

    this.drawHeader();
    drawCourse(g, COURSE, Math.min(WINDOW, GOAL - this.winStart + 1));
    this.drawSquares();
    this.drawToken();
    this.drawReadout();
    drawProgress(g, 34, CH - 46, 470, this.board.pos, GOAL);
    drawStock(g, 34, CH - 90, this.pending);

    this.tex.needsUpdate = true;
  }

  private drawHeader(): void {
    const g = this.g;
    g.textBaseline = 'middle';
    g.textAlign = 'left';

    g.font = '600 19px ' + FONT_UI;
    g.fillStyle = INK.sub;
    g.fillText('GOLD MINE まで', 34, 30);
    g.font = '700 36px ' + FONT_DISPLAY;
    g.fillStyle = this.board.toGoal <= 5 ? INK.gold : INK.text;
    g.fillText('あと ' + this.board.toGoal, 34, 64);

    // JACKPOT — on the cabinet, where a real machine puts it, instead of pinned
    // over the 3D view. It is the number the whole run is aimed at, so it gets
    // the top-centre of the display.
    g.textAlign = 'center';
    g.font = '700 20px ' + FONT_DISPLAY;
    g.fillStyle = '#ff8ed6';
    g.fillText('J A C K P O T', CW / 2, 28);
    g.font = '700 54px ' + FONT_DISPLAY;
    g.fillStyle = INK.magenta;
    g.shadowColor = INK.magenta;
    g.shadowBlur = 24;
    g.fillText(this.jackpot.toLocaleString(), CW / 2, 70);
    g.shadowBlur = 0;
    g.textAlign = 'left';

    let x = CW - 34;
    const chip = (text: string, color: string) => {
      g.font = '700 19px ' + FONT_UI;
      const w = g.measureText(text).width + 24;
      roundRect(g, x - w, 22, w, 36, 9);
      g.fillStyle = 'rgba(11, 17, 34, 0.9)';
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = color;
      g.textAlign = 'center';
      g.fillText(text, x - w / 2, 40);
      g.textAlign = 'left';
      x -= w + 10;
    };
    if (this.board.pending.twice) chip('ダイス2個', KIND_STYLE.twice.color);
    if (this.board.pending.pick) chip('出目えらび', KIND_STYLE.pick.color);
    if (this.board.pending.boost) chip('配当2倍', KIND_STYLE.boost.color);
    chip('走破 ' + this.board.runs, INK.sub);
  }

  private drawSquares(): void {
    const g = this.g;
    const here = Math.round(this.piecePos);
    for (let k = 0; k < WINDOW; k++) {
      const i = this.winStart + k;
      if (i > GOAL) break;
      const p = windowPoint(COURSE, k);
      drawTile(g, BOARD[i], i, p.x, p.y, TILE, {
        here: i === here && this.hopT >= 1,
        passed: i < this.piecePos,
      });
    }
  }

  private drawToken(): void {
    const k = this.piecePos - this.winStart;
    // the token can walk out of the window on a long throw; park it on the last
    // visible slot rather than drawing it off the panel
    const p = windowPoint(COURSE, Math.max(0, Math.min(WINDOW - 1, k)));
    drawPiece(this.g, p.x, p.y, this.hopLift);
  }

  /**
   * The die readout, tucked into the empty top-right of the serpentine. The
   * physical die is across the cabinet in its tray, so the board still has to
   * say what it landed on — the player is looking at the monitor by then.
   */
  private drawReadout(): void {
    const g = this.g;
    const cx = CW - 172;
    const cy = CH - 128;
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    if (this.phase === 'throw') {
      g.font = '700 26px ' + FONT_UI;
      g.fillStyle = INK.cyan;
      g.fillText(this.pickBtns ? '出目をえらぶ' : 'ダイスを振っています', cx, cy);
      return;
    }
    if ((this.phase === 'shown' || this.phase === 'move') && this.faces.length) {
      const n = this.faces.length;
      const size = n > 1 ? 56 : 76;
      this.faces.forEach((f, i) => {
        drawDieFace(g, cx + (i - (n - 1) / 2) * (size + 12), cy, size, f);
      });
      if (n > 1) {
        g.font = '700 30px ' + FONT_DISPLAY;
        g.fillStyle = INK.gold;
        g.fillText('= ' + this.total, cx, cy + 62);
      }
      return;
    }
    if (this.phase === 'minigame') {
      drawDieFace(g, cx, cy - 8, 64, this.gameFace);
      g.font = '700 28px ' + FONT_DISPLAY;
      g.fillStyle = INK.gold;
      g.fillText('+' + this.gamePay, cx, cy + 56);
      return;
    }
    if (this.phase === 'effect' && this.landing) {
      const st = KIND_STYLE[this.landing.square.kind];
      drawIcon(g, st.icon, cx, cy - 14, 52, st.color);
      g.font = '700 24px ' + FONT_UI;
      g.fillStyle = st.color;
      g.fillText(this.landing.headline, cx, cy + 40);
      return;
    }
    g.font = '600 21px ' + FONT_UI;
    g.fillStyle = INK.sub;
    g.fillText('ミニキューブを', cx, cy - 12);
    g.fillText('落として出発', cx, cy + 16);
  }

  /** Slide the window so the token starts a turn near its left edge, with room
   *  ahead to actually watch it travel. Never called mid-walk — the board must
   *  not move under the token. */
  private recomputeWindow(): void {
    this.winStart = Math.max(0, Math.min(GOAL - WINDOW + 1, this.board.pos - 2));
  }

  refresh(): void {
    this.recomputeWindow();
    this.piecePos = this.board.pos;
    this.hopFrom = this.hopTo = this.board.pos;
    this.hopT = 1;
    this.dirty = true;
    this.draw();
    this.dirty = false;
  }
}
