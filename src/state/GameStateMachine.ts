import { bus } from '../core/EventBus';
import { Economy, MiniGameKind } from './Economy';
import { GameStore } from './GameStore';
import { MiniGame, MiniGameContext, MiniGameResult } from '../minigames/MiniGame';
import { SlotMachine } from '../minigames/SlotMachine';
import { DiscChallenge } from '../minigames/DiscChallenge';
import { JackpotChallenge } from '../minigames/JackpotChallenge';
import { MedalSpawner } from '../pusher/MedalSpawner';
import { JackpotFX } from '../fx/JackpotFX';
import { CameraRig } from '../camera/CameraRig';
import { InputManager } from '../input/InputManager';
import { HUD } from '../ui/HUD';
import { Fever } from './Fever';

export type GameState = 'idle' | 'slot' | 'disc' | 'jackpot';

/**
 * Drives the high-level flow: IDLE → (chucker) → minigame → payout → IDLE, with
 * jackpot/bonus branching. Owns the minigame instances and routes results into
 * the economy, physical medal payouts and FX.
 */
export class GameStateMachine {
  state: GameState = 'idle';
  // only the slot and the disc (円盤) JP challenge are wired
  private games: Record<MiniGameKind, MiniGame>;
  private active: MiniGame | null = null;
  private disc!: DiscChallenge;
  private ctx: MiniGameContext;

  constructor(
    private economy: Economy,
    private store: GameStore,
    private spawner: MedalSpawner,
    private fx: JackpotFX,
    private camera: CameraRig,
    private input: InputManager,
    private hud: HUD,
    private fever: Fever,
    ctxBase: Omit<MiniGameContext, 'economy' | 'store' | 'camera' | 'input' | 'hud' | 'fever'>
  ) {
    const slot = new SlotMachine(ctxBase.scene);
    const disc = new DiscChallenge(ctxBase.scene, store, ctxBase.physics);
    const jackpot = new JackpotChallenge(ctxBase.scene, ctxBase.physics);
    this.disc = disc;
    this.games = { slot, disc, jackpot };

    this.ctx = {
      ...ctxBase,
      economy,
      store,
      camera,
      input,
      hud,
      fever: this.fever,
    };
  }

  /** Debug/testing: suppress the slot auto play. */
  ignoreChuckers = false;
  private slotMult = 1;

  /** Play one stocked slot spin with the given payout multiplier. */
  playSlot(multiplier: number): boolean {
    if (this.ignoreChuckers) return false;
    if (this.state !== 'idle') return false;
    this.slotMult = Math.max(1, multiplier);
    this.economy.accrue(1);
    bus.emit('sfx', { name: 'chucker' });
    this.enter('slot');
    return true;
  }

  /** Enough field balls have dropped → start the disc (円盤) JP challenge. */
  requestDisc(): boolean {
    if (this.state !== 'idle') return false;
    this.enter('disc');
    return true;
  }

  /** Debug/testing: force-start a minigame from IDLE. */
  forceEnter(kind: MiniGameKind): boolean {
    if (this.state !== 'idle') return false;
    this.enter(kind);
    return true;
  }

  /** Developer mode: abort whatever is running and return cleanly to IDLE. */
  devReset(): void {
    if (this.state === 'idle') return;
    if (this.active) this.active.stop();
    this.active = null;
    this.finish();
  }

  private enter(kind: MiniGameKind): void {
    // guard against an unwired/unknown kind reaching us at runtime (e.g. a debug
    // `force('roulette')`): only slot & disc exist in the games map.
    const game = this.games[kind];
    if (!game) return;
    this.transition(kind);
    // the disc & JP stages each happen in their own area — move the camera there;
    // every other minigame keeps the fixed PLAY framing.
    this.camera.setPose(kind === 'disc' ? CameraRig.DISC : kind === 'jackpot' ? CameraRig.JPDROP : CameraRig.PLAY);
    // input stays ENABLED so medals can be inserted during minigames; the slot
    // does not capture clicks.
    this.active = game;
    bus.emit('minigame:start', { kind });
    game.start(this.ctx, (r) => this.onResult(kind, r));
  }

  private onResult(kind: MiniGameKind, r: MiniGameResult): void {
    if (this.active) this.active.stop();
    this.active = null;

    // FEVER multiplier for THIS result is read BEFORE the result mutates the state,
    // so the triggering 7揃い isn't doubled but an ending even-number win still is.
    const feverMult = this.fever.mult;
    this.fever.onSlotResult(r.feverAction);

    // slot BALL match → eject a physical ball (Game handles it); no payout
    if (r.ball) {
      bus.emit('slot:ball', {});
      this.finish();
      return;
    }

    // disc JP-Chance → chain into the dedicated JP (jackpot) drop stage; it awards.
    if (r.bonus === 'jackpot') {
      this.enter('jackpot');
      return;
    }

    if (r.jackpot) {
      // award the progressive pool (× the JP-stage multiplier) & celebrate
      const mult = Math.max(1, r.jackpotMult ?? 1);
      const amount = Math.round(this.store.awardJackpot() * mult);
      this.store.addCredits(amount);
      this.fx.celebrate(Math.min(amount, 260));
      const tag = mult > 1 ? ` ×${mult}` : '';
      this.hud.showOverlay('JACKPOT!!', `+${amount.toLocaleString()} MEDAL${tag}`);
      setTimeout(() => this.hud.hideOverlay(), 3500);
      this.finish();
      return;
    }

    // payout = base × stock multiplier (slot only) × FEVER multiplier (×2 active)
    const stockMult = kind === 'slot' ? this.slotMult : 1;
    const payout = r.payout * stockMult * feverMult;
    if (payout > 0) {
      this.store.addCredits(payout);
      this.spawner.dispense(Math.min(payout, 160), false);
      if (payout >= 50) this.fx.bigWin(Math.min(payout, 90));
    }

    bus.emit('minigame:result', { kind, payout });

    this.finish();
  }

  private finish(): void {
    this.transition('idle');
    this.camera.setPose(CameraRig.PLAY);
    this.input.enabled = true;
  }

  private transition(to: GameState): void {
    const from = this.state;
    this.state = to;
    bus.emit('state:changed', { from, to });
  }

  update(dt: number): void {
    this.active?.update(dt);
    // the installed disc unit idles (slow spin) whenever it isn't the active game
    if (this.active !== this.disc) this.disc.tick(dt);
  }
}
