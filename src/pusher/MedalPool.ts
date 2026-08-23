import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { BodyTag, GROUP, groups } from '../physics/types';
import { createMedalMaterials } from '../render/materials/MedalMaterial';
import { LAYOUT } from './layout';

interface Slot {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  active: boolean;
  jackpot: boolean;
  stocked: boolean; // already counted toward the slot stock (once per life)
  collectIn: number; // >0: credited, resting in the payout bin; reclaim when it hits 0
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Object pool of medals. All medals are rendered via two InstancedMeshes
 * (standard + emissive jackpot) for a single draw call each; physics drives the
 * transforms. Reclaimed medals are parked and reused — no runtime allocation.
 */
export class MedalPool {
  readonly capacity: number;
  private slots: Slot[] = [];
  private free: number[] = [];
  private standardMesh: THREE.InstancedMesh;
  private jackpotMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private quat = new THREE.Quaternion();
  activeCount = 0;

  constructor(private physics: PhysicsWorld, scene: THREE.Scene, capacity = 560) {
    this.capacity = capacity;
    const mats = createMedalMaterials();
    const geo = new THREE.CylinderGeometry(
      LAYOUT.medal.radius,
      LAYOUT.medal.radius,
      LAYOUT.medal.height,
      // 40, not 28: at this radius a 28-gon silhouette is visibly faceted when a
      // coin stands on edge, and a faceted rim undoes the milled-edge texture.
      40
    );

    this.standardMesh = new THREE.InstancedMesh(geo, mats.standard, capacity);
    this.jackpotMesh = new THREE.InstancedMesh(geo, mats.jackpot, capacity);
    for (const m of [this.standardMesh, this.jackpotMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }

    for (let i = 0; i < capacity; i++) {
      this.slots.push(this.makeSlot());
      this.free.push(i);
      this.standardMesh.setMatrixAt(i, HIDDEN);
      this.jackpotMesh.setMatrixAt(i, HIDDEN);
    }
  }

  private makeSlot(): Slot {
    const R = this.physics.RAPIER;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(0, -100, 0) // parked far below
      .setCanSleep(true)
      .setLinearDamping(0.15)
      .setAngularDamping(0.6)
      // CCD OFF: medals are thick & slow, so tunnelling risk is low and the
      // cullOutOfBounds safety net catches any escapee. CCD is per-body/per-step
      // and dominates cost at high medal counts — disabling it removes the lag
      // cliff without changing normal push/stack behaviour.
      .setCcdEnabled(false);
    const body = this.physics.world.createRigidBody(desc);
    body.sleep();

    const cd = R.ColliderDesc.cylinder(LAYOUT.medal.height / 2, LAYOUT.medal.radius)
      .setDensity(3.8)
      .setFriction(0.35)
      .setRestitution(0.03)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(groups(GROUP.MEDAL, GROUP.STATIC | GROUP.MEDAL | GROUP.BALL | GROUP.SENSOR));
    const collider = this.physics.world.createCollider(cd, body);

    const slot: Slot = { body, collider, active: false, jackpot: false, stocked: false, collectIn: 0 };
    return slot;
  }

  /** Spawn a medal. Returns slot index or -1 if at capacity. */
  spawn(
    x: number,
    y: number,
    z: number,
    opts: {
      jackpot?: boolean;
      vx?: number;
      vy?: number;
      vz?: number;
      avx?: number;
      avy?: number;
      avz?: number;
      tilt?: boolean;
    } = {}
  ): number {
    const idx = this.free.pop();
    if (idx === undefined) return -1;
    const s = this.slots[idx];
    s.active = true;
    s.jackpot = !!opts.jackpot;
    s.stocked = false;
    s.collectIn = 0;

    const body = s.body;
    // register collider info with the slot so detectors can reclaim it
    this.physics.registerCollider(s.collider, { tag: BodyTag.Medal, slot: idx });

    body.setTranslation({ x, y, z }, true);
    // slight random tilt so coins don't spawn perfectly stacked
    const rx = opts.tilt === false ? 0 : (Math.random() - 0.5) * 0.5;
    const rz = opts.tilt === false ? 0 : (Math.random() - 0.5) * 0.5;
    this.quat.setFromEuler(new THREE.Euler(rx, Math.random() * Math.PI, rz));
    body.setRotation({ x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w }, true);
    body.setLinvel({ x: opts.vx ?? 0, y: opts.vy ?? 0, z: opts.vz ?? 0 }, true);
    body.setAngvel({ x: opts.avx ?? 0, y: opts.avy ?? 0, z: opts.avz ?? 0 }, true);
    body.setEnabled(true);
    body.wakeUp();

    this.activeCount++;
    return idx;
  }

  /** Credit a coin now but let it physically rest in the payout bin for `delay`
   *  seconds before clearing it — so the player can watch the collection. Once
   *  scheduled it can't be rescheduled (the bin sensor only fires on entry). */
  scheduleReclaim(idx: number, delay: number): void {
    const s = this.slots[idx];
    if (!s || !s.active || s.collectIn > 0) return;
    s.collectIn = delay;
  }

  /** Tick down pending bin collections and reclaim any that have rested long
   *  enough. Call from the fixed-step update. */
  tickReclaims(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      if (!s.active || s.collectIn <= 0) continue;
      s.collectIn -= dt;
      if (s.collectIn <= 0) this.reclaim(i);
    }
  }

