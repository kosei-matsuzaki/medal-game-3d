/** Typed pub/sub event bus shared across all systems. */

// type-only imports — erased at runtime, so no import cycle with the bus
import type { GameState } from '../state/GameStateMachine';
import type { MiniGameKind } from '../state/Economy';

export type GameEvents = {
  // physics → game
  'medal:payout': { count: number };
  'medal:fall': { count: number };
  // economy / store
  'credits:changed': { credits: number; delta: number };
  'jackpot:changed': { pool: number };
  'jackpot:won': { amount: number };
  // smoothed pool figure for the cabinet monitor (the HUD no longer shows it)
  'jackpot:display': { amount: number };
  // state machine
  'state:changed': { from: GameState; to: GameState };
  // minigame
  'minigame:start': { kind: MiniGameKind };
  'minigame:result': { kind: MiniGameKind; payout: number };
  // すごろく board: the piece moved / journey state changed
  'board:changed': {
    pos: number;
    toGoal: number;
    runs: number;
    twice: boolean;
    pick: boolean;
    boost: boolean;
  };
  // the throw is about to carry the piece onto the GOAL — drives the monitor's
  // tension reaction
  'board:near': { toGoal: number; big: boolean };
  // a spin resolved (drives the monitor reaction FX)
  'board:outcome': { kind: 'bigwin' | 'win' | 'near' | 'miss' };
  // turns earned but not yet played. Cubes can pile into the tray faster than
  // the board can work through them, and a queue the player cannot see reads as
  // the machine having swallowed their cube.
  'board:stock': { pending: number };
  // mini cube reached the payout tray — earns one board turn
  'ball:scored': {};
  // mini ball went down a side hole / out of bounds — lost, no spin
  'ball:lost': {};
  // progression
  'exp:changed': { level: number; exp: number; need: number; rank: string };
  'level:up': { level: number; rank: string; bonus: number };
  // FEVER (internal mechanic) turned on/off — for the on-screen indicator
  'fever:changed': { active: boolean };
  // fx requests
  'fx:burst': { count: number; jackpot?: boolean };
  'fx:shake': { intensity: number; duration: number };
  'fx:flash': { color?: number; bloom?: number };
  // input / ui
  'input:drop': { x: number };
  // free camera control (right-drag orbit / wheel zoom / middle-drag pan)
  'camera:orbit': { dx: number; dy: number };
  'camera:zoom': { delta: number };
  'camera:pan': { dx: number; dy: number };
  'ui:message': { text: string; duration?: number };
  // audio
  'sfx': { name: string };
};

type Handler<T> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  off<K extends keyof GameEvents>(type: K, handler: Handler<GameEvents[K]>): void {
    this.listeners.get(type)?.delete(handler);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const h of set) h(payload);
  }
}

/** Global bus instance. */
export const bus = new EventBus();
