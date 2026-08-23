import * as THREE from 'three';
import { Economy, FeverAction } from '../state/Economy';
import { GameStore } from '../state/GameStore';
import { CameraRig } from '../camera/CameraRig';
import { Particles } from '../fx/Particles';
import { HUD } from '../ui/HUD';
import { InputManager } from '../input/InputManager';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Fever } from '../state/Fever';
import { Board } from '../state/Board';

export interface MiniGameResult {
  /** medals PHYSICALLY dispensed onto the field (not credited directly) */
  payout: number;
  /** medals taken back off the player's credit (赤マス) */
  taken?: number;
  /** medals added straight to the progressive pool (JPアップマス) */
  jpAdd?: number;
  jackpot?: boolean;
  jackpotMult?: number; // JP drop stage — multiplies the awarded progressive jackpot
  /** chain into another stage: 目的地到着 → 'station' (disc), JP-Chance → 'jackpot' */
  bonus?: 'jackpot' | 'station';
  feverAction?: FeverAction; // board only — drives the internal FEVER state
  label: string;
}

export interface MiniGameContext {
  scene: THREE.Scene;
  camera: CameraRig;
  economy: Economy;
  store: GameStore;
  particles: Particles;
  hud: HUD;
  input: InputManager;
  physics: PhysicsWorld;
  fever: Fever;
  board: Board;
}

export interface MiniGame {
  readonly kind: string;
  /** show & begin; resolve when fully finished (including result display). */
  start(ctx: MiniGameContext, onDone: (r: MiniGameResult) => void): void;
  update(dt: number): void;
  /** hide & clean up transient state (called on exit). */
  stop(): void;
}
