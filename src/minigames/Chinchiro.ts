import * as THREE from 'three';
import { MiniGame, MiniGameContext, MiniGameResult } from './MiniGame';
import { DiceTray } from './DiceTray';
import { create2D } from '../render/canvasText';
import { CameraRig } from '../camera/CameraRig';
import { bus } from '../core/EventBus';
import { INK, FONT_DISPLAY, FONT_UI, roundRect, drawDieFace } from './boardArt';

const CW = 720;
const CH = 560;

/** Maximum throws before a 目なし run is written off as a push. */
const MAX_THROWS = 3;

export interface ChinchiroHand {
  name: string;
  mult: number;
  /** true when the hand is a straight loss rather than a gain */
  bad?: boolean;
  color: string;
}

/**
 * Read three dice as a チンチロ hand.
 *
 * Ordering matters: ピンゾロ has to be checked before the general triple, and
 * ヒフミ before the "no pair" fallback, or the rarest hands get swallowed by the
 * commoner ones they are special cases of.
 */
export function readHand(d: number[]): ChinchiroHand | null {
  const s = [...d].sort((a, b) => a - b);
  const [a, b, c] = s;
  if (a === 1 && b === 1 && c === 1) return { name: 'ピンゾロ', mult: 5, color: '#ff48c0' };
  if (a === b && b === c) return { name: `ゾロ目 ${a}`, mult: 3, color: '#ffcf4a' };
  if (a === 4 && b === 5 && c === 6) return { name: 'シゴロ', mult: 2.5, color: '#ffcf4a' };
  if (a === 1 && b === 2 && c === 3) return { name: 'ヒフミ', mult: 0.5, bad: true, color: '#ff5a6e' };
  // a pair leaves one odd die — that number is the hand
  if (a === b) return eye(c);
  if (b === c) return eye(a);
  if (a === c) return eye(b);
  return null; // 目なし — throw again
}

function eye(n: number): ChinchiroHand {
  const mult = [0, 1.1, 1.2, 1.3, 1.5, 1.7, 2.0][n];
  return { name: `${n}の目`, mult, color: n >= 5 ? '#ffcf4a' : '#8fd0ff' };
}

/**
 * チンチロ — the multiplier chase that runs AFTER the bowl has decided what the
 * player won.
 *
 * Three real dice into the same tray, read as a standard チンチロ hand. It is a
 * gamble on purpose: ヒフミ halves the win, so taking the prize up is never free.
 * 目なし throws again rather than paying nothing, up to three times, because a
 * challenge that can silently do nothing at all is just a delay.
 *
 * It multiplies the pending prize; it never generates medals of its own, which
 * keeps the payout ratio anchored to the bowl that fed it.
 */
export class Chinchiro implements MiniGame {
  readonly kind = 'chinchiro';

  private ctx!: MiniGameContext;
  private onDone!: (r: MiniGameResult) => void;

  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;

  private phase: 'idle' | 'throw' | 'reveal' = 'idle';
  private timer = 0;
  private faces: number[] = [];
  private throwNo = 0;
  private hand: ChinchiroHand | null = null;

  /** Prize handed over by the bowl, in medals. */
  private stake = 0;

  constructor(private dice: DiceTray) {
    [this.canvas, this.g] = create2D(CW, CH);
    this.canvas.className = 'chinchiro-panel';
    (document.getElementById('ui-root') ?? document.body).appendChild(this.canvas);
  }

  /** Debug/testing: what the chase is doing right now. */
  debugState(): object {
    return {
      phase: this.phase,
      throwNo: this.throwNo,
      faces: [...this.faces],
      timer: +this.timer.toFixed(2),
      stake: this.stake,
      hand: this.hand?.name ?? null,
      tray: this.dice.debugState(),
    };
  }

  /** The state machine hands over what the bowl awarded before starting. */
  setStake(medals: number): void {
    this.stake = medals;
  }

  start(ctx: MiniGameContext, onDone: (r: MiniGameResult) => void): void {
    this.ctx = ctx;
    this.onDone = onDone;
    this.throwNo = 0;
    this.hand = null;
    this.faces = [];
    this.canvas.classList.add('show');
    ctx.camera.setPose(CameraRig.CHINCHIRO);
    ctx.hud.showOverlay('チンチロ', `${this.stake} メダルを賭けて倍率チャレンジ`, true);
    this.draw();
    this.throwSet();
  }

  /** Throw all three together — that is what チンチロ is, and three sequential
   *  settles re-rolled up to three times would be half a minute of waiting. */
  private throwSet(): void {
    this.throwNo++;
    this.faces = [];
    this.phase = 'throw';
    this.draw();
    this.dice.throwDice(3, (v) => {
      this.faces = v;
      this.draw();
      this.judge();
    });
  }

