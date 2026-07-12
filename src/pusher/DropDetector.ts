import { PhysicsWorld } from '../physics/PhysicsWorld';
import { BodyTag, ColliderInfo } from '../physics/types';
import { MedalPool } from './MedalPool';
import { LAYOUT } from './layout';
import { bus } from '../core/EventBus';

/**
 * Routes sensor intersections to game events. A medal entering the payout slot
 * credits the player; entering a chucker triggers a minigame; falling out is a
 * loss. The medal is reclaimed to the pool in every case.
 */
export class DropDetector {
  private dispose: () => void;

  constructor(physics: PhysicsWorld, private pool: MedalPool) {
    this.dispose = physics.onIntersection((a, b, started) => {
      if (!started) return;
      const medal = a.tag === BodyTag.Medal ? a : b.tag === BodyTag.Medal ? b : null;
      const sensor = a.tag === BodyTag.Medal ? b : a;
      if (!medal || medal.slot === undefined) return;
      if (!this.pool.isActive(medal.slot)) return;
      this.handle(sensor, medal.slot);
    });
  }

  private handle(sensor: ColliderInfo, slot: number): void {
    switch (sensor.tag) {
      case BodyTag.Payout:
        // credit immediately, but let the coin rest in the bin so the player sees
        // it land and get collected before it's cleared.
        bus.emit('medal:payout', { count: 1 });
        this.pool.scheduleReclaim(slot, LAYOUT.frontPayout.collectDelay);
        break;
      case BodyTag.FallHole:
        this.pool.reclaim(slot);
        bus.emit('medal:fall', { count: 1 });
        break;
      case BodyTag.Chucker:
        // coin slid down the slot lane — stock a spin; the coin continues
        bus.emit('medal:chucker', { id: sensor.id ?? 0, slot });
        break;
      default:
        break;
    }
  }

  destroy(): void {
    this.dispose();
  }
}
