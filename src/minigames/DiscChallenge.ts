import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { MiniGame, MiniGameContext, MiniGameResult } from './MiniGame';
import { TAU } from '../utils/math';
import { bus } from '../core/EventBus';
import { LAYOUT } from '../pusher/layout';
import { GameStore } from '../state/GameStore';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { GROUP, groups } from '../physics/types';
import { create2D } from '../render/canvasText';

const D = LAYOUT.disc;
const SEG = TAU / D.count;
const REST_R = D.ballRadius; // resting balls are full balls perched in the dimple

// The opening radius can't exceed the ball's equator (else it'd fall through).
const HR = Math.min(D.holeRadius, D.ballRadius * 0.999);
// Deck-relative Y of a ball's CENTRE when it has come to rest in a dimple. Each dent
// is a spherical hollow of the BALL's radius, so a seated ball nests perfectly with
// its centre on the dent's sphere centre = sqrt(ballRadius² − holeRadius²) above deck.
const REST_Y = Math.sqrt(Math.max(0, D.ballRadius * D.ballRadius - HR * HR));

type Phase = 'idle' | 'drop' | 'roll' | 'home' | 'settle' | 'reveal' | 'done';

interface Rest {
  index: number;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
}

/**
 * 円盤チャレンジ — a PHYSICAL turntable installed to the right of the pusher, lying
 * FLAT. A real dynamic ball rolls on the spinning disc (kinematic, real friction)
 * and drops into one of 6 recessed circular holes. One hole is JP-Chance; the
 * others fill up with physical resting balls that persist across plays (saved).
 *
 * The outcome is decided purely by physics: the ball is launched against the spin
 * near the rim, circles the deck, and falls into whichever EMPTY hole catches it
 * (filled holes are blocked by resting-ball colliders) — with a nearest-empty-hole
 * snap fallback so a play always resolves.
 */
export class DiscChallenge implements MiniGame {
  readonly kind = 'disc';
  readonly group = new THREE.Group(); // world-anchored, holds the spinning wheel
  private stand = new THREE.Group();
  private wheel = new THREE.Group(); // the rotating deck (visual)
  private restMat: THREE.MeshStandardMaterial;
  private rests: Rest[] = [];

  private discBody!: RAPIER.RigidBody;
  private ballBody: RAPIER.RigidBody | null = null;
  private ballMesh: THREE.Mesh;
  private ballLight: THREE.PointLight;

  private ctx!: MiniGameContext;
  private onDone!: (r: MiniGameResult) => void;
  private filled: boolean[] = [];
  private result = 0;
  private isJp = false;

