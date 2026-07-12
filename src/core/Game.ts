import { Engine } from './Engine';
import { Loop } from './Loop';
import { bus } from './EventBus';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PusherCabinet } from '../pusher/PusherCabinet';
import { PusherPlate } from '../pusher/PusherPlate';
import { MedalPool } from '../pusher/MedalPool';
import { MedalSpawner } from '../pusher/MedalSpawner';
import { DropDetector } from '../pusher/DropDetector';
import { BallManager } from '../pusher/BallManager';
import { LAYOUT } from '../pusher/layout';
import { SaveManager } from '../save/SaveManager';
import { GameStore } from '../state/GameStore';
import { Economy } from '../state/Economy';
import { Progression } from '../state/Progression';
import { Fever } from '../state/Fever';
import { SlotStock } from '../state/SlotStock';
import { StockDisplay } from '../ui/StockDisplay';
import { MonitorUI } from '../ui/MonitorUI';
import { GameStateMachine } from '../state/GameStateMachine';
import { HUD } from '../ui/HUD';
import { DevPanel } from '../ui/DevPanel';
import { AudioManager } from '../audio/AudioManager';
import { InputManager } from '../input/InputManager';
import { Particles } from '../fx/Particles';
import { MedalBurst } from '../fx/MedalBurst';
import { JackpotFX } from '../fx/JackpotFX';
import { CameraRig, CameraPose } from '../camera/CameraRig';
import { QualityTier } from '../render/PostFX';
import { installDebug } from './debug';

/** Top-level orchestrator: builds all systems and runs the loop. */
export class Game {
  private engine!: Engine;
  private loop = new Loop();
  private physics!: PhysicsWorld;
  private pool!: MedalPool;
  private pusher!: PusherPlate;
  private spawner!: MedalSpawner;
  private balls!: BallManager;
  private ballDrops = 0; // field balls that have left play (→ disc challenge)
  private pendingDisc = false;
  private save = new SaveManager();
  private store = new GameStore(this.save);
  private economy = new Economy(this.store);
  private stock = new SlotStock();
  private fever = new Fever();
  private progression!: Progression;
  private monitorUI!: MonitorUI;
  private hud!: HUD;
  private audio!: AudioManager;
  private input!: InputManager;
  private particles!: Particles;
  private burst!: MedalBurst;
  private fx!: JackpotFX;
  private fsm!: GameStateMachine;
  private cameraIndex = 0;
  private cameraPoses: CameraPose[] = [CameraRig.PLAY, CameraRig.BONUS];

  constructor(private canvas: HTMLCanvasElement) {}

  private detectTier(): QualityTier {
    const pref = this.save.get().settings.quality;
    if (pref !== 'auto') return pref;
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const cores = navigator.hardwareConcurrency ?? 4;
    if (mobile || cores <= 4) return 'medium';
    return 'high';
  }

  async start(): Promise<void> {
    this.setLoading(0.1, '描画エンジン初期化…');
    const tier = this.detectTier();
    this.engine = new Engine(this.canvas, tier);
    await this.engine.init();

    this.setLoading(0.4, '物理エンジン初期化…');
    this.physics = await PhysicsWorld.create();

    this.setLoading(0.6, '筐体構築…');
    const cabinet = new PusherCabinet(this.physics, this.engine.scene);
    this.pool = new MedalPool(this.physics, this.engine.scene);
    this.pusher = new PusherPlate(this.physics, this.engine.scene, cabinet.mats);
    this.spawner = new MedalSpawner(this.pool);
    this.balls = new BallManager(this.physics, this.engine.scene);
    new DropDetector(this.physics, this.pool);

    this.setLoading(0.8, 'UI / 演出…');
    this.hud = new HUD(this.store);
    // progression subscribes to HUD-relevant events; create AFTER the HUD so its
    // initial level/rank state paints into a live panel.
    this.progression = new Progression(this.store);
    this.monitorUI = new MonitorUI(this.engine.scene);
    new StockDisplay(this.engine.scene);
    this.audio = new AudioManager(this.save);
    this.input = new InputManager(this.canvas, () => this.engine.cameraRig.camera);
    this.particles = new Particles(this.engine.scene);
    this.burst = new MedalBurst(this.pool);
    this.fx = new JackpotFX(this.particles, this.burst, this.engine.postfx, this.engine.cameraRig);

    this.fsm = new GameStateMachine(
      this.economy,
      this.store,
      this.spawner,
      this.fx,
      this.engine.cameraRig,
      this.input,
      this.hud,
      this.fever,
      { scene: this.engine.scene, particles: this.particles, physics: this.physics }
    );

    this.wireEvents();
    this.seedField();
    this.seedBalls();
    this.setupLoop();

    this.exposeDebug();
    // on-screen developer mode (toggle with 🛠 / backtick / F2)
    new DevPanel({
      fsm: this.fsm,
      store: this.store,
      balls: this.balls,
      spawner: this.spawner,
      pool: this.pool,
    });
    this.setLoading(1, 'READY');
    setTimeout(() => this.hideLoading(), 400);
    this.loop.start();

    window.addEventListener('beforeunload', () => this.save.flush());
  }

