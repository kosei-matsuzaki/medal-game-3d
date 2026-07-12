import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { MiniGame, MiniGameContext, MiniGameResult } from './MiniGame';
import { TAU } from '../utils/math';
import { bus } from '../core/EventBus';
import { LAYOUT } from '../pusher/layout';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { GROUP, groups } from '../physics/types';
import { create2D } from '../render/canvasText';

const J = LAYOUT.jp;
const RB = J.ballRadius;
const N = J.pocketCount;
const SEG = TAU / N; // angular spacing of the U-notches
const ROOT_R = J.radius - J.notchDepth; // deepest radius of a notch (its round bottom)

// Each U-notch is a prize pocket. 16 pockets, spread so equal prizes don't cluster:
// 100枚 ×8 / 200枚 ×4 / 300枚 ×3 / JPC ×1 (JPC = the progressive jackpot, very rare).
type Prize = { kind: 'medal' | 'jp'; amount: number; text: string; color: number };
const MEDAL_100: Prize = { kind: 'medal', amount: 100, text: '100', color: 0x8fd0ff };
const MEDAL_200: Prize = { kind: 'medal', amount: 200, text: '200', color: 0x6ee06e };
const MEDAL_300: Prize = { kind: 'medal', amount: 300, text: '300', color: 0xffd24a };
const JPC: Prize = { kind: 'jp', amount: 0, text: 'JPC', color: 0xff5ec4 };
const POCKETS: Prize[] = [
  MEDAL_100, MEDAL_200, MEDAL_100, MEDAL_300, MEDAL_100, MEDAL_200, MEDAL_100, JPC,
  MEDAL_100, MEDAL_200, MEDAL_100, MEDAL_300, MEDAL_100, MEDAL_200, MEDAL_100, MEDAL_300,
]; // length MUST equal J.pocketCount

type Phase = 'idle' | 'wait' | 'spin' | 'carry' | 'reveal' | 'done';

/**
 * JP CHALLENGE (ジャックポットチャレンジ) — a big VERTICAL SOLID DISC whose OUTER RIM is
 * scalloped with `pocketCount` U-shaped notches (円盤の外側をU字にくりぬいた形), each a
 * labelled prize pocket. The disc spins CONSTANTLY. A ball starts at one end of a ~90° ARC
 * RAIL that sits IN FRONT of the disc face and swings like a PENDULUM along it, leaning on
 * the face (the rig tilts back so gravity presses it on). Friction + the timing of a passing
 * notch slow it until it MESHES with a notch (falls back into the opening) — that pocket's
 * prize IS the result (入ったらそれで決まり, no carried-to-top judgement). REAL physics
 * (field-ball params, no scripted guidance); the ball is sandwiched between the front glass
 * and the disc face, free to swing, and drops into a notch only where the face opens. Always
 * resolves (timeout fallback snaps to the notch at the bottom).
 */
export class JackpotChallenge implements MiniGame {
  readonly kind = 'jackpot';
  private group = new THREE.Group(); // tilted rig (disc + wall + frame)
  private disc = new THREE.Group(); // the rotating scalloped disc (visual)
  private stand = new THREE.Group();

  private discBody!: RAPIER.RigidBody; // kinematic, spins
  private ballBody: RAPIER.RigidBody | null = null;
  private ballMesh: THREE.Mesh;
  private ballLight: THREE.PointLight;

  private ctx!: MiniGameContext;
  private onDone!: (r: MiniGameResult) => void;

  private phase: Phase = 'idle';
  private spin = 0;
  private spinSpeed = 0;
  private timer = 0;
  private seatIdx = -1; // resolved pocket index
  private engIdx = -1; // notch the ball is currently meshed into
  private engTime = 0; // how long it has stayed meshed in that notch
  private engGap = 0; // grace timer: brief contact-jitter exits don't reset the mesh
  private stillTime = 0; // how long the ball has been nearly motionless (stuck detector)
  private result: Prize = MEDAL_100;

