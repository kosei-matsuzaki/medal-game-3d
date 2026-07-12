import * as THREE from 'three';
import { MiniGame, MiniGameContext, MiniGameResult } from './MiniGame';
import { SLOT_SYMBOLS, SlotSymbol, SlotResult } from '../state/Economy';
import { symbolStripTexture } from './symbols';
import { easeOutCubic, easeOutQuint } from '../utils/math';
import { bus } from '../core/EventBus';
import { LAYOUT } from '../pusher/layout';
import { anchorToMonitor } from '../ui/monitorAnchor';

const N = SLOT_SYMBOLS.length;
const REEL_W = 0.92;
const REEL_H = 1.0;
const REEL_SPACING = 1.02;

// On a losing spin, how often to still FAKE a reach (outer reels match, middle
// lands one symbol off) so it feels like it could hit — misses are meant to be
// fun. A slice of those are a "super reach" (7揃いを狙うアツい演出) that just misses.
const REACH_TEASE_CHANCE = 0.34;
const SUPER_TEASE_CHANCE = 0.16;
const REACH_TURNS = 3; // extra full spins the middle reel does during the reach
const REACH_DURATION = 2.4; // slow, drawn-out middle-reel spin (suspense)

interface Reel {
  mesh: THREE.Mesh;
  tex: THREE.CanvasTexture;
  offset: number; // texture scroll (integer part = turns, fractional = symbol)
  start: number;
  target: number;
  spinTime: number;
  duration: number;
  stopped: boolean;
}

/**
 * Flat three-reel slot displayed on the monitor. Each reel is a plane with a
 * scrolling strip texture (all symbols), windowed to one symbol via repeat=1/N;
 * the reel eases its texture offset to the predetermined symbol.
 */
export class SlotMachine implements MiniGame {
  readonly kind = 'slot';
  readonly group = new THREE.Group();
  private reels: Reel[] = [];
  private ctx!: MiniGameContext;
  private onDone!: (r: MiniGameResult) => void;
  private result!: SlotResult;
  private display: [SlotSymbol, SlotSymbol, SlotSymbol] = ['1', '1', '1'];
  private phase: 'idle' | 'spinning' | 'reveal' | 'done' = 'idle';
  private phaseTimer = 0;
  // reach (リーチ) state — outer reels matched, middle reel decides
  private reachActive = false; // this spin shows a reach
  private reachHit = false; // …and the middle reel will complete the match
  private reachSuper = false; // 7 / BALL reach → 激アツ presentation
  private reachTriggered = false; // slowdown already kicked in this spin

  constructor(scene: THREE.Scene) {
    // anchored on the back-top monitor (just in front of the screen), tilted
    anchorToMonitor(this.group);
    // sit the reels a little HIGHER on the screen (along the tilted monitor face)
    this.group.translateY(0.35);
    this.group.visible = false;

    // The whole slot is drawn as FLAT layers hugging the screen surface (mm z
    // steps for draw order only) — it must read as an image ON the monitor.
    const panelW = REEL_SPACING * 3 + 0.3;
    // dark backing panel behind the reels (opaque — no see-through)
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(panelW, REEL_H + 0.34),
      new THREE.MeshBasicMaterial({ color: 0x04060e })
    );
    backing.position.z = -0.006;
    this.group.add(backing);

    const xs = [-REEL_SPACING, 0, REEL_SPACING];
    for (const x of xs) {
      const reel = this.makeReel();
      reel.mesh.position.set(x, 0, 0.0);
      this.group.add(reel.mesh);
      this.reels.push(reel);
    }

    // reel dividers (flat strips over the reel seams)
    for (const x of [-REEL_SPACING / 2, REEL_SPACING / 2]) {
      const div = new THREE.Mesh(
        new THREE.PlaneGeometry(0.05, REEL_H + 0.2),
        new THREE.MeshBasicMaterial({ color: 0x10182c })
      );
      div.position.set(x, 0, 0.004);
      this.group.add(div);
    }