  reclaim(idx: number): void {
    const s = this.slots[idx];
    if (!s.active) return;
    s.active = false;
    s.collectIn = 0;
    this.physics.unregisterCollider(s.collider);
    s.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    s.body.setTranslation({ x: 0, y: -100, z: 0 }, false);
    s.body.setEnabled(false);
    this.standardMesh.setMatrixAt(idx, HIDDEN);
    this.jackpotMesh.setMatrixAt(idx, HIDDEN);
    this.free.push(idx);
    this.activeCount--;
  }

  isActive(idx: number): boolean {
    return this.slots[idx]?.active ?? false;
  }

  /** Mark a medal as having stocked a slot spin. Returns false if it already did
   *  (prevents one coin / sensor jitter from stocking many spins at once). */
  tryStock(idx: number): boolean {
    const s = this.slots[idx];
    if (!s || !s.active || s.stocked) return false;
    s.stocked = true;
    return true;
  }

  /** Reclaim every active medal (debug / reset). */
  drainAll(): void {
    for (let i = 0; i < this.capacity; i++) if (this.slots[i].active) this.reclaim(i);
  }

  bodyOf(idx: number): RAPIER.RigidBody {
    return this.slots[idx].body;
  }

  /** Count active medals whose centre lies within an axis-aligned box. */
  countInRegion(xHalf: number, z0: number, z1: number, y0: number, y1: number): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      const t = s.body.translation();
      if (Math.abs(t.x) <= xHalf && t.z >= z0 && t.z <= z1 && t.y >= y0 && t.y <= y1) n++;
    }
    return n;
  }

  /** Reclaim all active medals within the box; returns how many. */
  reclaimInRegion(xHalf: number, z0: number, z1: number, y0: number, y1: number): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      const t = s.body.translation();
      if (Math.abs(t.x) <= xHalf && t.z >= z0 && t.z <= z1 && t.y >= y0 && t.y <= y1) {
        this.reclaim(i);
        n++;
      }
    }
    return n;
  }

  /** Debug: spatial stats of active medals. */
  debugStats(): { count: number; zMin: number; zMax: number; zAvg: number; yMax: number; xAbsMax: number } {
    let n = 0, zMin = 1e9, zMax = -1e9, zSum = 0, yMax = -1e9, xAbsMax = 0;
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      const t = s.body.translation();
      n++;
      zSum += t.z;
      if (t.z < zMin) zMin = t.z;
      if (t.z > zMax) zMax = t.z;
      if (t.y > yMax) yMax = t.y;
      if (Math.abs(t.x) > xAbsMax) xAbsMax = Math.abs(t.x);
    }
    return { count: n, zMin, zMax, zAvg: n ? zSum / n : 0, yMax, xAbsMax };
  }

  /** Reclaim any medals that fell out of bounds (tunnelling safety net). */
  cullOutOfBounds(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      if (s.active && s.body.translation().y < LAYOUT.killY) {
        this.reclaim(i);
        n++;
      }
    }
    return n;
  }

  /** Copy physics transforms into instance matrices. Called each render frame.
   *  Only the mesh matching each medal's type is written — the opposite mesh's
   *  slot was already parked at HIDDEN on spawn/reclaim, so we skip the redundant
   *  per-frame HIDDEN write (halves setMatrixAt calls with many medals active). */
  syncInstances(): void {
    for (let i = 0; i < this.capacity; i++) {
      const s = this.slots[i];
      if (!s.active) continue;
      const t = s.body.translation();
      const r = s.body.rotation();
      this.dummy.position.set(t.x, t.y, t.z);
      this.dummy.quaternion.set(r.x, r.y, r.z, r.w);
      this.dummy.updateMatrix();
      const mesh = s.jackpot ? this.jackpotMesh : this.standardMesh;
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.standardMesh.instanceMatrix.needsUpdate = true;
    this.jackpotMesh.instanceMatrix.needsUpdate = true;
  }
}
