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
  /** Run of the ramp in z, i.e. how far back the slope travels to reach the top. */
  static rampRun(): number {
    const p = LAYOUT.pusher;
    return (p.topY - p.faceHeight) / Math.tan((p.slopeAngleDeg * Math.PI) / 180);
  }

  static cornerPoints(): THREE.Vector3[] {
    const p = LAYOUT.pusher;
    const hw = p.halfWidth;
    const topFront = p.frontBottom - PusherPlate.rampRun();
    const back = -p.backDepth;
    return [
      // bottom slab
      new THREE.Vector3(-hw, 0, back),
      new THREE.Vector3(hw, 0, back),
      new THREE.Vector3(-hw, 0, p.frontBottom),
      new THREE.Vector3(hw, 0, p.frontBottom),
      // TOP OF THE VERTICAL PUSHING FACE — this is the edge that actually shoves
      // the coins lying on the lower table. Without it the ramp tapers to nothing
      // at floor level and rides straight over them.
      new THREE.Vector3(-hw, p.faceHeight, p.frontBottom),
      new THREE.Vector3(hw, p.faceHeight, p.frontBottom),
      // deck top
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
    const run = PusherPlate.rampRun();
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(p.halfWidth * 2, 0.05, 0.05),
      mats.accent
    );
    trim.position.set(0, p.topY, p.frontBottom - run);
    this.group.add(trim);

    // and a line along the top of the vertical face, so the edge that does the
    // pushing is visible against the coin bank
    const faceTrim = new THREE.Mesh(
      new THREE.BoxGeometry(p.halfWidth * 2, 0.04, 0.04),
      mats.accent
    );
    faceTrim.position.set(0, p.faceHeight, p.frontBottom);
    this.group.add(faceTrim);

    scene.add(this.group);
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