  private phase: Phase = 'idle';
  private timer = 0;
  private spin = 0;
  private spinSpeed = 1.6;
  private settleTime = 0;
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, private store: GameStore, private physics: PhysicsWorld) {
    this.group.position.set(D.x, D.y, D.z);
    this.group.add(this.wheel);

    this.restMat = new THREE.MeshStandardMaterial({
      color: 0xff8a2c,
      emissive: 0xff6a10,
      emissiveIntensity: 1.3,
      metalness: 0.3,
      roughness: 0.35,
    });

    this.buildVisual();
    this.buildPhysics();
    this.buildStand();
    this.buildDome();
    scene.add(this.group);
    scene.add(this.stand);

    // the dropped lottery ball (hidden until a challenge runs)
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(D.ballRadius, 32, 24), // perfect smooth sphere
      new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffd060, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.35 })
    );
    this.ballMesh.visible = false;
    scene.add(this.ballMesh);
    this.ballLight = new THREE.PointLight(0xffd060, 0, 5);
    scene.add(this.ballLight);

    // persistent fill display
    this.filled = store.discFilled;
    this.rebuildRests();
    bus.on('disc:changed', ({ filled }) => {
      this.filled = filled.slice();
      this.rebuildRests();
    });
  }

  /**
   * Profile (radius, y) of one dimple — a spherical hollow whose radius EQUALS the
   * ball's radius, so the dent's curve matches the ball's underside exactly (not a
   * cup/bowl with its own curvature). It runs from the rim (r=holeRadius, y=0) down
   * to the centre (r=0, y=−depth) where depth = ballRadius − √(ballRadius²−holeRadius²).
   * The seated ball nests flush; a glancing ball can still skim back out.
   */
  private bowlProfile(): THREE.Vector2[] {
    const Rb = D.ballRadius; // hollow shares the ball's radius → curves match
    const yc = REST_Y; // sphere centre height = seated ball-centre height (deck-relative)
    const N = 20;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= N; i++) {
      const r = (i / N) * HR;
      const y = yc - Math.sqrt(Math.max(0, Rb * Rb - r * r)); // lower cap of a ball-radius sphere
      pts.push(new THREE.Vector2(r, y));
    }
    return pts;
  }

  /** Local-space (disc frame) centre of hole i. */
  private localHole(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = i * SEG;
    return out.set(Math.cos(a) * D.holeRing, 0, -Math.sin(a) * D.holeRing);
  }

  /** World-space centre of hole i at the current spin (matches the visual wheel). */
  private worldHole(i: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = i * SEG;
    const lx = Math.cos(a) * D.holeRing;
    const lz = -Math.sin(a) * D.holeRing;
    const c = Math.cos(this.spin);
    const s = Math.sin(this.spin);
    return out.set(D.x + lx * c + lz * s, D.y, D.z - lx * s + lz * c);
  }

  // --- build the visual deck (recessed circular holes) -------------------
  private buildVisual(): void {
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x1b2236, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0c1020, metalness: 0.5, roughness: 0.7, side: THREE.DoubleSide });
    const jpMat = new THREE.MeshStandardMaterial({ color: 0xffcf3a, emissive: 0xffaa00, emissiveIntensity: 1.0, metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide });

    // deck top with 6 circular holes
    const shape = new THREE.Shape();
    shape.absarc(0, 0, D.radius, 0, TAU, false);
    for (let i = 0; i < D.count; i++) {
      const a = i * SEG;
      const hole = new THREE.Path();
      hole.absarc(Math.cos(a) * D.holeRing, Math.sin(a) * D.holeRing, D.holeRadius, 0, TAU, true);
      shape.holes.push(hole);
    }
    const deck = new THREE.ShapeGeometry(shape, 64);
    deck.rotateX(-Math.PI / 2);
    this.wheel.add(new THREE.Mesh(deck, deckMat));

    // rounded dimple (concave bowl) + hole-rim trim + label for each hole
    const profile = this.bowlProfile();
    for (let i = 0; i < D.count; i++) {
      const p = this.localHole(i);
      const isJp = i === D.jpIndex;
      const cupMat = isJp ? jpMat : wallMat;
      const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), cupMat);
      bowl.position.set(p.x, 0, p.z);
      this.wheel.add(bowl);
      // glowing rim around the opening
      const trim = new THREE.Mesh(
        new THREE.TorusGeometry(D.holeRadius, 0.035, 10, 28),
        new THREE.MeshStandardMaterial({
          color: isJp ? 0xff3aa0 : 0x3a4570,
          emissive: isJp ? 0xff1080 : 0x101830,
          emissiveIntensity: isJp ? 1.8 : 0.4,
          metalness: 0.9,
          roughness: 0.3,
        })
      );
      trim.rotation.x = Math.PI / 2;
      trim.position.set(p.x, 0.01, p.z);
      this.wheel.add(trim);

      const label = this.makeLabel(isJp ? 'JP' : `${i + 1}`, isJp);
      label.position.set(p.x, 0.16, p.z);
      this.wheel.add(label);
    }

    // outer rim wall
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(D.radius, D.radius, D.rimHeight, 64, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a3040, metalness: 0.8, roughness: 0.4, side: THREE.DoubleSide })
    );
    rim.position.y = D.rimHeight / 2;
    this.wheel.add(rim);
    // glowing top edge of the rim
    const rimGlow = new THREE.Mesh(
      new THREE.TorusGeometry(D.radius, 0.05, 12, 80),
      new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffaa10, emissiveIntensity: 1.4, metalness: 1, roughness: 0.25 })
    );
    rimGlow.rotation.x = Math.PI / 2;
    rimGlow.position.y = D.rimHeight;
    this.wheel.add(rimGlow);
  }

  // --- build the physics (kinematic spinning trimesh) --------------------
  private buildPhysics(): void {
    const R = this.physics.RAPIER;
    const geos: THREE.BufferGeometry[] = [];

    const deck = new THREE.ShapeGeometry((() => {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, D.radius, 0, TAU, false);
      for (let i = 0; i < D.count; i++) {
        const a = i * SEG;
        const hole = new THREE.Path();
        hole.absarc(Math.cos(a) * D.holeRing, Math.sin(a) * D.holeRing, D.holeRadius, 0, TAU, true);
        shape.holes.push(hole);
      }
      return shape;
    })(), 48);
    deck.rotateX(-Math.PI / 2);
    geos.push(this.plain(deck));

    const profile = this.bowlProfile();
    for (let i = 0; i < D.count; i++) {
      const p = this.localHole(i);
      const bowl = new THREE.LatheGeometry(profile, 28);
      bowl.translate(p.x, 0, p.z);
      geos.push(this.plain(bowl));
    }
    const rim = new THREE.CylinderGeometry(D.radius, D.radius, D.rimHeight, 48, 1, true);
    rim.translate(0, D.rimHeight / 2, 0);
    geos.push(this.plain(rim));

    const merged = mergeGeometries(geos, false)!;
    const verts = merged.attributes.position.array as Float32Array;
    const idx = Uint32Array.from(merged.index!.array);

    this.discBody = this.physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(D.x, D.y, D.z)
    );
    const cd = R.ColliderDesc.trimesh(verts, idx)
      .setFriction(0.7)
      .setRestitution(0.1)
      .setCollisionGroups(groups(GROUP.DISC, GROUP.DISC));
    this.physics.world.createCollider(cd, this.discBody);
  }

  /** Strip a geometry to position-only so mergeGeometries can combine them. */
  private plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position.clone());
    if (g.index) out.setIndex(g.index.clone());
    else out.setIndex([...Array(g.attributes.position.count).keys()]);
    g.dispose();
    return out;
  }

  private buildStand(): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a3040, metalness: 0.8, roughness: 0.45 });
    const neon = new THREE.MeshStandardMaterial({ color: 0x18e0ff, emissive: 0x0aa6ff, emissiveIntensity: 1.4 });
    // pedestal reaches the common ground plane so it stands level with the cabinet
    const gy = LAYOUT.groundY;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, D.y - gy, 0.7), metal);
    post.position.set(D.x, (D.y + gy) / 2, D.z);
    this.stand.add(post);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.18, 32), metal);
    base.position.set(D.x, gy + 0.09, D.z);
    this.stand.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.04, 8, 40), neon);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(D.x, gy + 0.2, D.z);
    this.stand.add(ring);
  }

  /**
   * Transparent glass dome over the disc so a bouncing ball can't fly out over the
   * rim. The dome is a (squashed) hemisphere resting on the deck — its surface of
   * revolution is rotationally symmetric, so it sits on the STATIC group (no spin)
   * with a matching trimesh collider on a FIXED body in the disc collision group.
   */
  private buildDome(): void {
    const R = this.physics.RAPIER;
    const radius = D.radius;
    // smooth glass dome for display
    const geo = new THREE.SphereGeometry(radius, 48, 24, 0, TAU, 0, Math.PI / 2);
    geo.scale(1, D.domeHeight / radius, 1); // squash the hemisphere to the desired height

    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x9fd4ff,
      transparent: true,
      opacity: 0.08,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.6,
      ior: 1.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const dome = new THREE.Mesh(geo, glass);
    dome.renderOrder = 2;
    this.group.add(dome); // group is at (D.x,D.y,D.z) and never rotates

    // physics: a COARSE dome trimesh (the ball only needs containing, not a precise
    // surface) — a fine mesh makes ball-vs-trimesh + CCD far too expensive per step.
    const phys = new THREE.SphereGeometry(radius, 16, 6, 0, TAU, 0, Math.PI / 2);
    phys.scale(1, D.domeHeight / radius, 1);
    const verts = phys.attributes.position.array as Float32Array;
    const idx = Uint32Array.from(phys.index!.array);
    phys.dispose();
    const domeBody = this.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(D.x, D.y, D.z));
    const cd = R.ColliderDesc.trimesh(verts, idx)
      .setRestitution(0.35)
      .setFriction(0.2)
      .setCollisionGroups(groups(GROUP.DISC, GROUP.DISC));
    this.physics.world.createCollider(cd, domeBody);
  }

  private makeLabel(text: string, jp: boolean): THREE.Sprite {
    const [c, g] = create2D(128);
    g.fillStyle = jp ? '#fff2a8' : '#cdd6ff';
    g.font = `900 ${jp ? 54 : 46}px "Segoe UI", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#000';
    g.shadowBlur = 10;
    g.fillText(text, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(jp ? 0.4 : 0.32, jp ? 0.4 : 0.32, 1);
    return spr;
  }

  /** Physical resting balls in filled holes (block the active ball + show state). */
  private rebuildRests(): void {
    for (const r of this.rests) {
      this.physics.world.removeCollider(r.collider, false);
      this.wheel.remove(r.mesh);
      r.mesh.geometry.dispose();
    }
    this.rests = [];
    const R = this.physics.RAPIER;
    for (let i = 0; i < D.count; i++) {
      if (!this.filled[i] || i === D.jpIndex) continue;
      const p = this.localHole(i);
      const cd = R.ColliderDesc.ball(REST_R)
        .setTranslation(p.x, REST_Y, p.z)
        .setCollisionGroups(groups(GROUP.DISC, GROUP.DISC));
      const collider = this.physics.world.createCollider(cd, this.discBody);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(REST_R, 24, 18), this.restMat);
      mesh.position.set(p.x, REST_Y, p.z);
      this.wheel.add(mesh);
      this.rests.push({ index: i, collider, mesh });
    }
  }

  // --- run a challenge ---------------------------------------------------
  start(ctx: MiniGameContext, onDone: (r: MiniGameResult) => void): void {
    this.ctx = ctx;
    this.onDone = onDone;
    this.filled = ctx.store.discFilled;
    this.rebuildRests();
    // outcome is decided by REAL physics — the ball can only seat in an EMPTY hole
    // (filled holes hold a physical resting ball), so it's set when it actually lands.
    this.result = -1;
    this.isJp = false;

    this.spinSpeed = 2.6; // steady spin that carries the rolling ball around
    this.spawnBall(); // launched AGAINST this spin (needs spinSpeed set first)
    bus.emit('sfx', { name: 'spin' });
    this.phase = 'drop';
    this.timer = 0.9;
    this.settleTime = 0;
  }

  private spawnBall(): void {
    const R = this.physics.RAPIER;
    // SAME physics as a field (pusher) ball — heavy, barely bouncy, real friction —
    // and NO scripted guidance: it just rolls on the spinning disc and falls into a hole.
    // LAUNCH it tangentially, AGAINST the disc's spin (roulette-style), just above the
    // deck near the rim — not a plain drop.
    const theta = Math.random() * TAU; // where on the rim it enters
    const Rs = D.holeRing + 0.22; // just outside the hole ring
    const sx = D.x + Math.cos(theta) * Rs;
    const sz = D.z + Math.sin(theta) * Rs;
    // the deck surface at (sx,sz) moves along sign(spin)*(rz,-rx); launch the OPPOSITE way
    const s = Math.sign(this.spinSpeed) || 1;
    const rx = Math.cos(theta) * Rs;
    const rz = Math.sin(theta) * Rs;
    let dirx = -s * rz; // opposite of the surface direction sign(spin)*(rz,-rx)
    let dirz = s * rx;
    const len = Math.hypot(dirx, dirz) || 1;
    const speed = 5.4; // fast enough to circle AGAINST the spin (roulette) before it drags
    dirx = (dirx / len) * speed;
    dirz = (dirz / len) * speed;
    this.ballBody = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(sx, D.y + D.ballRadius + 0.06, sz)
        .setLinvel(dirx, 0, dirz)
        .setLinearDamping(0.12)
        .setAngularDamping(0.8)
        .setCcdEnabled(true)
    );
    const geo = new THREE.IcosahedronGeometry(D.ballRadius, 1);
    const verts = geo.attributes.position.array as Float32Array;
    geo.dispose();
    const cd = (R.ColliderDesc.convexHull(verts) ?? R.ColliderDesc.ball(D.ballRadius))
      .setDensity(2.2)
      .setRestitution(0.02)
      .setFriction(0.5)
      .setCollisionGroups(groups(GROUP.DISC, GROUP.DISC));
    this.physics.world.createCollider(cd, this.ballBody);
    this.ballMesh.visible = true;
    this.ballLight.intensity = 2.2;
  }

  /** Which EMPTY hole the ball is currently seated in (sunk + slow), or -1. */
  private settledHole(): number {
    if (!this.ballBody) return -1;
    const p = this.ballBody.translation();
    const v = this.ballBody.linvel();
    if (Math.hypot(v.x, v.y, v.z) > 0.8) return -1;
    if (p.y > D.y + REST_Y + D.ballRadius * 0.5) return -1; // still riding on the deck
    for (let i = 0; i < D.count; i++) {
      if (this.filled[i] && i !== D.jpIndex) continue; // filled holes are blocked
      const w = this.worldHole(i, this.tmp);
      if (Math.hypot(p.x - w.x, p.z - w.z) < D.holeRadius * 0.95) return i;
    }
    return -1;
  }

  /** Fallback only: the empty hole whose mouth the ball is nearest right now. */
  private nearestEmptyHole(): number {
    const p = this.ballBody?.translation();
    let best: number = D.jpIndex;
    let bestD = Infinity;
    for (let i = 0; i < D.count; i++) {
      if (this.filled[i] && i !== D.jpIndex) continue;
      const w = this.worldHole(i, this.tmp);
      const d = p ? Math.hypot(p.x - w.x, p.z - w.z) : 0;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  private land(hole: number): void {
    this.result = hole;
    this.isJp = hole === D.jpIndex;
    this.phase = 'reveal';
    this.timer = this.isJp ? 1.6 : 1.2;
    this.lockBall();
    this.reveal();
  }

  update(dt: number): void {
    if (this.phase === 'idle' || this.phase === 'done') return;
    this.spin += this.spinSpeed * dt;
    this.applySpin();
    this.syncBall();

    switch (this.phase) {
      case 'drop': {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'roll';
          this.timer = 9.0; // give real physics time to roll in & settle
        }
        break;
      }
      case 'roll': {
        this.timer -= dt;
        if (Math.random() < 0.2) bus.emit('sfx', { name: 'reel' });
        // gradually slow the spin so the rolling ball can drop & settle into a hole
        this.spinSpeed = THREE.MathUtils.lerp(this.spinSpeed, 0.6, Math.min(1, dt * 0.5));
        const h = this.settledHole();
        if (h >= 0) {
          bus.emit('sfx', { name: 'coin' });
          this.land(h);
        } else if (this.timer <= 0) {
          // fallback (rare): nudge it into the nearest empty hole so it always resolves
          this.result = this.nearestEmptyHole();
          this.snapIntoHole();
          this.land(this.result);
        }
        break;
      }
      case 'reveal': {
        this.timer -= dt;
        this.lockBall();
        if (this.isJp && Math.random() < 0.6) {
          const w = this.worldHole(this.result, this.tmp);
          this.ctx.particles.emit(w.x, w.y + 0.4, w.z, 20, new THREE.Color().setHSL(Math.random(), 1, 0.6), 8);
        }
        if (this.timer <= 0) {
          this.phase = 'done';
          this.finish();
        }
        break;
      }
    }
  }

  /** Fallback: drop the ball straight into the result hole. */
  private snapIntoHole(): void {
    if (!this.ballBody) return;
    const w = this.worldHole(this.result, this.tmp);
    this.ballBody.setTranslation({ x: w.x, y: D.y + REST_Y, z: w.z }, true);
    this.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Keep the settled ball riding in the (rotating) result hole. */
  private lockBall(): void {
    if (!this.ballBody) return;
    const w = this.worldHole(this.result, this.tmp);
    this.ballBody.setTranslation({ x: w.x, y: D.y + REST_Y, z: w.z }, true);
    this.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  private applySpin(): void {
    this.wheel.rotation.y = this.spin;
    const h = this.spin / 2;
    this.discBody.setNextKinematicRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) });
  }

  private syncBall(): void {
    if (!this.ballBody) return;
    const t = this.ballBody.translation();
    this.ballMesh.position.set(t.x, t.y, t.z);
    const q = this.ballBody.rotation();
    this.ballMesh.quaternion.set(q.x, q.y, q.z, q.w);
    this.ballLight.position.set(t.x, t.y + 0.3, t.z);
  }

  /** Idle: gently rotate the installed turntable when it isn't being played. */
  tick(dt: number): void {
    if (this.phase !== 'idle') return;
    this.spin += 0.15 * dt; // slow idle showcase spin
    this.applySpin();
  }

  private reveal(): void {
    if (this.isJp) {
      this.ctx.hud.showOverlay('JP CHANCE 的中!!', 'JP チャレンジへ！');
      bus.emit('sfx', { name: 'jackpot' });
      bus.emit('fx:flash', {});
    } else {
      bus.emit('sfx', { name: 'win' });
    }
  }

  private finish(): void {
    this.ctx.hud.hideOverlay();
    if (this.isJp) {
      this.ctx.store.resetDisc();
      // chain into the dedicated JP (jackpot) drop stage — it awards the pool.
      this.onDone({ payout: 0, bonus: 'jackpot', label: 'JP CHANCE' });
    } else {
      this.ctx.store.fillDiscHole(this.result);
      this.onDone({ payout: 0, label: `DISC ${this.result + 1}` });
    }
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
