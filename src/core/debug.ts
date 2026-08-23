import { bus } from './EventBus';
import { LAYOUT } from '../pusher/layout';
import { GameStateMachine } from '../state/GameStateMachine';
import { GameStore } from '../state/GameStore';
import { Fever } from '../state/Fever';
import { MonitorUI } from '../ui/MonitorUI';
import { MedalPool } from '../pusher/MedalPool';
import { Economy } from '../state/Economy';
import { Board } from '../state/Board';
import { MiniBallManager } from '../pusher/MiniBallManager';
import { PusherPlate } from '../pusher/PusherPlate';
import { CameraRig } from '../camera/CameraRig';
import { Loop } from './Loop';
import { FIXED_DT } from './Time';

/** Systems the debug console pokes at. Supplied by Game once everything is built. */
export interface DebugDeps {
  /** the fixed-timestep loop, so tests can fast-forward game time */
  loop: Loop;
  fsm: GameStateMachine;
  store: GameStore;
  fever: Fever;
  monitorUI: MonitorUI;
  pool: MedalPool;
  board: Board;
  economy: Economy;
  balls: MiniBallManager;
  pusher: PusherPlate;
  rig: CameraRig;
  /** seed n medals into the field (Game.seedField). */
  fill: (n: number) => void;
  /** insert ONE medal exactly as a player would; false if it could not be taken */
  insert: () => boolean;
}

/**
 * Install the `window.__medal` debug console (only when the URL has `?debug`).
 * Kept out of Game.ts so the orchestrator stays focused on wiring, and so the
 * Playwright tests have one documented surface to drive.
 */
export function installDebug(d: DebugDeps): void {
  if (!location.search.includes('debug')) return;
  (window as Window & { __medal?: object }).__medal = {
    state: () => d.fsm.state,
    force: (kind: 'sugoroku' | 'bowl' | 'chinchiro') => d.fsm.forceEnter(kind),
    chin: () => d.fsm.debugChinchiro(),
    /**
     * Fast-forward: run n extra physics+logic steps per frame and stop drawing.
     * n=0 restores normal play. Measurement only — the simulation is unchanged,
     * it just runs without waiting for a rasterizer that is 100× slower than the
     * physics it is there to display.
     */
    turbo: (n = 0) => {
      d.loop.turbo = Math.max(0, Math.min(400, n | 0));
      return d.loop.turbo;
    },
    /**
     * Advance the simulation by `seconds` immediately, without waiting for
     * frames. Returns the new total game time. This is how the measurement tests
     * buy game time — a headless browser caps requestAnimationFrame at about
     * 1fps, so anything that waits for frames measures the scheduler, not the
     * machine.
     */
    simulate: (seconds: number) => d.loop.runSteps(Math.round(seconds / FIXED_DT)),
    /** Total SIMULATED seconds so far — advances with the physics, not the clock. */
    gameSeconds: () => d.loop.gameTime,
    level: () => ({ level: d.store.level, exp: d.store.exp }),
    addExp: (n: number) => d.store.addCredits(n),
    fever: () => d.fever.debugActivate(),
    feverMult: () => d.fever.mult,
    feverOnMonitor: () => d.monitorUI.feverShown,
    /** Earn n board turns without physically working balls to the front. */
    spin: (n = 1) => {
      for (let i = 0; i < n; i++) bus.emit('ball:scored', {});
    },
    addJackpot: (n: number) => d.store.addToJackpot(n),
    addCredits: (n: number) => d.store.addCredits(n),
    activeMedals: () => d.pool.activeCount,
    maxMedals: () => LAYOUT.maxMedals,
    pauseChuckers: (v: boolean) => (d.fsm.ignoreChuckers = v),
    clearMedals: () => d.pool.drainAll(),
    stats: () => d.pool.debugStats(),
    board: () => ({
      pos: d.board.pos,
      toGoal: d.board.toGoal,
      runs: d.board.runs,
      pending: { ...d.board.pending },
    }),
    boardPos: (i: number) => d.board.debugSetPos(i),
    goalNear: () => d.board.debugGoalNear(),
    roll: () => d.economy.roll(),
    spawnBall: () => d.balls.dispense(),
    ballCount: () => d.balls.activeCount(),
    spawnBallAt: (x: number, y: number, z: number) => d.balls.spawnAt(x, y, z),
    fill: (n: number) => d.fill(n),
    insert: () => d.insert(),
    credits: () => d.store.credits,
    // free camera: current position + whether the user has grabbed the view
    cam: () => {
      const p = d.rig.camera.position;
      return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), free: d.rig.isFree };
    },
    resetCam: () => d.rig.resetFree(),
    // test hook: subscribe to any bus event (returns an unsubscribe fn)
    on: (type: string, cb: (p: unknown) => void) => bus.on(type as never, cb as never),
  };
}
