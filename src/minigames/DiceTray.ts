import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { GROUP, groups } from '../physics/types';
import { LAYOUT, wallMount } from '../pusher/layout';
import { IdleGlow } from '../render/idleGlow';
import { bus } from '../core/EventBus';
import { dieMaterials, faceUp, FACE_NORMALS } from '../render/dieFaces';

const D = LAYOUT.dice;


/** Where the tray hangs off the cabinet's left flank, and the wall's yaw there. */
/**
 * Where the tray bolts on. wallMount() gives the OUTER FACE of the left taper
 * wall at this z, plus that wall's yaw; the tray centre then steps out from that
 * face by its own half-width, measured perpendicular to the wall (hence /cos) so
 * the tray sits flush instead of leaving a wedge of daylight.
 */
/** Key-light intensity for the unit: idle, and while it is being played. */
const KEY_IDLE = 2.4;
const KEY_ON = 9.0;

const MOUNT = wallMount(-1, D.z);
const YAW = MOUNT.yaw;
const DX = MOUNT.x - (D.half + 0.02) / Math.cos(YAW);

/** Most dice ever in the air at once (チンチロ throws three). */
const MAX_DICE = 3;

/** How many times a single throw will scoop an escaped die back into the tray. */
const MAX_RESCUES = 4;

interface Die {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody | null;
}

/**
 * Physical six-sided dice in a tray.
 *
 * `throwDice(n)` launches n of them together; `update()` watches until they have
 * ALL stopped moving and then reads whichever face of each is pointing up. The
 * board takes those numbers — there is no pre-rolled value and no animation
 * toward a decided answer, so a roll is the same kind of thing as the bowl draw:
 * physics decides, and the game reads it.
 *
 * They are thrown together rather than one at a time both because that is what
 * チンチロ is and because a settle takes a couple of seconds; three sequential
 * throws, re-rolled up to three times, would be half a minute of waiting.
 *
 * A cocked or endlessly-rolling die would hang the whole machine, so after
 * `patience` the dice are nudged, and past twice that they are snapped flat onto
 * their nearest face. Straightening a stuck die is much better than a board that
 * stops.
 */
export class DiceTray {
  private group = new THREE.Group();
  private stand = new THREE.Group();
  private dice: Die[] = [];
  private glow!: IdleGlow;
  private key!: THREE.PointLight;

