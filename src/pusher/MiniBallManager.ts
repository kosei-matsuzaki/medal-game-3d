import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { dieMaterials } from '../render/dieFaces';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { BodyTag, GROUP, groups } from '../physics/types';
import { LAYOUT } from './layout';
import { bus } from '../core/EventBus';

interface MiniBall {
  id: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  alive: boolean;
}

/**
 * Mini cubes (ミニキューブ) — the board's only fuel, shaped like the dice they buy.
 *
 * The hopper drops one every `LAYOUT.medalsPerBall` medals the player inserts.
 * From there it is an ordinary physics object: the pusher shoves it across the
 * field along with the coins. Where it leaves decides everything —
 *
 *   off the FRONT edge  → `ball:scored` → one すごろく spin
 *   into a SIDE hole    → `ball:lost`   → nothing, same as a lost coin
 *
 * There is no sensor lane and no automatic trigger: the player earns each spin by
 * physically working a ball to the front, which is the whole point of a pusher.
 */
export class MiniBallManager {
  private balls: MiniBall[] = [];
  private nextId = 0;
  private mats: THREE.MeshStandardMaterial[];

  constructor(private physics: PhysicsWorld, private scene: THREE.Scene) {
    this.mats = dieMaterials(0.12);

    this.physics.onIntersection((a, b, started) => {
      if (!started) return;
      const info = a.tag === BodyTag.Ball ? a : b.tag === BodyTag.Ball ? b : null;
      const sensor = a.tag === BodyTag.Ball ? b : a;
      if (!info || info.id === undefined) return;
      const ball = this.balls.find((x) => x.alive && x.id === info.id);
      if (!ball) return;
      if (sensor.tag === BodyTag.Payout) this.score(ball);
      else if (sensor.tag === BodyTag.FallHole) this.lose(ball);
    });
  }

  /** A heavily filleted cube — close enough to a ball to roll freely, but with
   *  flat faces big enough to read the pips on. */
  private makeGeometry(a: number): THREE.BufferGeometry {
    return new RoundedBoxGeometry(a, a, a, 4, LAYOUT.miniBall.round);
  }

  /** Drop one ball from the hopper onto the back of the deck. */
  dispense(): void {
    this.spawnAt((Math.random() - 0.5) * 0.6, LAYOUT.chute.y, LAYOUT.chute.z);
    bus.emit('sfx', { name: 'chucker' });
  }

  activeCount(): number {
    let n = 0;
    for (const b of this.balls) if (b.alive) n++;
    return n;
  }

  spawnAt(x: number, y: number, z: number): void {
    const R = this.physics.RAPIER;
    const a = LAYOUT.miniBall.size;
    const id = this.nextId++;
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinvel(0, -0.3, 0.1)
        .setLinearDamping(0.12)
        // enough angular damping that it travels with the coin bank instead of
        // outrunning it, but not so much that a lone ball stalls on the flat field
        .setAngularDamping(0.55)
        .setCcdEnabled(true)
    );
    const geo = this.makeGeometry(a);
    // roundCuboid's half-extents EXCLUDE the border radius, so the total edge is
    // 2*(half + round) — keep them in step with the mesh or the die will look
    // like it is floating above whatever it rests on.
    const rr = LAYOUT.miniBall.round;
    const cd = R.ColliderDesc.roundCuboid(a / 2 - rr, a / 2 - rr, a / 2 - rr, rr)
      .setDensity(3.6)
      .setRestitution(0.02)
      .setFriction(0.5)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(groups(GROUP.BALL, GROUP.STATIC | GROUP.MEDAL | GROUP.BALL | GROUP.SENSOR));
    const collider = this.physics.world.createCollider(cd, body);
    this.physics.registerCollider(collider, { tag: BodyTag.Ball, id });

    const mesh = new THREE.Mesh(geo, this.mats);
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.balls.push({ id, body, collider, mesh, alive: true });
  }

  /** Reached the payout tray — the player earns a board spin. */
  private score(ball: MiniBall): void {
    if (!ball.alive) return;
    bus.emit('ball:scored', {});
    this.remove(ball);
  }

  /** Down a side hole (or out of bounds) — gone, with nothing to show for it. */
  private lose(ball: MiniBall): void {
    if (!ball.alive) return;
    bus.emit('ball:lost', {});
    this.remove(ball);
  }

  private remove(ball: MiniBall): void {
    ball.alive = false;
    this.physics.removeBody(ball.body);
    this.scene.remove(ball.mesh);
    ball.mesh.geometry.dispose();
  }

  /** Sync meshes & cull fallen balls. Call each render frame. */
  update(): void {
    for (const ball of this.balls) {
      if (!ball.alive) continue;
      const t = ball.body.translation();
      ball.mesh.position.set(t.x, t.y, t.z);
      const q = ball.body.rotation();
      ball.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (t.y < LAYOUT.killY) this.lose(ball);
    }
    this.balls = this.balls.filter((b) => b.alive);
  }
}
