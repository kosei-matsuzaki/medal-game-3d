import { bus } from '../core/EventBus';
import { Economy, MiniGameKind } from './Economy';
import { GameStore } from './GameStore';
import { MiniGame, MiniGameContext, MiniGameResult } from '../minigames/MiniGame';
import { Sugoroku } from '../minigames/Sugoroku';
import { JackpotBowl } from '../minigames/JackpotBowl';
import { DiceTray } from '../minigames/DiceTray';
import { Chinchiro } from '../minigames/Chinchiro';
import { MedalSpawner } from '../pusher/MedalSpawner';
import { JackpotFX } from '../fx/JackpotFX';
import { CameraRig } from '../camera/CameraRig';
import { InputManager } from '../input/InputManager';
import { HUD } from '../ui/HUD';
import { Fever } from './Fever';
import { Board } from './Board';

export type GameState = 'idle' | 'sugoroku' | 'bowl' | 'chinchiro';

/**
 * Drives the high-level flow:
 *
 *   IDLE → (mini cube dropped) → すごろく → payout → IDLE
 *                                      └ GOAL → 抽選ボウル → チンチロ → payout
 *
 * Every payout is PHYSICAL: a win dispenses medals onto the field and the player
 * still has to push them off the front to bank them. The only direct credit award
 * is the progressive jackpot, which is far too large to rain in coin by coin.
 */
export class GameStateMachine {
  state: GameState = 'idle';
  private games: Record<MiniGameKind, MiniGame>;
  private active: MiniGame | null = null;
  private bowl!: JackpotBowl;
  private dice!: DiceTray;
  private chin!: Chinchiro;
  /** jackpot win parked while チンチロ decides its multiplier */
  private pendingJackpot = 0;
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
    private board: Board,
    ctxBase: Omit<MiniGameContext, 'economy' | 'store' | 'camera' | 'input' | 'hud' | 'fever' | 'board'>
  ) {
    const dice = new DiceTray(ctxBase.scene, ctxBase.physics);
    const sugoroku = new Sugoroku(ctxBase.scene, board, dice);
    const bowl = new JackpotBowl(ctxBase.scene, ctxBase.physics);
    const chinchiro = new Chinchiro(dice);
    this.dice = dice;
    this.bowl = bowl;
    this.chin = chinchiro;
    this.games = { sugoroku, bowl, chinchiro };

    this.ctx = {
      ...ctxBase,
      economy,
      store,
      camera,
      input,
      hud,
      fever: this.fever,
      board,
    };
  }

  /** Debug/testing: inspect the チンチロ chase mid-run. */
  debugChinchiro(): object {
    return { ...this.chin.debugState(), pendingJackpot: this.pendingJackpot };
  }

  /** Debug/testing: suppress automatic board turns. */
  ignoreChuckers = false;

  /** A mini ball reached the payout tray — take one board turn. */
  playSpin(): boolean {
    if (this.ignoreChuckers) return false;
    if (this.state !== 'idle') return false;
    this.enter('sugoroku');
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
    // the disc & JP stages each happen in their own area — move the camera there.
    // すごろく sets its own pose (it pushes in on the monitor for the whole turn).
    // the bowl sets its own pose; すごろく pushes in on the monitor itself
    // exactly one unit glows at a time — whichever one is being played
    this.setSpotlight(kind);
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
    // so the 目的地到着 that STARTS fever isn't itself doubled.
    const feverMult = this.fever.mult;
    this.fever.onBoardResult(r.feverAction);

    // 赤マス: taken straight off the credit, clamped to what the player has
    if (r.taken && r.taken > 0) {
      this.store.spend(Math.min(r.taken, this.store.credits));
      this.economy.fundFromLoss(r.taken);
    }
    // JPアップマス: straight into the progressive pool
    if (r.jpAdd && r.jpAdd > 0) this.store.addToJackpot(r.jpAdd);

    // 目的地到着 → the jackpot bowl. The bowl IS the arrival reward, so nothing is
    // paid here; a separate arrival bonus on top would double-pay the moment.
    if (r.bonus === 'station') {
      this.enter('bowl');
      return;
    }

    if (r.jackpot) {
      // Take the pool now (so it visibly resets) but PARK the figure: チンチロ
      // decides the multiplier before any of it is credited.
      const mult = Math.max(1, r.jackpotMult ?? 1);
      this.pendingJackpot = Math.round(this.store.awardJackpot() * mult);
      this.fx.celebrate(Math.min(this.pendingJackpot, 260));
      this.hud.showOverlay('JACKPOT!!', `${this.pendingJackpot.toLocaleString()} MEDAL`);
      this.hud.hideOverlayAfter(2.2);
      this.chin.setStake(this.pendingJackpot);
      this.enter('chinchiro');
      return;
    }

    // EVERY bowl result rides the チンチロ, jackpot or not — it is the "獲得メダル
    // 増加チャレンジ" that sits on whatever the bowl produced. Gating it on a
    // minimum would make the machine sometimes offer the chase and sometimes
    // quietly skip it, which reads as the game deciding you did not deserve it.
    if (kind === 'bowl' && r.payout > 0) {
      this.chin.setStake(r.payout);
      this.enter('chinchiro');
      return;
    }

    // チンチロ resolved: pay out what it multiplied up to.
    if (kind === 'chinchiro') {
      if (this.pendingJackpot > 0) {
        // a jackpot is far too large to rain in coin by coin — credit it
        this.store.addCredits(r.payout);
        this.pendingJackpot = 0;
        this.hud.showOverlay('獲得!!', `+${r.payout.toLocaleString()} MEDAL`);
        this.hud.hideOverlayAfter(3.2);
        this.finish();
        return;
      }
    }

    // Payout is PHYSICAL only: dispense the medals and let the player push them
    // off the front to bank them. Crediting here as well would pay every win
    // twice, and would rob the pusher of the only job it has.
    // FEVER multiplies BOARD squares only. The bowl is its own lottery with its
    // own prize table, and 目的地到着 is what turns FEVER on — so letting it apply
    // to the bowl that the arrival chains straight into is not a bonus, it is a
    // guaranteed ×2 on every single draw. Measured, that made the bowl 91% of all
    // payouts in the game.
    const payout = r.payout * (kind === 'sugoroku' ? feverMult : 1);
    if (payout > 0) {
      this.spawner.dispense(Math.min(payout, 160), false);
      if (payout >= 50) this.fx.bigWin(Math.min(payout, 90));
    }

    bus.emit('minigame:result', { kind, payout });

    this.finish();
  }

  private finish(): void {
    this.transition('idle');
    this.camera.setPose(CameraRig.PLAY);
    this.setSpotlight(null);
    this.input.enabled = true;
  }

  /** The idle bowl dims down so the pusher cabinet stays the visual subject. */
  private setSpotlight(kind: MiniGameKind | null): void {
    this.bowl.setSpotlit(kind === 'bowl');
    this.dice.setSpotlit(kind === 'sugoroku' || kind === 'chinchiro');
  }

  private transition(to: GameState): void {
    const from = this.state;
    this.state = to;
    bus.emit('state:changed', { from, to });
  }

  update(dt: number): void {
    this.active?.update(dt);
  }
}
