import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { BodyTag, GROUP, groups } from '../physics/types';
import { LAYOUT } from './layout';
import { bus } from '../core/EventBus';

interface Ball {
  id: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  alive: boolean;
}

/**
 * Special balls (from a slot BALL match). A ball is ejected onto the field; if it
 * reaches the centre slot lane it starts the JP challenge. Distinct from medals.
 */
export class BallManager {
  private balls: Ball[] = [];
  private nextId = 0;
  private mat: THREE.MeshStandardMaterial;

  constructor(private physics: PhysicsWorld, private scene: THREE.Scene) {
    // orange faceted soccer-ball (shape from makeSoccerGeometry; flat-shaded facets)
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xff8a2c,
      emissive: 0xff6a10,
      emissiveIntensity: 1.4,
      metalness: 0.3,
      roughness: 0.3,
      flatShading: true,
    });

    this.physics.onIntersection((a, b, started) => {
      if (!started) return;
      const ballInfo = a.tag === BodyTag.Ball ? a : b.tag === BodyTag.Ball ? b : null;
      const sensor = a.tag === BodyTag.Ball ? b : a;
      if (!ballInfo || ballInfo.id === undefined) return;
      const ball = this.balls.find((x) => x.alive && x.id === ballInfo.id);
      if (!ball) return;
      // the centre-lane chucker is the COIN slot trigger ONLY — a ball ignores it
      // and must roll all the way to the FRONT (payout / fall hole) to count.
      if (sensor.tag === BodyTag.Payout || sensor.tag === BodyTag.FallHole) {
        this.drop(ball);
      }
    });
  }

  /** Soccer-ball shape: a subdivided icosahedron (faceted sphere). Its own vertices
   *  also seed the convex-hull collider. */
  private makeSoccerGeometry(r: number): THREE.IcosahedronGeometry {
    return new THREE.IcosahedronGeometry(r, 1);
  }

  /** Eject a ball onto the back of the deck (centre-ish) so it rolls forward.
   *  No field cap — balls accumulate until they roll off the front. */
  spawn(): void {
    this.spawnAt((Math.random() - 0.5) * 0.4, LAYOUT.chute.y, LAYOUT.chute.z);
  }

  activeCount(): number {
    let n = 0;
    for (const b of this.balls) if (b.alive) n++;
    return n;
  }

  spawnAt(x: number, y: number, z: number): void {
    const R = this.physics.RAPIER;
    const r = LAYOUT.ball.radius;
    const id = this.nextId++;
    // a faceted soccer ball (icosphere convex hull) with moderate damping/friction
    // so it rolls/tumbles forward and gets shoved by the pusher like the coins.
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinvel(0, -0.3, 0.1)
        .setLinearDamping(0.12)
        // moderate (not extreme) — the flat faces already curb rolling; too much
        // damping strands a lone ball on the flat lower field and stalls progress.
        .setAngularDamping(0.8)
        .setCcdEnabled(true)
    );
    const geo = this.makeSoccerGeometry(r);
    // build the collider from the ball's own vertices (convex hull)
    const verts = geo.attributes.position.array as Float32Array;
    const cd = (R.ColliderDesc.convexHull(verts) ?? R.ColliderDesc.ball(r))
      .setDensity(2.2)
      .setRestitution(0.02)
      .setFriction(0.5)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      // include BALL in the filter so balls collide with EACH OTHER (no overlap)
      .setCollisionGroups(groups(GROUP.BALL, GROUP.STATIC | GROUP.MEDAL | GROUP.BALL | GROUP.SENSOR));
    const collider = this.physics.world.createCollider(cd, body);
    this.physics.registerCollider(collider, { tag: BodyTag.Ball, id });

    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.balls.push({ id, body, collider, mesh, alive: true });
  }

  /** A ball left the field for good → count it toward the disc challenge. */
  private drop(ball: Ball): void {
    if (!ball.alive) return;
    bus.emit('ball:lost', {});
    bus.emit('ball:dropped', {});
    this.remove(ball);
  }

  private remove(ball: Ball): void {
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
      if (t.y < LAYOUT.killY) {
        this.drop(ball);
      }
    }
    this.balls = this.balls.filter((b) => b.alive);
  }
}