  private rolling = false;
  private count = 0;
  private elapsed = 0;
  private stillFor = 0;
  /** off-the-table rescues used this throw — bounded so a die that keeps
   *  escaping cannot restart the patience clock forever */
  private rescues = 0;
  private settled: number[] = [];
  private onSettle: ((v: number[]) => void) | null = null;

  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private physics: PhysicsWorld) {
    scene.add(this.group);
    scene.add(this.stand);
    this.buildTray();
    this.buildStand();

    // One geometry, one material set, shared by all three — they are the same
    // object, and a die that looked subtly different from its neighbours would
    // read as a rendering bug rather than as three dice.
    const geo = new RoundedBoxGeometry(D.size, D.size, D.size, 4, D.round);
    // Barely any emissive lift. At 0.35 — set when the tray stood out in the unlit
    // room — the dice blew out to featureless white blobs under the cabinet's own
    // lighting and the pips stopped reading at all.
    const mats = dieMaterials(0.1);
    for (let i = 0; i < MAX_DICE; i++) {
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      this.dice.push({ mesh, body: null });
    }

    this.key = new THREE.PointLight(0xbfe6ff, KEY_IDLE, 4.2, 2);
    this.key.position.set(DX, D.y + 1.15, D.z);
    scene.add(this.key);

    this.glow = new IdleGlow([this.group, this.stand]);
  }

  setSpotlit(on: boolean): void {
    this.glow.setActive(on);
    // The cabinet's own spots do not reach out here, so without a light of its
    // own the unit's metal is unlit and all that survives on screen is its neon
    // trim — which is exactly why it read as a floating light fixture rather than
    // as a machined box bolted to the side of the machine. Dim while idle so the
    // cabinet stays the subject, up when it is the unit's turn.
    this.key.intensity = on ? KEY_ON : KEY_IDLE;
  }

  private buildTray(): void {
    const R = this.physics.RAPIER;
    // The SHELL is brushed metal so the unit reads as a physical box bolted to
    // the cabinet. It used to be near-black, which meant that against a dark
    // cabinet on a dark floor the only thing visible was the neon trim — the tray
    // looked like a floating light fixture rather than a tray.
    const shell = new THREE.MeshStandardMaterial({
      color: 0x4b5466,
      metalness: 0.75,
      roughness: 0.45,
    });
    // The FLOOR stays dark and matte: the dice have to be the brightest thing in
    // the box, and a shiny bed would out-shine them.
    const felt = new THREE.MeshStandardMaterial({
      color: 0x1d2c48,
      metalness: 0.1,
      roughness: 0.85,
    });

    // The tray is YAWED to the taper's own angle so it sits flush against the
    // wall it is bolted to. Everything below is therefore built in the tray's
    // LOCAL space and carried by one parented group / one rotated rigid body —
    // placing the parts at world coordinates and rotating them individually is
    // what opens seams.
    this.group.position.set(DX, D.y, D.z);
    this.group.rotation.y = YAW;

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, YAW, 0));
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(DX, D.y, D.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    );
    const add = (
      cx: number, cy: number, cz: number,
      hx: number, hy: number, hz: number,
      mat: THREE.Material = shell
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
      m.position.set(cx, cy, cz);
      m.receiveShadow = true;
      this.group.add(m);
      const cd = R.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(cx, cy, cz)
        .setFriction(0.55)
        .setRestitution(0.25)
        .setCollisionGroups(groups(GROUP.BOWL, GROUP.BOWL));
      this.physics.world.createCollider(cd, body);
    };
    const t = 0.07;
    add(0, -t, 0, D.half, t, D.half, felt); // floor
    for (const sx of [-1, 1]) add(sx * (D.half + t), D.wall / 2, 0, t, D.wall / 2, D.half + t * 2);
    for (const sz of [-1, 1]) add(0, D.wall / 2, sz * (D.half + t), D.half + t * 2, D.wall / 2, t);

    // neon rim so the tray reads as a unit with the bowl opposite it
    const neon = new THREE.MeshStandardMaterial({
      color: 0x18e0ff,
      emissive: 0x0aa6ff,
      emissiveIntensity: 1.4,
    });
    const bar = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.038, d), neon);
      m.position.set(x, D.wall, z);
      this.group.add(m);
    };
    const span = (D.half + 0.09) * 2;
    for (const sz of [-1, 1]) bar(span, 0.038, 0, sz * (D.half + 0.09));
    for (const sx of [-1, 1]) bar(0.038, span, sx * (D.half + 0.09), 0);
  }

  /**
   * The bracket that carries the tray on the cabinet wall.
   *
   * It replaces a floor-to-tray column: a lit post holding a tray in mid-air
   * beside the machine read as furniture standing next to the game rather than
   * as part of it. A short arm reaching back to the wall says the unit is bolted
   * to the cabinet, which is what it now is.
   */
  private buildStand(): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x4b5466, metalness: 0.8, roughness: 0.4 });
    this.stand.position.set(DX, D.y, D.z);
    this.stand.rotation.y = YAW;

    // reach INWARD (toward the wall the tray hangs off) — the tray is on the
    // cabinet's left, so its wall lies in the +x direction in local space
    const reach = 0.5;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(reach, 0.12, 0.34), metal);
    arm.position.set(D.half * 0.6 + reach / 2, -0.16, 0);
    arm.castShadow = true;
    this.stand.add(arm);

    // an underslung plate, so the tray does not appear to float on one strut
    const plate = new THREE.Mesh(new THREE.BoxGeometry(D.half * 1.7, 0.08, D.half * 1.7), metal);
    plate.position.set(0, -0.2, 0);
    plate.castShadow = true;
    this.stand.add(plate);

    // a thin lit strip along the arm, tying it to the cabinet's own neon
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(reach, 0.02, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x18e0ff, emissive: 0x0aa6ff, emissiveIntensity: 1.2 })
    );
    strip.position.set(D.half * 0.6 + reach / 2, -0.09, 0);
    this.stand.add(strip);
  }

  /** Throw one die. `done` fires with its face value once it settles. */
  throwDie(done: (value: number) => void): void {
    this.throwDice(1, (v) => done(v[0]));
  }

  /** Throw `n` dice together. `done` fires once ALL of them have settled. */
  throwDice(n: number, done: (values: number[]) => void): void {
    this.clear();
    const R = this.physics.RAPIER;
    this.count = Math.max(1, Math.min(MAX_DICE, n));
    const spin = Math.random() * Math.PI * 2;

    for (let i = 0; i < this.count; i++) {
      // Spread the launch points around a ring so they do not spawn inside one
      // another — overlapping bodies get shoved apart explosively.
      const a = spin + (Math.PI * 2 * i) / this.count;
      const r = this.count === 1 ? 0.28 : 0.5;
      const d = this.dice[i];
      d.body = this.physics.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(DX + Math.cos(a) * r, D.y + D.wall + 0.4, D.z + Math.sin(a) * r)
          // TANGENTIAL, not inward. Firing them at the centre makes all three
          // arrive at the same point at the same time and punt each other clean
          // over the wall; sent around the ring they tumble past one another.
          .setLinvel(-Math.sin(a) * D.throwSpeed, 0.4, Math.cos(a) * D.throwSpeed)
          .setAngvel({
            x: (Math.random() - 0.5) * 15,
            y: (Math.random() - 0.5) * 15,
            z: (Math.random() - 0.5) * 15,
          })
          // Damping sets how long a throw TAKES. Spin decays as e^(-k·t), so at
          // k=0.7 an initial 22 rad/s took ~4.2s to fall under the settle
          // threshold — long enough that the game felt stalled. k=1.7 from 15
          // rad/s lands at ~1.5s, which is about how long a real die takes.
          .setLinearDamping(0.9)
          .setAngularDamping(1.7)
          .setCcdEnabled(true)
      );
      // Same rounded form as the playing cube — one object vocabulary, and the
      // fillet is what lets it tumble instead of landing on a corner and stopping.
      const h = D.size / 2 - D.round;
      const cd = R.ColliderDesc.roundCuboid(h, h, h, D.round)
        .setDensity(5.0)
        .setFriction(0.5)
        .setRestitution(0.3)
        .setCollisionGroups(groups(GROUP.BOWL, GROUP.BOWL));
      this.physics.world.createCollider(cd, d.body);
      d.mesh.visible = true;
    }
    for (let i = this.count; i < MAX_DICE; i++) this.dice[i].mesh.visible = false;

    this.rolling = true;
    this.elapsed = 0;
    this.stillFor = 0;
    this.rescues = 0;
    this.settled = [];
    this.onSettle = done;
    bus.emit('sfx', { name: 'reel' });
  }

  /** The face of die `i` pointing most nearly straight up, right now. */
  private faceUpOf(d: Die): number {
    if (!d.body) return 1;
    const r = d.body.rotation();
    this.q.set(r.x, r.y, r.z, r.w);
    return faceUp(this.q, this.v);
  }

  update(dt: number): void {
    if (!this.rolling) return;
    this.elapsed += dt;

    // The slowest die governs: the throw is not over until every one of them has
    // stopped, or a fast die would decide the hand while another is still rolling.
    let maxSpeed = 0;
    for (let i = 0; i < this.count; i++) {
      const d = this.dice[i];
      if (!d.body) continue;
      const t = d.body.translation();
      d.mesh.position.set(t.x, t.y, t.z);
      const r = d.body.rotation();
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);

      const lv = d.body.linvel();
      const av = d.body.angvel();
      maxSpeed = Math.max(maxSpeed, Math.hypot(lv.x, lv.y, lv.z) + Math.hypot(av.x, av.y, av.z) * 0.25);
    }

    if (maxSpeed < 0.3) this.stillFor += dt;
    else this.stillFor = 0;

    // A die that has left the tray is scooped back in rather than left to fall
    // out of the world. Without this a single bad bounce means the hand is never
    // read and the machine sits in チンチロ forever — and "the die went off the
    // table, throw it again" is what actually happens at a real table.
    for (let i = 0; i < this.count; i++) {
      const d = this.dice[i];
      if (!d.body) continue;
      const t = d.body.translation();
      const out =
        t.y < D.y - 0.4 ||
        Math.abs(t.x - DX) > D.half + 0.5 ||
        Math.abs(t.z - D.z) > D.half + 0.5;
      if (!out) continue;
      // past the cap, stop rescuing and let the snap-flat fallback below end the
      // throw: an endless rescue loop is the same hang it was meant to prevent
      if (this.rescues >= MAX_RESCUES) {
        this.snapFlat();
        break;
      }
      this.rescues++;
      const a = Math.random() * Math.PI * 2;
      d.body.setTranslation(
        { x: DX + Math.cos(a) * 0.3, y: D.y + D.wall + 0.35, z: D.z + Math.sin(a) * 0.3 },
        true
      );
      d.body.setLinvel({ x: -Math.sin(a) * 1.2, y: 0, z: Math.cos(a) * 1.2 }, true);
      d.body.setAngvel({ x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 14, z: (Math.random() - 0.5) * 14 }, true);
      // the clock restarts for a die that had to be re-thrown, or the snap-flat
      // fallback would fire on it mid-air
      this.elapsed = Math.min(this.elapsed, D.patience * 0.5);
      this.stillFor = 0;
    }

    // nudge dice that are still wandering, then straighten ones that will not lie down
    if (this.elapsed > D.patience && this.stillFor < 0.2) {
      for (let i = 0; i < this.count; i++) {
        this.dice[i].body?.applyImpulse(
          { x: (Math.random() - 0.5) * 0.06, y: 0.05, z: (Math.random() - 0.5) * 0.06 },
          true
        );
      }
    }
    if (this.elapsed > D.patience * 2) this.snapFlat();

    if (this.stillFor > 0.22) this.finish();
  }

  /** Lay every die flat on whichever face is already closest to up. */
  private snapFlat(): void {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.count; i++) {
      const d = this.dice[i];
      if (!d.body) continue;
      const value = this.faceUpOf(d);
      const target = FACE_NORMALS.find((f) => f.value === value)!.n;
      const q = new THREE.Quaternion().setFromUnitVectors(target, up);
      d.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      d.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      // Set it down ON the tray floor as well. Freezing it wherever it happened
      // to be leaves a die hanging in the air, which looks like the game broke.
      const t = d.body.translation();
      d.body.setTranslation(
        {
          x: DX + Math.max(-D.half + 0.4, Math.min(D.half - 0.4, t.x - DX)),
          y: D.y + D.size / 2,
          z: D.z + Math.max(-D.half + 0.4, Math.min(D.half - 0.4, t.z - D.z)),
        },
        true
      );
    }
    this.stillFor = 1;
  }

  private finish(): void {
    if (!this.rolling) return;
    this.rolling = false;
    this.settled = [];
    for (let i = 0; i < this.count; i++) this.settled.push(this.faceUpOf(this.dice[i]));
    bus.emit('sfx', { name: 'reelstop' });
    const cb = this.onSettle;
    this.onSettle = null;
    cb?.(this.settled);
  }

  /** Debug/testing: what the throw is doing right now. */
  debugState(): object {
    return {
      rolling: this.rolling,
      count: this.count,
      elapsed: +this.elapsed.toFixed(2),
      stillFor: +this.stillFor.toFixed(2),
      y: this.dice.slice(0, this.count).map((d) => +(d.body?.translation().y ?? 0).toFixed(2)),
    };
  }

  /** Face values of the last settled throw (empty until something is thrown). */
  get values(): number[] {
    return this.settled;
  }

  /** Value of the FIRST die of the last settled throw (1 if nothing thrown). */
  get value(): number {
    return this.settled[0] ?? 1;
  }

  get isRolling(): boolean {
    return this.rolling;
  }

  /** Remove the dice from the world (they stay on screen until the next throw). */
  clear(): void {
    for (const d of this.dice) {
      if (d.body) {
        this.physics.removeBody(d.body);
        d.body = null;
      }
    }
    this.rolling = false;
    this.onSettle = null;
  }

  hide(): void {
    this.clear();
    for (const d of this.dice) d.mesh.visible = false;
  }
}