  // local→world basis for the tilted rig (rotation about X by railTilt)
  private originW = new THREE.Vector3(J.x, J.y, J.z);
  private quat = new THREE.Quaternion();
  private quatInv = new THREE.Quaternion();
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, private physics: PhysicsWorld) {
    this.group.position.copy(this.originW);
    this.group.rotation.x = J.railTilt; // lean the whole rig toward the player
    this.group.add(this.disc);
    this.quat.setFromEuler(new THREE.Euler(J.railTilt, 0, 0));
    this.quatInv.copy(this.quat).invert();

    this.buildDisc();
    this.buildRing();
    this.buildRail();
    this.buildFrame();
    this.buildStand();
    scene.add(this.group);
    scene.add(this.stand);

    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(RB, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0xff8a2c, emissive: 0xff6a10, emissiveIntensity: 1.4, metalness: 0.3, roughness: 0.3 })
    );
    this.ballMesh.visible = false;
    scene.add(this.ballMesh);
    this.ballLight = new THREE.PointLight(0xffd060, 0, 5);
    scene.add(this.ballLight);
  }

  /** Convert a local (rig-space) point to world, honouring the rig tilt. */
  private toWorld(lx: number, ly: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(lx, ly, lz).applyQuaternion(this.quat).add(this.originW);
  }

  // --- the disc outline: a circle with N U-SLOTS cut from the rim -----------------
  // Each slot has straight parallel walls + a rounded (semicircular) bottom — 断面がU.
  private outline(): THREE.Vector2[] {
    const R = J.radius;
    const half = J.notchWidth / 2; // slot half-width
    const uTop = Math.sqrt(R * R - half * half); // wall outer end (meets the rim)
    const uC = R - J.notchDepth + half; // radius of the round-bottom centre / wall inner end
    const dA = Math.asin(half / R); // angular half-width of the slot mouth at the rim
    const arcSteps = 7, landSteps = 6;
    const pts: THREE.Vector2[] = [];
    const P = (u: number, v: number, ex: number, ey: number, tx: number, ty: number) =>
      pts.push(new THREE.Vector2(u * ex + v * tx, u * ey + v * ty));
    for (let i = 0; i < N; i++) {
      const th = i * SEG;
      const ex = Math.cos(th), ey = Math.sin(th); // radial unit
      const tx = -Math.sin(th), ty = Math.cos(th); // tangential unit
      // enter the slot on the trailing side (smaller angle): down the near wall
      P(uTop, -half, ex, ey, tx, ty);
      P(uC, -half, ex, ey, tx, ty);
      // rounded bottom from -half side to +half side, bulging inward (through uC-half)
      for (let s = 1; s < arcSteps; s++) {
        const psi = -Math.PI / 2 + (s / arcSteps) * Math.PI;
        P(uC - half * Math.cos(psi), half * Math.sin(psi), ex, ey, tx, ty);
      }
      // up the far wall, out to the rim
      P(uC, half, ex, ey, tx, ty);
      P(uTop, half, ex, ey, tx, ty);
      // land arc along the rim to the next slot's mouth
      const a0 = th + dA, a1 = th + SEG - dA;
      for (let s = 1; s < landSteps; s++) {
        const a = a0 + (s / landSteps) * (a1 - a0);
        pts.push(new THREE.Vector2(R * Math.cos(a), R * Math.sin(a)));
      }
    }
    return pts;
  }

  private buildDisc(): void {
    const shape = new THREE.Shape(this.outline());
    const geo = new THREE.ExtrudeGeometry(shape, { depth: J.thickness, bevelEnabled: false, curveSegments: 2 });
    geo.translate(0, 0, -J.thickness / 2); // centre on the disc mid-plane

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a3450, metalness: 0.8, roughness: 0.4 });
    const disc = new THREE.Mesh(geo, bodyMat);
    this.disc.add(disc);
    // face accent + hub cap so it reads as a solid plate, not a wireframe ring
    const face = new THREE.Mesh(new THREE.CircleGeometry(ROOT_R - 0.05, 64), new THREE.MeshStandardMaterial({ color: 0x18203c, metalness: 0.7, roughness: 0.5 }));
    face.position.z = J.thickness / 2 + 0.002;
    this.disc.add(face);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, J.thickness + 0.06, 24), new THREE.MeshStandardMaterial({ color: 0x3a4570, emissive: 0x14204a, emissiveIntensity: 0.7, metalness: 0.85, roughness: 0.3 }));
    hub.rotation.x = Math.PI / 2;
    this.disc.add(hub);

    // per-pocket prize label (rotates with the disc)
    for (let i = 0; i < N; i++) {
      const th = i * SEG;
      const p = POCKETS[i];
      const label = this.makeLabel(p.text, p.color, p.kind === 'jp' ? 64 : 72);
      const lr = ROOT_R - 0.22;
      label.position.set(Math.cos(th) * lr, Math.sin(th) * lr, J.thickness / 2 + 0.02);
      label.scale.set(p.kind === 'jp' ? 0.6 : 0.48, p.kind === 'jp' ? 0.6 : 0.48, 1);
      this.disc.add(label);
    }

    // --- physics: kinematic body, the whole scalloped plate as a trimesh -----
    const R = this.physics.RAPIER;
    this.discBody = this.physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(J.x, J.y, J.z).setRotation(this.quat)
    );
    const posAttr = geo.attributes.position;
    const verts = posAttr.array as Float32Array;
    // ExtrudeGeometry is NON-indexed → synthesise a sequential index for the trimesh
    const idx = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: posAttr.count }, (_, i) => i);
    const cd = R.ColliderDesc.trimesh(verts, idx)
      .setFriction(0.85)
      .setRestitution(0.02)
      .setCollisionGroups(groups(GROUP.DISC, GROUP.DISC));
    this.physics.world.createCollider(cd, this.discBody);
  }

  // --- decorative rim ring (visual only, no collider) --------------------------
  private buildRing(): void {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(J.radius + 0.06, 0.05, 12, 96),
      new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffaa10, emissiveIntensity: 0.9, metalness: 1, roughness: 0.3 })
    );
    this.group.add(ring);
  }

  // --- front arc rail: a ~90° WIDE curved floor IN FRONT of the disc face --------
  // A curved wall at radius railRadius+RB spanning the bottom arc, with DEPTH in Z
  // (railDepth) so the ball is supported from below the whole way and can roam freely
  // forward/back on it when a notch rejects it — before drifting back to mesh.
  private buildRail(): void {
    const R = this.physics.RAPIER;
    // the floor is a curved wall whose radius SHRINKS toward the front (railRamp): at the
    // bottom, a smaller radius sits HIGHER, so the front is a gentle up-ramp and the ball
    // rolls BACK to the face (larger radius = lower) where it meshes.
    const RcBack = J.railRadius + RB; // back edge (face side) — lowest, mesh position
    const RcFront = J.railRadius + RB - J.railRamp; // front edge — raised
    const zA = J.railFrontZ - RB; // back edge, near the disc face
    const zB = J.railFrontZ + J.railDepth; // front edge (forward free-roam limit)
    const aC = -Math.PI / 2; // bottom
    const M = 26; // arc segments
    const verts: number[] = [];
    for (const [z, Rc] of [[zA, RcBack], [zB, RcFront]] as const) {
      for (let j = 0; j <= M; j++) {
        const a = aC - J.railArc + (j / M) * 2 * J.railArc;
        verts.push(Math.cos(a) * Rc, Math.sin(a) * Rc, z);
      }
    }
    const idx: number[] = [];
    const row = M + 1;
    for (let j = 0; j < M; j++) {
      idx.push(j, row + j, row + j + 1, j, row + j + 1, j + 1);
    }
    const varr = new Float32Array(verts);
    const iarr = new Uint32Array(idx);
    // visual: the curved floor band + a neon tube along the front edge
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(varr.slice(), 3));
    geo.setIndex(Array.from(iarr));
    geo.computeVertexNormals();
    const rail = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x2a78ff, emissiveIntensity: 0.45, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    this.group.add(rail);
    const edge = new THREE.Mesh(
      new THREE.TorusGeometry(RcFront, 0.05, 8, 44, J.railArc * 2),
      new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x2a78ff, emissiveIntensity: 1.1, metalness: 0.8, roughness: 0.3 })
    );
    edge.rotation.z = -Math.PI / 2 - J.railArc;
    edge.position.z = zB;
    this.group.add(edge);
    // collider
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(J.x, J.y, J.z).setRotation(this.quat));
    const cd = R.ColliderDesc.trimesh(varr, iarr)
      .setFriction(0.4)
      .setRestitution(0.05)
      .setCollisionGroups(groups(GROUP.DISC, GROUP.DISC));
    this.physics.world.createCollider(cd, body);
  }

  // --- header, glass, prize legend --------------------------------------------
  private buildFrame(): void {
    const header = this.makeLabel('★ JP CHALLENGE ★', 0xffe27a, 60, 1024, 160);
    header.scale.set(2.6, 0.4, 1);
    header.position.set(0, J.radius + 0.5, 0.2);
    this.group.add(header);

    // transparent glass cover IN FRONT of the ball — a real collider that (with the disc
    // face behind) sandwiches the ball into the swing plane; at a notch the face opens so
    // the ball can fall in.
    // The glass sits CLOSE to the face (ball z slack only ~0.03) — the tight sandwich is
    // what makes the ball reliably fall into a passing notch. With the glass out at the
    // tray's front edge the ball dawdles forward, off the face, and almost never meshes
    // (verified across spins 0.3-0.55 / tilts 0.25-0.3 with the flat 90° tray).
    const glassZ = J.railFrontZ + RB + 0.06;
    const glass = new THREE.Mesh(
      new THREE.CircleGeometry(J.radius + 0.1, 56),
      new THREE.MeshPhysicalMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.06, roughness: 0.08, metalness: 0, transmission: 0.6, side: THREE.DoubleSide, depthWrite: false })
    );
    glass.position.z = glassZ;
    glass.renderOrder = 2;
    this.group.add(glass);

    const R = this.physics.RAPIER;
    const qYtoZ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(J.x, J.y, J.z).setRotation(this.quat));
    const cd = R.ColliderDesc.cylinder(0.03, J.radius + 0.1)
      .setTranslation(0, 0, glassZ)
      .setRotation({ x: qYtoZ.x, y: qYtoZ.y, z: qYtoZ.z, w: qYtoZ.w })
      .setFriction(0.05)
      .setRestitution(0.1)
      .setCollisionGroups(groups(GROUP.DISC, GROUP.DISC));
    this.physics.world.createCollider(cd, body);

    // BACK PLATE behind the disc. The U-slots are cut THROUGH the slab and the rig leans
    // back, so a ball that drops into a notch keeps accelerating in local −z — without a
    // back wall it falls OUT the rear of the disc before the engagement timer can confirm
    // the pocket (user-visible as "entered 100 but the result became something else").
    // The plate caps that motion: a seated ball rests inside the notch against it.
    const backZ = -J.thickness / 2 - 0.04;
    const back = new THREE.Mesh(
      new THREE.CircleGeometry(J.radius + 0.1, 56),
      new THREE.MeshStandardMaterial({ color: 0x131a30, metalness: 0.6, roughness: 0.6 })
    );
    back.position.z = backZ + 0.031; // visual face flush with the collider surface
    this.group.add(back);
    const bd = R.ColliderDesc.cylinder(0.03, J.radius + 0.1)
      .setTranslation(0, 0, backZ)
      .setRotation({ x: qYtoZ.x, y: qYtoZ.y, z: qYtoZ.z, w: qYtoZ.w })
      .setFriction(0.2) // low: the notch walls, not this plate, carry the seated ball
      .setRestitution(0.05)
      .setCollisionGroups(groups(GROUP.DISC, GROUP.DISC));
    this.physics.world.createCollider(bd, body);
  }

  private buildStand(): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a3040, metalness: 0.8, roughness: 0.45 });
    const neon = new THREE.MeshStandardMaterial({ color: 0xff4dc4, emissive: 0xd11080, emissiveIntensity: 1.4 });
    // pedestal reaches the common ground plane so it stands level with the cabinet
    const gy = LAYOUT.groundY;
    const postTop = J.y - J.radius;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, postTop - gy, 0.8), metal);
    post.position.set(J.x, (postTop + gy) / 2, J.z);
    this.stand.add(post);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, 0.18, 32), metal);
    base.position.set(J.x, gy + 0.09, J.z);
    this.stand.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.04, 8, 40), neon);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(J.x, gy + 0.2, J.z);
    this.stand.add(ring);
  }

  private makeLabel(text: string, color: number, px: number, cw = 256, ch = 256): THREE.Sprite {
    const [c, g] = create2D(cw, ch);
    g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    g.font = `900 ${px}px "Segoe UI", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#000';
    g.shadowBlur = 12;
    g.fillText(text, cw / 2, ch / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  }

  // --- run ---------------------------------------------------------------
  start(ctx: MiniGameContext, onDone: (r: MiniGameResult) => void): void {
    this.ctx = ctx;
    this.onDone = onDone;
    this.seatIdx = -1;
    this.engIdx = -1;
    this.engTime = 0;
    this.engGap = 0;
    this.stillTime = 0;
    // NOTE: spin is NOT reset — the disc keeps the phase it idled at, so which pocket
    // meets the ball is different every play (resetting to 0 made the catch geometry —
    // and therefore the PRIZE — nearly identical each time).
    this.spinSpeed = J.spinSpeed;
    bus.emit('sfx', { name: 'spin' });
    this.applyDisc();
    // the disc whirls ball-less for a beat first — the launch timing is slightly
    // delayed and RANDOM so the ball's meeting point with the notches varies per play
    this.phase = 'wait';
    this.timer = 0.7 + Math.random() * 1.5;
  }

  private spawnBall(): void {
    const R = this.physics.RAPIER;
    // start at ONE END of the front arc rail (the LEFT end as the player faces the disc),
    // released from rest → it swings like a pendulum along the rail against the disc face;
    // NO guidance
    const a = -Math.PI / 2 - J.railArc * 0.92;
    const p = this.toWorld(Math.cos(a) * J.railRadius, Math.sin(a) * J.railRadius, J.railFrontZ);
    this.ballBody = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        // moderate damping: enough that the pendulum decays and eventually SETTLES at the
        // bottom (a settled ball drops into a passing notch), but low enough that it swings
        // several times first. While the ball is moving fast it crosses a notch mouth quicker
        // than it can sink in, so it skates over — the 入るか入らないか suspense is physical.
        // (1.5 killed the swing instantly → the first passing notch always caught it.)
        .setLinearDamping(0.5)
        .setAngularDamping(0.9)
        .setCcdEnabled(true)
    );
    // a PERFECT SPHERE collider (not a convex-hull icosphere) so it rolls truly round
    const cd = R.ColliderDesc.ball(RB)
      .setDensity(2.2)
      .setRestitution(0.02)
      .setFriction(0.6)
      .setCollisionGroups(groups(GROUP.DISC, GROUP.DISC));
    this.physics.world.createCollider(cd, this.ballBody);
    // launch it DOWN the rail rather than releasing from rest — a ball that dawdles at the
    // top passes the notches there slowly enough to be caught at once (no suspense). With a
    // push it stays fast everywhere until the damping bleeds it off, so the catch comes on a
    // later, slower pass.
    // Random launch speed: fast enough that it doesn't dawdle over the notches near the
    // spawn point, low enough (with damping) that it cannot crest the far end of the rail
    // arc. The variance (with the randomised wait + carried-over disc phase) is what makes
    // each play's catch — timing AND pocket — come out different.
    const v0 = 1.5 + Math.random() * 0.9;
    const tv = this.tmp.set(-Math.sin(a), Math.cos(a), 0).multiplyScalar(v0).applyQuaternion(this.quat);
    this.ballBody.setLinvel({ x: tv.x, y: tv.y, z: tv.z }, true);
    this.ballMesh.visible = true;
    this.ballLight.intensity = 2.2;
  }

  private applyDisc(): void {
    // spin about the rig's local Z (compose tilt ∘ spinZ)
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, this.spin));
    q.premultiply(this.quat);
    this.disc.rotation.z = this.spin;
    this.discBody.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }

  /**
   * The ball in the DISC's rotating local frame. When the ball has fallen BACK into a
   * notch, its local z drops from the front plane (~railFrontZ) into the disc slab (~0) —
   * that, at rim radius, means it has meshed with notch `idx`.
   */
  private engaged(): { inNotch: boolean; idx: number; out: boolean; lost: boolean } {
    const t = this.ballBody!.translation();
    this.tmp.set(t.x - J.x, t.y - J.y, t.z - J.z).applyQuaternion(this.quatInv); // rig frame
    const cs = Math.cos(this.spin), sn = Math.sin(this.spin);
    const lx = this.tmp.x * cs + this.tmp.y * sn; // undo disc spin
    const ly = -this.tmp.x * sn + this.tmp.y * cs;
    const r = Math.hypot(lx, ly);
    let k = Math.round(Math.atan2(ly, lx) / SEG) % N;
    if (k < 0) k += N;
    // "in a notch" = the ball has sunk behind the front-cap plane at rim radius — lenient
    // enough that one perched in the slot MOUTH being carried also counts (what the player
    // sees as "entered").
    const inNotch = this.tmp.z < J.thickness * 0.6 && r > ROOT_R - 0.06 && r < J.radius + 0.08;
    // `out` = the ball has crested the RIM (on the rail its centre stays ≤ ~railRadius; only
    // a ball being carried IN a notch past the rail's end can get flung radially outward).
    // Caught here it is still adjacent to the notch that carried it — k IS that notch.
    const out = r > J.radius + 0.24;
    const lost = r > J.radius + 1.2 || this.tmp.y < -(J.radius + 1.5);
    return { inNotch, idx: k, out, lost };
  }

  update(dt: number): void {
    if (this.phase === 'idle' || this.phase === 'done') return;
    this.syncBall();

    switch (this.phase) {
      case 'wait': {
        // pre-launch: the disc spins alone; the ball drops in after a random delay
        this.spin += this.spinSpeed * dt;
        this.applyDisc();
        if (Math.random() < 0.12) bus.emit('sfx', { name: 'reel' });
        this.timer -= dt;
        if (this.timer <= 0) {
          this.spawnBall();
          this.phase = 'spin';
        }
        break;
      }
      case 'spin': {
        this.spin += this.spinSpeed * dt; // the disc turns CONSTANTLY
        this.applyDisc();
        if (Math.random() < 0.12) bus.emit('sfx', { name: 'reel' });

        // NO time limit — the ball swings until it PHYSICALLY meshes with a slot (入るまで
        // 無限). The only forced resolve is a `lost` safety (ball escaped / NaN), which
        // should never happen with the glass + rail containment.
        const e = this.engaged();
        // A ball being carried in a notch past the rail's end gets flung over the rim and
        // would sail off the rig — resolve it the moment it crests, to the notch it is AT
        // (judging later, from the stale latch, is what read as "one pocket behind" to the
        // player). True escape/NaN keeps the last-meshed fallback.
        if (e.out) { this.resolve(e.idx); break; }
        if (e.lost) { this.resolve(this.engIdx >= 0 ? this.engIdx : this.bottomNotch()); break; }
        // the ball must stay meshed in the SAME notch briefly (riding with the disc) to
        // count — a glancing dip doesn't. Trimesh contact jitter can pop the ball above the
        // z-threshold for a frame or two, so a short grace period keeps the latch instead of
        // restarting the timer (the restart race was letting an entered ball ride up & spill).
        if (e.inNotch) {
          if (e.idx === this.engIdx) this.engTime += dt;
          else { this.engIdx = e.idx; this.engTime = dt; }
          this.engGap = 0;
        } else if (this.engIdx >= 0) {
          this.engGap += dt;
          if (this.engGap > 0.12) { this.engIdx = -1; this.engTime = 0; this.engGap = 0; }
        }
        if (this.engTime > 0.35) { this.resolve(this.engIdx); break; }

        // ANTI-STUCK: the disc is kinematic (infinite mass), so a ball WEDGED between a slot
        // wall and the fixed glass/rail can be pinned motionless forever. If it stays nearly
        // still for a while without meshing, treat it as stuck → drop it into the pocket it's
        // nearest to (frees the pin, gives a fair result). NOT a time limit — only fires when
        // the ball genuinely can't move (a swinging/dragged ball keeps a non-zero speed).
        const v = this.ballBody!.linvel();
        if (Math.hypot(v.x, v.y, v.z) < 0.12) this.stillTime += dt;
        else this.stillTime = 0;
        if (this.stillTime > 3.0) this.resolve(e.idx);
        break;
      }
      case 'carry': {
        // 演出: keep turning (same direction, easing) until the pocket the ball entered
        // sits at the very BOTTOM, the ball riding locked in it, THEN reveal the prize.
        const dir = Math.sign(this.spinSpeed) || 1;
        const cur = this.seatIdx * SEG + this.spin;
        const rem = ((((-Math.PI / 2 - cur) * dir) % TAU) + TAU) % TAU; // remaining, in spin direction
        const speed = Math.min(1.1, 0.3 + rem * 0.8); // eases down on approach
        if (rem <= speed * dt + 1e-4) {
          this.spin += dir * rem; // snap the pocket exactly to the bottom
          this.phase = 'reveal';
          this.timer = 1.8;
          this.reveal();
        } else {
          this.spin += dir * speed * dt;
          if (Math.random() < 0.12) bus.emit('sfx', { name: 'reel' });
        }
        this.applyDisc();
        this.parkAt(this.seatIdx); // the ball stays nested in its pocket — it can't fall out
        this.syncBall();
        break;
      }
      case 'reveal': {
        this.parkAt(this.seatIdx); // hold the ball in the (now bottom) pocket during the reveal
        this.syncBall();
        this.timer -= dt;
        if (this.result.kind === 'jp' && Math.random() < 0.6) {
          const t = this.ballBody?.translation();
          if (t) this.ctx.particles.emit(t.x, t.y, t.z, 18, new THREE.Color().setHSL(Math.random(), 1, 0.6), 8);
        }
        if (this.timer <= 0) {
          this.phase = 'done';
          this.finish();
        }
        break;
      }
    }
  }

  /** Which notch is at the disc's lowest point (world angle nearest -π/2) right now. */
  private bottomNotch(): number {
    const target = -Math.PI / 2;
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const a = i * SEG + this.spin;
      const d = Math.abs(Math.atan2(Math.sin(a - target), Math.cos(a - target)));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Nest the ball cleanly in notch `idx` at its current (bottom) position. */
  private parkAt(idx: number): void {
    if (!this.ballBody) return;
    const a = idx * SEG + this.spin;
    const r = (J.radius + ROOT_R) / 2;
    const p = this.toWorld(Math.cos(a) * r, Math.sin(a) * r, 0);
    this.ballBody.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private resolve(idx: number): void {
    this.seatIdx = ((idx % N) + N) % N;
    this.result = POCKETS[this.seatIdx];
    this.parkAt(this.seatIdx);
    // don't reveal yet — first carry the pocket (ball locked inside) to the bottom
    this.phase = 'carry';
    bus.emit('sfx', { name: 'reach' });
  }

  private syncBall(): void {
    if (!this.ballBody) return;
    const t = this.ballBody.translation();
    this.ballMesh.position.set(t.x, t.y, t.z);
    const q = this.ballBody.rotation();
    this.ballMesh.quaternion.set(q.x, q.y, q.z, q.w);
    this.ballLight.position.set(t.x, t.y, t.z + 0.4);
  }

  /** Idle: the installed disc turns slowly when it isn't being played. */
  tick(dt: number): void {
    if (this.phase !== 'idle') return;
    this.spin += Math.sign(J.spinSpeed) * 0.2 * dt; // same direction as in play
    this.applyDisc();
  }

  private reveal(): void {
    const r = this.result;
    if (r.kind === 'jp') this.ctx.hud.showOverlay('JPC 的中!!', 'ジャックポットチャンス！');
    else this.ctx.hud.showOverlay(`${r.amount} MEDAL 獲得!!`, 'JP チャレンジ');
    bus.emit('sfx', { name: 'jackpot' });
    bus.emit('fx:flash', {});
  }

  private finish(): void {
    this.ctx.hud.hideOverlay();
    const r = this.result;
    if (r.kind === 'jp') this.onDone({ payout: 0, jackpot: true, label: 'JPC' });
    else this.onDone({ payout: r.amount, label: `JP ${r.amount}` });
  }

  stop(): void {
    if (this.ballBody) {
      this.physics.removeBody(this.ballBody);
      this.ballBody = null;
    }
    this.ballMesh.visible = false;
    this.ballLight.intensity = 0;
    this.phase = 'idle';
    this.ctx?.hud.hideOverlay();
  }
}
