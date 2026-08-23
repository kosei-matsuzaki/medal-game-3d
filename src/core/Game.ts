import { Engine } from './Engine';
import { Loop } from './Loop';
import { bus } from './EventBus';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PusherCabinet } from '../pusher/PusherCabinet';
import { PusherPlate } from '../pusher/PusherPlate';
import { MedalPool } from '../pusher/MedalPool';
import { MedalSpawner } from '../pusher/MedalSpawner';
import { DropDetector } from '../pusher/DropDetector';
import { MiniBallManager } from '../pusher/MiniBallManager';
import { LAYOUT } from '../pusher/layout';
import { SaveManager } from '../save/SaveManager';
import { GameStore } from '../state/GameStore';
import { Economy } from '../state/Economy';
import { Progression } from '../state/Progression';
import { Fever } from '../state/Fever';
import { Board } from '../state/Board';
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
  private balls!: MiniBallManager;
  /** medals inserted since the last mini ball came out of the hopper */
  private sinceBall = 0;
  /** board turns earned but not yet played (a ball can land mid-turn) */
  private pendingSpins = 0;
  private save = new SaveManager();
  private store = new GameStore(this.save);
  private economy = new Economy(this.store);
  private board = new Board(this.save);
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
    this.balls = new MiniBallManager(this.physics, this.engine.scene);
    new DropDetector(this.physics, this.pool);

    this.setLoading(0.8, 'UI / 演出…');
    this.hud = new HUD(this.store);
    // progression subscribes to HUD-relevant events; create AFTER the HUD so its
    // initial level/rank state paints into a live panel.
    this.progression = new Progression(this.store);
    this.monitorUI = new MonitorUI(this.engine.scene);
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
      this.board,
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
      board: this.board,
    });
    this.setLoading(1, 'READY');
    setTimeout(() => this.hideLoading(), 400);
    this.loop.start();

    window.addEventListener('beforeunload', () => this.save.flush());
  }

  private wireEvents(): void {
    bus.on('input:drop', () => this.tryDrop());
    bus.on('medal:payout', () => {
      // ALWAYS 1 credit per medal. FEVER deliberately does NOT apply here: paying
      // 2 for a medal that cost 1 makes the pusher itself profitable, and the
      // player can then farm it by inserting alone. FEVER doubles BOARD winnings
      // instead (see GameStateMachine.onResult), which is where a multiplier
      // belongs — on what the machine gives you, not on your own medals.
      this.store.addCredits(1);
      bus.emit('sfx', { name: 'coin' });
    });
    bus.on('medal:fall', () => this.economy.fundFromLoss(1));
    // A mini ball that reaches the payout tray earns exactly one board turn. It is
    // queued rather than played immediately, because a second ball can easily land
    // while the first turn is still on screen.
    bus.on('ball:scored', () => {
      this.pendingSpins++;
      bus.emit('board:stock', { pending: this.pendingSpins });
      bus.emit('sfx', { name: 'chucker' });
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

  /** Insert one medal. Returns false if the field is full or credit ran out. */
  private tryDrop(): boolean {
    if (this.pool.activeCount >= LAYOUT.maxMedals) {
      return false;
    }
    if (!this.store.spend(1)) {
      return false;
    }
    this.economy.fundFromInsert(); // a slice of every insert funds the jackpot
    // toss the coin into the back of the upper deck at the aimed X — a parabolic
    // arc (up + back, tumbling) so it reads as being thrown in, not dropped; the
    // pusher then feeds it forward.
    const ax = Math.max(-1, Math.min(1, this.input.aimNorm)) * (LAYOUT.pusher.halfWidth - 0.5);
    this.spawner.toss(ax);

    // Every `medalsPerBall` inserted medals, the hopper drops a mini ball. This is
    // the ONLY route to a board turn, so board frequency is tied directly to how
    // much the player has fed the machine.
    if (++this.sinceBall >= LAYOUT.medalsPerBall) {
      this.sinceBall = 0;
      this.balls.dispense();
    }
    return true;
  }

  /** Seed a starting pile by dropping coins through the chute; the pusher then
   *  spreads them forward across the field. Safe (no overlap explosions) and
   *  nothing triggers immediately. */
  private seedField(count = 80): void {
    this.spawner.dispense(count, false);
  }

  /** Start with a couple of mini balls so a fresh session has something to chase. */
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
    // Split so turbo can run the LOGIC without the PRESENTATION. Everything that
    // changes game state lives in `logic`; everything that only exists to be
    // looked at lives in `present`. Normal play runs both, every frame.
    const logic = (dt: number) => {
      this.input.update(dt);
      this.fever.update(dt);
      // when idle: play the next earned board turn
      if (this.fsm.state === 'idle' && this.pendingSpins > 0 && !this.fsm.ignoreChuckers) {
        if (this.fsm.playSpin()) {
          this.pendingSpins--;
          bus.emit('board:stock', { pending: this.pendingSpins });
        }
      }
      this.fsm.update(dt);
    };
    const present = (dt: number) => {
      this.monitorUI.update(dt);
      this.fx.update(dt);
      this.engine.cameraRig.update(dt);
      this.engine.postfx.update(dt);
      this.hud.update(dt);
      this.hud.setMedalCount(this.pool.activeCount);
    };
    this.loop.update = (dt) => {
      logic(dt);
      present(dt);
    };
    this.loop.turboUpdate = logic;
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
      loop: this.loop,
      fsm: this.fsm,
      store: this.store,
      fever: this.fever,
      monitorUI: this.monitorUI,
      pool: this.pool,
      board: this.board,
      economy: this.economy,
      balls: this.balls,
      pusher: this.pusher,
      rig: this.engine.cameraRig,
      fill: (n) => this.seedField(n),
      insert: () => this.tryDrop(),
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
