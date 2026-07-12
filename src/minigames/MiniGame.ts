import * as THREE from 'three';
import { Economy, FeverAction } from '../state/Economy';
import { GameStore } from '../state/GameStore';
import { CameraRig } from '../camera/CameraRig';
import { Particles } from '../fx/Particles';
import { HUD } from '../ui/HUD';
import { InputManager } from '../input/InputManager';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Fever } from '../state/Fever';

export interface MiniGameResult {
  payout: number;
  jackpot?: boolean;
  jackpotMult?: number; // JP drop stage — multiplies the awarded progressive jackpot
  bonus?: 'jackpot'; // disc JP-Chance → chain into the dedicated JP (jackpot) stage
  ball?: boolean; // slot BALL match → eject a ball (→ disc challenge)
  feverAction?: FeverAction; // slot only — drives the internal FEVER state
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
}

export interface MiniGame {
  readonly kind: string;
  /** show & begin; resolve when fully finished (including result display). */
  start(ctx: MiniGameContext, onDone: (r: MiniGameResult) => void): void;
  update(dt: number): void;
  /** hide & clean up transient state (called on exit). */
  stop(): void;
}
