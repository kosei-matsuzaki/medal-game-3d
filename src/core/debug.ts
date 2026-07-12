import { bus } from './EventBus';
import { LAYOUT } from '../pusher/layout';
import { GameStateMachine } from '../state/GameStateMachine';
import { GameStore } from '../state/GameStore';
import { Fever } from '../state/Fever';
import { MonitorUI } from '../ui/MonitorUI';
import { MedalPool } from '../pusher/MedalPool';
import { SlotStock } from '../state/SlotStock';
import { Economy } from '../state/Economy';
import { BallManager } from '../pusher/BallManager';
import { PusherPlate } from '../pusher/PusherPlate';
import { CameraRig } from '../camera/CameraRig';

/** Systems the debug console pokes at. Supplied by Game once everything is built. */
export interface DebugDeps {
  fsm: GameStateMachine;
  store: GameStore;
  fever: Fever;
  monitorUI: MonitorUI;
  pool: MedalPool;
  stock: SlotStock;
  economy: Economy;
  balls: BallManager;
  pusher: PusherPlate;
  rig: CameraRig;
  /** seed n medals into the field (Game.seedField). */
  fill: (n: number) => void;
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
    force: (kind: 'slot' | 'disc' | 'jackpot') => d.fsm.forceEnter(kind),
    level: () => ({ level: d.store.level, exp: d.store.exp }),
    addExp: (n: number) => d.store.addCredits(n),
    fever: () => d.fever.debugActivate(),
    feverMult: () => d.fever.mult,
    feverOnMonitor: () => d.monitorUI.feverShown,
    disc: () => d.store.discFilled,
    fillDiscHole: (i: number) => d.store.fillDiscHole(i),
    resetDisc: () => d.store.resetDisc(),
    dropBalls: (n = LAYOUT.ballsPerDisc) => {
      for (let i = 0; i < n; i++) bus.emit('ball:dropped', {});
    },
    addJackpot: (n: number) => d.store.addToJackpot(n),
    addCredits: (n: number) => d.store.addCredits(n),
    activeMedals: () => d.pool.activeCount,
    maxMedals: () => LAYOUT.maxMedals,
    pauseChuckers: (v: boolean) => (d.fsm.ignoreChuckers = v),
    clearMedals: () => d.pool.drainAll(),
    stats: () => d.pool.debugStats(),
    stock: () => d.stock.slots.slice(),
    addStock: (n: number) => {
      for (let i = 0; i < n; i++) d.stock.add();
    },
    roll: () => d.economy.slotRoll(),
    rollFever: () => d.economy.slotRoll(true),
    spawnBall: () => d.balls.spawn(),
    ballCount: () => d.balls.activeCount(),
    spawnBallAtLane: () => d.balls.spawnAt(0, 1.3, d.pusher.deckZ() + LAYOUT.slotLane.zLocal),
    spawnBallAt: (x: number, y: number, z: number) => d.balls.spawnAt(x, y, z),
    fill: (n: number) => d.fill(n),
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