  private wireEvents(): void {
    bus.on('input:drop', () => this.tryDrop());
    bus.on('medal:payout', () => {
      this.store.addCredits(this.fever.mult); // FEVER (internal) doubles front payouts
      bus.emit('sfx', { name: 'coin' });
    });
    bus.on('medal:fall', () => this.economy.accrue(1));
    // a coin sliding down the centre lane stocks a slot spin (once per coin, so a
    // single coin / sensor jitter can't flood the stock)
    bus.on('medal:chucker', ({ slot }) => {
      if (!this.pool.tryStock(slot)) return;
      this.stock.add();
      bus.emit('sfx', { name: 'chucker' });
    });
    // slot BALL match → eject a ball; every ball that leaves the field counts,
    // and once BALLS_PER_DISC have dropped the disc (円盤) JP challenge fires.
    bus.on('slot:ball', () => this.balls.spawn());
    bus.on('ball:dropped', () => {
      this.ballDrops++;
      const need = LAYOUT.ballsPerDisc;
      if (this.ballDrops >= need) {
        this.ballDrops = 0;
        this.pendingDisc = true;
      }
    });

    this.hud.onCameraToggle(() => {
      // release any free-camera drag and cycle the framed preset views
      this.engine.cameraRig.resetFree();
      this.cameraIndex = (this.cameraIndex + 1) % this.cameraPoses.length;
      if (this.fsm.state === 'idle') this.engine.cameraRig.setPose(this.cameraPoses[this.cameraIndex]);
    });
    this.hud.onMuteToggle(() => this.audio.toggleMute());

    // free viewpoint control (right-drag orbit / middle-drag pan / wheel zoom)
    bus.on('camera:orbit', ({ dx, dy }) => this.engine.cameraRig.orbit(dx, dy));
    bus.on('camera:pan', ({ dx, dy }) => this.engine.cameraRig.pan(dx, dy));
    bus.on('camera:zoom', ({ delta }) => this.engine.cameraRig.zoom(delta));
  }

  private tryDrop(): void {
    if (this.pool.activeCount >= LAYOUT.maxMedals) {
      return;
    }
    if (!this.store.spend(1)) {
      return;
    }
    this.economy.accrue(0.5); // a share of inserted medals funds the jackpot
    // toss the coin into the back of the upper deck at the aimed X — a parabolic
    // arc (up + back, tumbling) so it reads as being thrown in, not dropped; the
    // pusher then feeds it forward.
    const ax = Math.max(-1, Math.min(1, this.input.aimNorm)) * (LAYOUT.pusher.halfWidth - 0.5);
    this.spawner.toss(ax);
  }

  /** Seed a starting pile by dropping coins through the chute; the pusher then
   *  spreads them forward across the field. Safe (no overlap explosions) and
   *  nothing triggers immediately. */
  private seedField(count = 80): void {
    this.spawner.dispense(count, false);
  }

  /** Start with two balls, inserted from the medal/chute height like coins. */
  private seedBalls(): void {
    this.balls.spawnAt(-0.5, LAYOUT.chute.y, LAYOUT.chute.z);
    this.balls.spawnAt(0.5, LAYOUT.chute.y, LAYOUT.chute.z + 0.4);
  }

  private setupLoop(): void {
    this.loop.fixedUpdate = (dt) => {
      this.pusher.fixedUpdate(dt);
      this.spawner.fixedUpdate(dt);
      this.burst.fixedUpdate(dt);
      this.physics.step();
      this.pool.tickReclaims(dt);
      this.pool.cullOutOfBounds();
    };
    this.loop.update = (dt) => {
      this.input.update(dt);
      this.fever.update(dt);
      this.monitorUI.update(dt);
      // when idle: a pending ball→JP takes priority, else auto-play stocked spins
      if (this.fsm.state === 'idle' && !this.fsm.ignoreChuckers) {
        if (this.pendingDisc) {
          this.pendingDisc = false;
          this.fsm.requestDisc();
        } else if (this.stock.count > 0) {
          this.fsm.playSlot(this.stock.consume());
        }
      }
      this.fsm.update(dt);
      this.fx.update(dt);
      this.engine.cameraRig.update(dt);
      this.engine.postfx.update(dt);
      this.hud.update(dt);
      this.hud.setMedalCount(this.pool.activeCount);
    };
    this.loop.render = () => {
      this.pool.syncInstances();
      this.balls.update();
      this.pusher.sync();
      this.engine.render();
    };
  }

  /** Expose the `window.__medal` debug console (no-op unless ?debug is present). */
  private exposeDebug(): void {
    installDebug({
      fsm: this.fsm,
      store: this.store,
      fever: this.fever,
      monitorUI: this.monitorUI,
      pool: this.pool,
      stock: this.stock,
      economy: this.economy,
      balls: this.balls,
      pusher: this.pusher,
      rig: this.engine.cameraRig,
      fill: (n) => this.seedField(n),
    });
  }

  // --- loading screen helpers ---
  private setLoading(p: number, text: string): void {
    const fill = document.getElementById('loading-bar-fill');
    const t = document.getElementById('loading-text');
    if (fill) fill.style.width = `${Math.round(p * 100)}%`;
    if (t) t.textContent = text;
  }
  private hideLoading(): void {
    document.getElementById('loading-screen')?.classList.add('hide');
  }
}
