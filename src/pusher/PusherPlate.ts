import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { BodyTag, GROUP, groups } from '../physics/types';
import { CabinetMaterials } from '../render/materials/CabinetMaterials';
import { LAYOUT } from './layout';

/**
 * The reciprocating pusher — a deep, full-width TRAPEZOID deck. Its front is a
 * ~60° ramp connecting the upper deck (二段目) down to the lower ground (一段目);
 * coins delivered onto the deck slide down the ramp into the lane bank. The deck
 * is deep enough that its back always stays behind the back wall (it emerges from
 * beneath it), so no gap opens behind it and coins never get under/behind it.
 */
export class PusherPlate {
  readonly group = new THREE.Group();
  private body: RAPIER.RigidBody;
  private t = 0;

  /** Local-space trapezoid corner points (body frame). */
  static cornerPoints(): THREE.Vector3[] {
    const p = LAYOUT.pusher;
    const hw = p.halfWidth;
    const run = p.topY / Math.tan((p.slopeAngleDeg * Math.PI) / 180);
    const topFront = p.frontBottom - run;
    const back = -p.backDepth;
    return [
      new THREE.Vector3(-hw, 0, back),
      new THREE.Vector3(hw, 0, back),
      new THREE.Vector3(-hw, 0, p.frontBottom),
      new THREE.Vector3(hw, 0, p.frontBottom),
      new THREE.Vector3(-hw, p.topY, back),
      new THREE.Vector3(hw, p.topY, back),
      new THREE.Vector3(-hw, p.topY, topFront),
      new THREE.Vector3(hw, p.topY, topFront),
    ];
  }

  constructor(physics: PhysicsWorld, scene: THREE.Scene, mats: CabinetMaterials) {
    const p = LAYOUT.pusher;
    const desc = physics.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      0,
      0,
      p.homeZ
    );
    this.body = physics.world.createRigidBody(desc);

    const pts = PusherPlate.cornerPoints();
    const flat = new Float32Array(pts.length * 3);
    pts.forEach((v, i) => {
      flat[i * 3] = v.x;
      flat[i * 3 + 1] = v.y;
      flat[i * 3 + 2] = v.z;
    });
    const hull = physics.RAPIER.ColliderDesc.convexHull(flat);
    if (hull) {
      hull
        .setFriction(0.5)
        .setRestitution(0.0)
        .setCollisionGroups(groups(GROUP.STATIC, GROUP.MEDAL | GROUP.BALL));
      physics.registerCollider(physics.world.createCollider(hull, this.body), {
        tag: BodyTag.Pusher,
      });
    }

    // visual trapezoid deck
    const geo = new ConvexGeometry(pts);
    geo.computeVertexNormals();
    const deck = new THREE.Mesh(geo, mats.pusher);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.group.add(deck);

    // glowing trim along the top-front edge of the ramp
    const run = p.topY / Math.tan((p.slopeAngleDeg * Math.PI) / 180);
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(p.halfWidth * 2, 0.05, 0.05),
      mats.accent
    );
    trim.position.set(0, p.topY, p.frontBottom - run);
    this.group.add(trim);

    this.buildSlotLane(physics, mats);

    scene.add(this.group);
  }

  /** The slot lane: TWO divider walls forming a centre lane on the ramp, plus a
   *  trigger sensor between them. A coin sliding down between the walls starts the
   *  slot. Part of the moving deck. */
  private buildSlotLane(physics: PhysicsWorld, mats: CabinetMaterials): void {
    const sl = LAYOUT.slotLane;
    const R = physics.RAPIER;

    // two divider walls (left & right of the centre lane)
    for (const sx of [-1, 1]) {
      const wallCol = R.ColliderDesc.cuboid(sl.wallThickness / 2, sl.wallHeight / 2, sl.zDepth / 2)
        .setTranslation(sx * sl.xHalf, sl.wallHeight / 2, sl.zLocal)
        .setFriction(0.4)
        .setCollisionGroups(groups(GROUP.STATIC, GROUP.MEDAL | GROUP.BALL));
      physics.registerCollider(physics.world.createCollider(wallCol, this.body), {
        tag: BodyTag.Pusher,
      });
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(sl.wallThickness, sl.wallHeight, sl.zDepth),
        mats.chrome
      );
      wall.position.set(sx * sl.xHalf, sl.wallHeight / 2, sl.zLocal);
      wall.castShadow = true;
      this.group.add(wall);
      // neon edge on top of each wall
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(sl.wallThickness + 0.02, 0.04, sl.zDepth),
        mats.neonBlue
      );
      edge.position.set(sx * sl.xHalf, sl.wallHeight, sl.zLocal);
      this.group.add(edge);
    }

    // trigger sensor between the walls — a COIN sliding through starts the slot.
    // Balls are excluded (MEDAL only): a ball must roll to the FRONT, not be caught
    // here, so the centre lane never consumes it.
    const sensor = R.ColliderDesc.cuboid(sl.xHalf - 0.02, 0.3, sl.zDepth / 2)
      .setTranslation(0, sl.sensorY, sl.zLocal)
      .setSensor(true)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(groups(GROUP.SENSOR, GROUP.MEDAL));
    physics.registerCollider(physics.world.createCollider(sensor, this.body), {
      tag: BodyTag.Chucker,
      id: 0,
    });

    // glowing floor strip marking the slot lane
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(sl.xHalf * 2 - 0.04, 0.02, sl.zDepth),
      mats.neonPink
    );
    glow.position.set(0, 0.06, sl.zLocal);
    this.group.add(glow);
  }

  /** Current world-space Z of the deck. */
  deckZ(): number {
    return this.body.translation().z;
  }

  fixedUpdate(dt: number): void {
    const p = LAYOUT.pusher;
    this.t += dt;
    const z = p.homeZ + Math.sin(this.t * p.speed) * p.amplitude;
    this.body.setNextKinematicTranslation({ x: 0, y: 0, z });
  }

  /** sync visual to physics each render frame */
  sync(): void {
    const tr = this.body.translation();
    this.group.position.set(tr.x, tr.y, tr.z);
  }
}