    // cyan window bars (top & bottom of the payline window)
    const barMat = new THREE.MeshBasicMaterial({ color: 0x36e0ff });
    for (const y of [REEL_H / 2 + 0.04, -REEL_H / 2 - 0.04]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(panelW, 0.05), barMat);
      bar.position.set(0, y, 0.007);
      this.group.add(bar);
    }

    scene.add(this.group);
  }

  private makeReel(): Reel {
    const tex = symbolStripTexture();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(REEL_W, REEL_H),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    return { mesh, tex, offset: 0, start: 0, target: 0, spinTime: 0, duration: 0, stopped: true };
  }

  private symbolIndex(s: SlotSymbol): number {
    return SLOT_SYMBOLS.indexOf(s);
  }

  start(ctx: MiniGameContext, onDone: (r: MiniGameResult) => void): void {
    this.ctx = ctx;
    this.onDone = onDone;
    this.group.visible = true;
    // during FEVER the slot wins far more readily
    this.result = ctx.economy.slotRoll(ctx.fever.isActive);
    // what the reels actually SHOW (payout is unaffected — display only): wins are
    // already 3-of-a-kind, and many misses get dressed up as a near-miss reach.
    this.display = this.buildDisplayReels(this.result);
    this.reachActive = this.display[0] === this.display[2];
    this.reachHit = this.reachActive && this.display[1] === this.display[0];
    this.reachSuper = this.reachActive && (this.display[0] === '7' || this.display[0] === 'BALL');
    this.reachTriggered = false;

    this.phase = 'spinning';
    bus.emit('sfx', { name: 'spin' });

    // Stop order LEFT → RIGHT → MIDDLE last, so the centre reel is the decider
    // (the classic "2 ? 2" reach). Reel index 1 is the middle reel.
    const durations = [0.85, 1.75, 1.3]; // [left, MIDDLE last, right]
    const turns = [4, 6, 5];
    this.reels.forEach((reel, i) => {
      const targetIdx = this.symbolIndex(this.display[i]);
      // scroll the texture by `turns` cycles then land on symbol targetIdx (i/N)
      reel.start = reel.offset;
      reel.target = Math.floor(reel.start) + turns[i] + targetIdx / N;
      reel.spinTime = 0;
      reel.duration = durations[i];
      reel.stopped = false;
    });
    // NOTE: clicks are NOT captured here — coins can be inserted during the slot.
  }

  /**
   * The symbols the reels visually land on. A win is already 3-of-a-kind (its
   * outer pair matches → the middle reel naturally "reaches" into the win). A
   * miss is often re-dressed as a teasing reach ([X, Y, X], Y one symbol off)
   * so losing spins are still exciting; the rest are plain non-reach misses.
   * Purely cosmetic — never affects payout/ball/fever (those live on result).
   */
  private buildDisplayReels(r: SlotResult): [SlotSymbol, SlotSymbol, SlotSymbol] {
    if (r.payout > 0 || r.ball) return [r.reels[0], r.reels[1], r.reels[2]];
    if (Math.random() < REACH_TEASE_CHANCE) {
      const sup = Math.random() < SUPER_TEASE_CHANCE;
      const x: SlotSymbol = sup ? '7' : (String(1 + Math.floor(Math.random() * 9)) as SlotSymbol);
      return [x, this.nearMissSymbol(x), x];
    }
    return this.nonReachReels();
  }

  /** A symbol next to `x` (so the near miss looks agonisingly close). */
  private nearMissSymbol(x: SlotSymbol): SlotSymbol {
    if (x === '7') return Math.random() < 0.5 ? '6' : '8';
    const n = Number(x);
    const opts = [n - 1, n + 1].filter((v) => v >= 1 && v <= 9);
    return String(opts[Math.floor(Math.random() * opts.length)]) as SlotSymbol;
  }

  /** Three numbers whose OUTER reels differ → guaranteed no reach. */
  private nonReachReels(): [SlotSymbol, SlotSymbol, SlotSymbol] {
    const pick = () => String(1 + Math.floor(Math.random() * 9)) as SlotSymbol;
    const a = pick();
    let c = pick();
    while (c === a) c = pick();
    return [a, pick(), c];
  }

  /** Kick the middle reel back into a slow, drawn-out spin — the reach payoff. */
  private triggerReach(): void {
    this.reachTriggered = true;
    const mid = this.reels[1];
    const targetIdx = this.symbolIndex(this.display[1]);
    mid.start = mid.offset;
    mid.target = Math.floor(mid.offset) + REACH_TURNS + targetIdx / N;
    mid.spinTime = 0;
    mid.duration = REACH_DURATION;
    bus.emit('slot:reach', { symbol: this.display[0], super: this.reachSuper });
    bus.emit('sfx', { name: 'reach' });
    bus.emit('fx:shake', { intensity: this.reachSuper ? 0.7 : 0.4, duration: 0.4 });
    if (this.reachSuper) bus.emit('fx:flash', {});
    // reach 演出 is shown on the MONITOR (MonitorUI), not as a HUD toast
  }

  update(dt: number): void {
    if (this.phase === 'spinning') {
      // the instant both outer reels have landed on a matching pair, throw the
      // middle reel into a slow suspense spin (リーチ)
      if (
        this.reachActive &&
        !this.reachTriggered &&
        this.reels[0].stopped &&
        this.reels[2].stopped &&
        !this.reels[1].stopped
      ) {
        this.triggerReach();
      }
      let allStopped = true;
      let reelStopSound = false;
      for (const reel of this.reels) {
        if (reel.stopped) continue;
        allStopped = false;
        reel.spinTime += dt;
        const t = Math.min(1, reel.spinTime / reel.duration);
        // the reach (middle) reel decelerates extra-slowly for suspense
        const reaching = this.reachTriggered && reel === this.reels[1];
        const e = reaching ? easeOutQuint(t) : easeOutCubic(t);
        reel.offset = reel.start + (reel.target - reel.start) * e;
        reel.tex.offset.y = reel.offset % 1;
        // spinning tick sound
        if (Math.floor(reel.spinTime * 30) % 4 === 0) bus.emit('sfx', { name: 'reel' });
        if (t >= 1) {
          reel.stopped = true;
          reel.offset = reel.target;
          reel.tex.offset.y = reel.offset % 1;
          reelStopSound = true;
        }
      }
      if (reelStopSound) bus.emit('sfx', { name: 'reelstop' });
      if (allStopped) {
        this.phase = 'reveal';
        this.phaseTimer = this.reachHit ? 1.1 : 0.9;
        this.reveal();
      }
    } else if (this.phase === 'reveal') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phase = 'done';
        this.onDone({
          payout: this.result.payout,
          jackpot: this.result.jackpot,
          ball: this.result.ball,
          feverAction: this.result.feverAction,
          label: this.result.label,
        });
      }
    }
  }

  private reveal(): void {
    const r = this.result;
    const m = LAYOUT.monitor;
    // NO HUD toasts — the win / near-miss 演出 all plays out on the MONITOR
    // (particles + MonitorUI reaction via slot:outcome).
    if (r.ball) {
      this.ctx.particles.emit(m.x, m.y, m.z + 1, 120, new THREE.Color(0xff8a2c), 8);
      bus.emit('sfx', { name: 'bigwin' });
      bus.emit('slot:outcome', { kind: 'bigwin' });
    } else if (r.payout > 0) {
      const big = r.payout >= 60;
      this.ctx.particles.emit(m.x, m.y, m.z + 1, big ? 90 : 50, new THREE.Color(big ? 0xffe24a : 0xffd060), big ? 8 : 6);
      bus.emit('sfx', { name: big ? 'bigwin' : 'win' });
      bus.emit('slot:outcome', { kind: big ? 'bigwin' : 'win' });
    } else if (this.reachActive) {
      // a reach that just missed — the monitor shows the near-miss reaction
      bus.emit('sfx', { name: 'nearmiss' });
      bus.emit('slot:outcome', { kind: 'near' });
    } else {
      bus.emit('slot:outcome', { kind: 'miss' });
    }
  }

  stop(): void {
    this.group.visible = false;
    this.phase = 'idle';
    if (this.ctx) this.ctx.input.capture = null;
  }
}