  private judge(): void {
    const hand = readHand(this.faces);
    if (!hand) {
      // 目なし
      if (this.throwNo < MAX_THROWS) {
        this.phase = 'reveal';
        this.timer = 1.1;
        this.hand = null;
        this.draw();
        bus.emit('sfx', { name: 'nearmiss' });
        this.ctx.hud.showOverlay('目なし', `振り直し ${this.throwNo}/${MAX_THROWS}`, true);
        return;
      }
      // out of throws — the stake rides through untouched
      this.hand = { name: '目なし', mult: 1, color: INK.sub };
    } else {
      this.hand = hand;
    }

    this.phase = 'reveal';
    this.timer = 2.6;
    this.draw();

    const h = this.hand;
    if (h.bad) {
      bus.emit('sfx', { name: 'nearmiss' });
      bus.emit('board:outcome', { kind: 'near' });
      this.ctx.hud.showOverlay(h.name, `×${h.mult} …`, true);
    } else if (h.mult >= 2.5) {
      bus.emit('sfx', { name: 'jackpot' });
      bus.emit('board:outcome', { kind: 'bigwin' });
      bus.emit('fx:flash', { bloom: 1.8 });
      bus.emit('fx:shake', { intensity: 0.3, duration: 0.6 });
      this.ctx.hud.showOverlay(h.name, `×${h.mult}!!`, true);
    } else {
      bus.emit('sfx', { name: 'win' });
      bus.emit('board:outcome', { kind: 'win' });
      bus.emit('fx:flash', { bloom: 0.8 });
      this.ctx.hud.showOverlay(h.name, `×${h.mult}`, true);
    }
  }

  update(dt: number): void {
    this.dice.update(dt);
    if (this.phase !== 'reveal') return;
    this.timer -= dt;
    if (this.timer > 0) return;

    if (!this.hand) {
      this.throwSet();
      return;
    }
    const final = Math.max(0, Math.round(this.stake * this.hand.mult));
    this.phase = 'idle';
    this.onDone({ payout: final, label: `チンチロ ${this.hand.name}` });
  }

  stop(): void {
    this.phase = 'idle';
    // The stake belongs to the run that just ended. Leaving it set would let a
    // later start() that forgot to call setStake() quietly pay out the PREVIOUS
    // prize a second time — a stale number here mints medals from nothing.
    this.stake = 0;
    this.dice.clear();
    this.canvas.classList.remove('show');
    if (this.ctx) this.ctx.hud.hideOverlayAfter(0.35);
  }

  // --- drawing --------------------------------------------------------------

  private draw(): void {
    const g = this.g;
    g.clearRect(0, 0, CW, CH);
    roundRect(g, 4, 4, CW - 8, CH - 8, 22);
    g.fillStyle = 'rgba(4, 6, 14, 0.93)';
    g.fill();
    g.strokeStyle = 'rgba(255, 207, 74, 0.5)';
    g.lineWidth = 4;
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 40px ${FONT_UI}`;
    g.fillStyle = INK.gold;
    g.shadowColor = INK.gold;
    g.shadowBlur = 20;
    g.fillText('チンチロ', CW / 2, 56);
    g.shadowBlur = 0;

    g.font = `600 22px ${FONT_UI}`;
    g.fillStyle = INK.sub;
    g.fillText(`${this.stake} メダルの倍率チャレンジ`, CW / 2, 96);

    // the three dice
    const size = 96;
    for (let i = 0; i < 3; i++) {
      const x = CW / 2 + (i - 1) * (size + 22);
      if (i < this.faces.length) {
        drawDieFace(g, x, 190, size, this.faces[i]);
      } else {
        roundRect(g, x - size / 2, 190 - size / 2, size, size, size * 0.18);
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.16)';
        g.lineWidth = 2;
        g.stroke();
      }
    }

    g.font = `600 20px ${FONT_UI}`;
    g.fillStyle = INK.sub;
    g.fillText(`${this.throwNo} / ${MAX_THROWS} 投`, CW / 2, 268);

    if (this.phase === 'reveal') {
      if (!this.hand) {
        g.font = `700 44px ${FONT_UI}`;
        g.fillStyle = INK.sub;
        g.fillText('目なし — 振り直し', CW / 2, 336);
      } else {
        const h = this.hand;
        g.font = `700 50px ${FONT_UI}`;
        g.fillStyle = h.color;
        g.shadowColor = h.color;
        g.shadowBlur = 24;
        g.fillText(h.name, CW / 2, 332);
        g.shadowBlur = 0;
        g.font = `700 62px ${FONT_DISPLAY}`;
        g.fillStyle = h.bad ? '#ff5a6e' : INK.gold;
        g.fillText(`×${h.mult}`, CW / 2, 400);
        g.font = `700 34px ${FONT_DISPLAY}`;
        g.fillStyle = INK.text;
        g.fillText(`${Math.round(this.stake * h.mult)} メダル`, CW / 2, 460);
      }
    } else {
      g.font = `600 24px ${FONT_UI}`;
      g.fillStyle = INK.cyan;
      g.fillText('サイコロを振っています…', CW / 2, 340);
      // the hand table, so the player knows what they are hoping for
      const rows: [string, string][] = [
        ['ピンゾロ (1-1-1)', '×5'],
        ['ゾロ目', '×3'],
        ['シゴロ (4-5-6)', '×2.5'],
        ['ゾロ目以外の目', '×1.1〜2.0'],
        ['ヒフミ (1-2-3)', '×0.5'],
      ];
      g.font = `600 19px ${FONT_UI}`;
      rows.forEach((r, i) => {
        const y = 384 + i * 30;
        g.textAlign = 'left';
        g.fillStyle = INK.sub;
        g.fillText(r[0], 120, y);
        g.textAlign = 'right';
        g.fillStyle = r[1] === '×0.5' ? '#ff5a6e' : INK.gold;
        g.fillText(r[1], CW - 120, y);
      });
      g.textAlign = 'center';
    }
  }
}
