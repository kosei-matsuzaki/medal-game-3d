import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DT } from '../core/Time';
import { BodyTag, ColliderInfo } from './types';

export type RBody = RAPIER.RigidBody;
export type RCollider = RAPIER.Collider;

/** Sensor intersection callback signature. */
export type IntersectionListener = (
  a: ColliderInfo,
  b: ColliderInfo,
  started: boolean
) => void;

/**
 * Thin wrapper around the Rapier world: stepping, collider metadata registry,
 * and sensor/collision event dispatch. RAPIER.init() must be awaited before
 * constructing.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly RAPIER = RAPIER;
  private events: RAPIER.EventQueue;
  private info = new Map<number, ColliderInfo>();
  private listeners = new Set<IntersectionListener>();

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    this.world.integrationParameters.numSolverIterations = 4;
    this.events = new RAPIER.EventQueue(true);
  }

  registerCollider(collider: RCollider, info: ColliderInfo): void {
    this.info.set(collider.handle, info);
  }

  unregisterCollider(collider: RCollider): void {
    this.info.delete(collider.handle);
  }

  onIntersection(listener: IntersectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  step(): void {
    this.world.step(this.events);
    this.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.lookup(h1);
      const b = this.lookup(h2);
      if (!a || !b) return;
      for (const l of this.listeners) l(a, b, started);
    });
  }

  private lookup(handle: number): ColliderInfo | undefined {
    return this.info.get(handle);
  }

  removeBody(body: RBody): void {
    // unregister all colliders attached to this body
    for (let i = 0; i < body.numColliders(); i++) {
      const c = body.collider(i);
      this.info.delete(c.handle);
    }
    this.world.removeRigidBody(body);
  }
}

export { BodyTag };
