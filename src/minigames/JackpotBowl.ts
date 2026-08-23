import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { MiniGame, MiniGameContext, MiniGameResult } from './MiniGame';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { BodyTag, GROUP, groups } from '../physics/types';
import { LAYOUT, wallMount } from '../pusher/layout';
import { create2D } from '../render/canvasText';
import { CameraRig } from '../camera/CameraRig';
import { bus } from '../core/EventBus';
import { TAU } from '../utils/math';
import { IdleGlow } from '../render/idleGlow';

const B = LAYOUT.bowl;
const RB = B.ballRadius;
const N = B.segments;

/** Where the bowl hangs off the cabinet's right flank, and the wall's yaw there. */
/** Where the bowl bolts on — see the matching note in DiceTray. */
/** Key-light intensity for the unit: idle, and while it is being played. */
const KEY_IDLE = 2.4;
const KEY_ON = 9.0;

const MOUNT = wallMount(1, B.z);
const BX = MOUNT.x + (B.rimRadius + 0.02) / Math.cos(MOUNT.yaw);

// Square canvas: the wheel is round, so a 2:1 panel wasted half the pixels and
// left the wedges too small to read at overlay size.
const CW = 660;
const CH = 660;

/** One roulette wedge. `jackpot` takes the whole progressive pool instead. */
interface Prize {
  medals: number;
  jackpot?: boolean;
  text: string;
  color: string;
}

/**
 * The wheel. Exactly one JACKPOT among `segments`, the rest paying medals on a
 * steep curve — most wedges are small, so the wheel is mostly a consolation and
 * the eye keeps going back to the one that isn't.
 *
 * Figures here are held DOWN because every one of them then rides the チンチロ,
 * which averages about ×1.5. What the wheel shows is the stake, not the payout.
 */
const PRIZES: Prize[] = (() => {
  const out: Prize[] = [];
  const medal = (m: number, color: string): Prize => ({ medals: m, text: `${m}`, color });
  out.push({ medals: 0, jackpot: true, text: 'JACKPOT', color: '#ff48c0' });
  out.push(medal(66, '#ffcf4a'));
  out.push(medal(10, '#7f9ac4'));
  out.push(medal(26, '#8fd0ff'));
  out.push(medal(10, '#7f9ac4'));
  out.push(medal(20, '#8fd0ff'));
  out.push(medal(10, '#7f9ac4'));
  out.push(medal(40, '#ffcf4a'));
  out.push(medal(10, '#7f9ac4'));
  out.push(medal(20, '#8fd0ff'));
  out.push(medal(10, '#7f9ac4'));
  out.push(medal(26, '#8fd0ff'));
  out.push(medal(10, '#7f9ac4'));
  out.push(medal(20, '#8fd0ff'));
  out.push(medal(10, '#7f9ac4'));
  out.push(medal(40, '#ffcf4a'));
  return out;
})();

/** Radians/sec the wheel turns. Slow enough to read a wedge, fast enough that
 *  nobody can time the ball against it. */
const WHEEL_SPEED = 1.15;
/** How long the result is held on screen before the turn hands back. */
const HOLD = 2.6;

/** Surface height of the funnel at radius r (0 at the hole, `depth` at the rim). */
function profileY(r: number): number {
  const t = (r - B.holeRadius) / (B.rimRadius - B.holeRadius);
  return B.depth * Math.pow(Math.max(0, Math.min(1, t)), B.profileExp);
}

/**
 * 抽選ボウル — the jackpot lottery, and the only way the progressive pool is won.
 *
 * A ball is fired around the rim of a funnel. It orbits, losing speed, spiralling
 * inward, until it finally plunges through the hole at the centre. A roulette
 * turns on the monitor the whole time, and the wedge under the pointer AT THE
 * INSTANT the ball disappears is the prize.
 *
 * Nothing is pre-decided: the physics chooses only WHEN the ball falls, and the
 * when chooses the what. The drama comes free — the ball visibly runs out of
 * road while the JACKPOT wedge swings past again and again.
 *
 * Reached by arriving at a 目的地 on the すごろく board, so every jackpot in the
 * game is something the player travelled to.
 */
export class JackpotBowl implements MiniGame {
  readonly kind = 'bowl';

  private group = new THREE.Group();
  private stand = new THREE.Group();
  private physics: PhysicsWorld;

  private ballBody: RAPIER.RigidBody | null = null;
  private ballMesh: THREE.Mesh;
  private ballLight: THREE.PointLight;

  private ctx!: MiniGameContext;
  private onDone!: (r: MiniGameResult) => void;

  private phase: 'idle' | 'spin' | 'reveal' = 'idle';
  private timer = 0;
  private elapsed = 0;
  private wheelAngle = 0;
  private resultIdx = -1;

  // The roulette is a DOM overlay, NOT a plane on the in-world monitor: the
  // camera has to be down at the bowl to read the ball's orbit, and from there
  // the monitor is off-screen entirely. The whole mechanic is watching the wheel
  // AND the ball at the same time, so the wheel has to live above the 3D view.
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;

  private glow!: IdleGlow;
  private key!: THREE.PointLight;
  private origin = new THREE.Vector3(BX, B.y, B.z);
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.physics = physics;
    this.group.position.copy(this.origin);
    scene.add(this.group);
    scene.add(this.stand);

    this.buildBowl();
    this.buildStand();

    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(RB, 28, 20),
      new THREE.MeshStandardMaterial({
        color: 0xfff0c0,
        emissive: 0xffd060,
        emissiveIntensity: 1.6,
        metalness: 0.35,
        roughness: 0.3,
      })
    );
    this.ballMesh.visible = false;
    this.ballMesh.castShadow = true;
    scene.add(this.ballMesh);
    this.ballLight = new THREE.PointLight(0xffd060, 0, 4);
    scene.add(this.ballLight);

    [this.canvas, this.g] = create2D(CW, CH);
    this.canvas.className = 'bowl-roulette';
    (document.getElementById('ui-root') ?? document.body).appendChild(this.canvas);

    // dark until it is actually being played, so the cabinet stays the subject
    this.key = new THREE.PointLight(0xffd8f0, KEY_IDLE, 4.2, 2);
    this.key.position.set(BX, B.y + 1.15, B.z);
    scene.add(this.key);

    this.glow = new IdleGlow([this.group, this.stand]);
  }

  /** Light the unit up only while it is the active minigame. */
  setSpotlit(on: boolean): void {
    this.glow.setActive(on);
    // The cabinet's own spots do not reach out here, so without a light of its
    // own the unit's metal is unlit and all that survives on screen is its neon
    // trim — which is exactly why it read as a floating light fixture rather than
    // as a machined box bolted to the side of the machine. Dim while idle so the
    // cabinet stays the subject, up when it is the unit's turn.
    this.key.intensity = on ? KEY_ON : KEY_IDLE;
  }

  // --- construction ---------------------------------------------------------

  /** Funnel surface (a lathe of the vortex profile) + a lip so nothing escapes. */
  private buildBowl(): void {
    const pts: THREE.Vector2[] = [];
    const STEPS = 30;
    for (let i = 0; i <= STEPS; i++) {
      const r = B.holeRadius + (B.rimRadius - B.holeRadius) * (i / STEPS);
      pts.push(new THREE.Vector2(r, profileY(r)));
    }
    // vertical lip at the rim — the ball is launched hard and would otherwise
    // ride straight over the edge
    pts.push(new THREE.Vector2(B.rimRadius, B.depth + 0.34));

    const geo = new THREE.LatheGeometry(pts, 72);
    geo.computeVertexNormals();

    // Light enough to actually SEE the funnel. At 0x1b2440 the bowl body was
    // darker than the cabinet behind it, so from the play camera the unit read as
    // a cyan ring floating above a magenta ring with nothing joining them — the
    // shape doing all the work was invisible.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a4a68,
      metalness: 0.6,
      roughness: 0.3,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // glowing ring around the lip, and a hot ring around the hole so the target
    // is unmistakable from the fixed camera
    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(B.rimRadius + 0.03, 0.045, 10, 72),
      new THREE.MeshStandardMaterial({ color: 0x18e0ff, emissive: 0x0aa6ff, emissiveIntensity: 1.4, metalness: 0.8, roughness: 0.3 })
    );
    lip.rotation.x = Math.PI / 2;
    lip.position.y = B.depth + 0.34;
    this.group.add(lip);

    const holeRing = new THREE.Mesh(
      new THREE.TorusGeometry(B.holeRadius + 0.02, 0.03, 10, 40),
      new THREE.MeshStandardMaterial({ color: 0xff48c0, emissive: 0xd11080, emissiveIntensity: 1.7, metalness: 0.6, roughness: 0.3 })
    );
    holeRing.rotation.x = Math.PI / 2;
    this.group.add(holeRing);

    // physics: the lathe surface as a fixed trimesh, isolated in its own group
    const R = this.physics.RAPIER;
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.fixed().setTranslation(BX, B.y, B.z)
    );
    const pos = geo.attributes.position;
    const verts = pos.array as Float32Array;
    const idx = geo.index
      ? Uint32Array.from(geo.index.array)
      : Uint32Array.from({ length: pos.count }, (_, i) => i);
    const cd = R.ColliderDesc.trimesh(verts, idx)
      .setFriction(0.16) // low: the ball has to keep its speed and orbit a while
      .setRestitution(0.05)
      .setCollisionGroups(groups(GROUP.BOWL, GROUP.BOWL));
    this.physics.world.createCollider(cd, body);
  }

  /**
   * The bracket that holds it on. Not a pedestal: a collar and two gussets
   * running back to the cabinet's outer wall face, so the bowl reads as bolted to
   * this machine rather than parked beside it. The bowl itself is a surface of
   * revolution, so only the bracket needs the wall's yaw.
   */
  /**
   * The bracket that carries the bowl on the cabinet wall.
   *
   * It replaces a floor-to-bowl column: a lit post holding a funnel in mid-air
   * beside the machine read as furniture standing next to the game rather than
   * as part of it. A short arm reaching back to the taper wall says the unit is
   * bolted to the cabinet, which is what it now is.
   */
  private buildStand(): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x4b5466, metalness: 0.8, roughness: 0.4 });
    this.stand.position.copy(this.origin);
    // the bowl hangs on the RIGHT taper wall, which yaws the opposite way to the
    // dice tray's; local -x then points at the wall
    this.stand.rotation.y = MOUNT.yaw;

    const reach = 0.55;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(reach, 0.12, 0.34), metal);
    arm.position.set(-(B.rimRadius * 0.55 + reach / 2), -0.12, 0);
    arm.castShadow = true;
    this.stand.add(arm);

    // a shallow collar under the funnel, so it does not appear to float on one strut
    const collar = new THREE.Mesh(
      // Kept INSIDE the rim. At 0.92 the collar was wider than the funnel it
      // supports, so from the play camera it read as a separate saucer floating
      // under a separate bowl instead of as the base the bowl is mounted on.
      new THREE.CylinderGeometry(B.rimRadius * 0.62, B.rimRadius * 0.46, 0.1, 28),
      metal
    );
    collar.position.set(0, -0.13, 0);
    collar.castShadow = true;
    this.stand.add(collar);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(B.rimRadius * 0.64, 0.024, 8, 40),
      new THREE.MeshStandardMaterial({ color: 0xff48c0, emissive: 0xd11080, emissiveIntensity: 1.3 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, -0.09, 0);
    this.stand.add(ring);

    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(reach, 0.02, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xff48c0, emissive: 0xd11080, emissiveIntensity: 1.2 })
    );
    strip.position.set(-(B.rimRadius * 0.55 + reach / 2), -0.05, 0);
    this.stand.add(strip);
  }

  // --- play -----------------------------------------------------------------

  start(ctx: MiniGameContext, onDone: (r: MiniGameResult) => void): void {
    this.ctx = ctx;
    this.onDone = onDone;
    this.phase = 'spin';
    this.timer = 0;
    this.elapsed = 0;
    this.resultIdx = -1;
    this.canvas.classList.add('show');

    this.launchBall();

    ctx.camera.setPose(CameraRig.BOWL);
    bus.emit('sfx', { name: 'spin' });
    this.draw();
  }

  /** Fire the ball around the rim so it starts in a fast, wide orbit. */
  private launchBall(): void {
    this.removeBall();
    const R = this.physics.RAPIER;
    const r = B.rimRadius * 0.86;
    const a = Math.random() * TAU;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = profileY(r) + RB + 0.02;
    // tangential (counter-clockwise seen from above)
    const tx = -Math.sin(a) * B.launchSpeed;
    const tz = Math.cos(a) * B.launchSpeed;

    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(BX + x, B.y + y, B.z + z)
        .setLinvel(tx, 0, tz)
        .setLinearDamping(0.16)
        .setAngularDamping(0.4)
        .setCcdEnabled(true)
    );
    const cd = R.ColliderDesc.ball(RB)
      .setDensity(2.6)
      .setFriction(0.16)
      .setRestitution(0.06)
      .setCollisionGroups(groups(GROUP.BOWL, GROUP.BOWL));
    this.physics.world.createCollider(cd, body);
    this.ballBody = body;
    this.ballMesh.visible = true;
  }

  private removeBall(): void {
    if (this.ballBody) {
      this.physics.removeBody(this.ballBody);
      this.ballBody = null;
    }
    this.ballMesh.visible = false;
    this.ballLight.intensity = 0;
  }

  update(dt: number): void {
    if (this.phase === 'idle') return;

    // the wheel turns throughout, and freezes the instant the ball is gone
    if (this.phase === 'spin') this.wheelAngle = (this.wheelAngle + WHEEL_SPEED * dt) % TAU;

    if (this.phase === 'spin' && this.ballBody) {
      this.elapsed += dt;
      const t = this.ballBody.translation();
      this.ballMesh.position.set(t.x, t.y, t.z);
      const q = this.ballBody.rotation();
      this.ballMesh.quaternion.set(q.x, q.y, q.z, q.w);
      this.ballLight.position.set(t.x, t.y + 0.2, t.z);
      this.ballLight.intensity = 1.6;

      const local = this.tmp.set(t.x - BX, t.y - B.y, t.z - B.z);

      // A play must ALWAYS resolve. Once the ball has had its fun, pull it toward
      // the centre a little harder each second until it drops — otherwise a lucky
      // stable orbit strands the whole game.
      if (this.elapsed > B.patience) {
        const pull = Math.min(6, (this.elapsed - B.patience) * 2.2);
        const rad = Math.hypot(local.x, local.z) || 1;
        this.ballBody.applyImpulse(
          { x: (-local.x / rad) * pull * dt, y: 0, z: (-local.z / rad) * pull * dt },
          true
        );
      }

      // through the hole → lock in whatever the pointer is on RIGHT NOW
      if (local.y < -RB * 1.5) this.resolve();
      // safety net: somehow escaped the bowl
      else if (local.y > B.depth + 1.2 || Math.hypot(local.x, local.z) > B.rimRadius + 0.6) this.resolve();
    }

    if (this.phase === 'reveal') {
      this.timer -= dt;
      if (this.timer <= 0) this.finish();
    }

    this.draw();
  }

  /** The ball is gone: read the wedge under the pointer and commit to it. */
  private resolve(): void {
    this.resultIdx = this.wedgeAtPointer();
    this.removeBall();
    this.phase = 'reveal';
    this.timer = HOLD;

    const prize = PRIZES[this.resultIdx];
    const p = this.ctx.particles;
    if (prize.jackpot) {
      p.emit(BX, B.y + 0.6, B.z, 160, new THREE.Color(0xff48c0), 9);
      bus.emit('sfx', { name: 'jackpot' });
      bus.emit('fx:flash', { bloom: 2.2 });
      bus.emit('fx:shake', { intensity: 0.4, duration: 0.9 });
      this.ctx.hud.showOverlay('JACKPOT!!', '大当たり!!', true);
    } else {
      const big = prize.medals >= 80;
      p.emit(BX, B.y + 0.5, B.z, big ? 110 : 60, new THREE.Color(big ? 0xffe24a : 0xffd060), big ? 8 : 6);
      bus.emit('sfx', { name: big ? 'bigwin' : 'win' });
      bus.emit('fx:flash', { bloom: big ? 1.3 : 0.7 });
      this.ctx.hud.showOverlay(`${prize.medals} メダル`, '抽選ボウル', true);
    }
  }

  /**
   * Which wedge sits under the pointer (fixed at the top of the wheel).
   * Wedge i spans [i·seg, (i+1)·seg) before rotation, so the pointer at angle
   * -π/2 in wheel space picks index ⌊(-π/2 - angle) / seg⌋.
   */
  private wedgeAtPointer(): number {
    const seg = TAU / N;
    const a = (((-Math.PI / 2 - this.wheelAngle) % TAU) + TAU) % TAU;
    return Math.floor(a / seg) % N;
  }

  private finish(): void {
    this.phase = 'idle';
    const prize = PRIZES[this.resultIdx] ?? PRIZES[PRIZES.length - 1];
    this.onDone(
      prize.jackpot
        ? { payout: 0, jackpot: true, label: 'JACKPOT' }
        : { payout: prize.medals, label: `BOWL ${prize.medals}` }
    );
  }

  stop(): void {
    this.phase = 'idle';
    this.removeBall();
    this.canvas.classList.remove('show');
    if (this.ctx) this.ctx.hud.hideOverlayAfter(0.35);
  }

  // --- roulette drawing -----------------------------------------------------

  private draw(): void {
    const g = this.g;
    g.clearRect(0, 0, CW, CH);

    const cx = CW / 2;
    const cy = CH / 2 + 16;
    const R = 268;
    const seg = TAU / N;

    // backing disc so the wheel reads against the 3D scene behind it
    g.beginPath();
    g.arc(cx, cy, R + 22, 0, TAU);
    g.fillStyle = 'rgba(4, 6, 14, 0.9)';
    g.fill();
    g.strokeStyle = 'rgba(255, 120, 200, 0.55)';
    g.lineWidth = 4;
    g.stroke();

    for (let i = 0; i < N; i++) {
      const a0 = i * seg + this.wheelAngle;
      const prize = PRIZES[i];
      const hit = this.phase === 'reveal' && i === this.resultIdx;

      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, R, a0, a0 + seg);
      g.closePath();
      g.fillStyle = hit ? prize.color : prize.jackpot ? '#5c1440' : '#0d1428';
      g.fill();
      g.strokeStyle = prize.color;
      g.lineWidth = hit ? 5 : 2;
      g.stroke();

      // Label along its own radius. On the left half the radius points back at
      // the viewer, so flip the glyphs 180° there or half the wheel reads upside
      // down.
      const mid = a0 + seg / 2;
      const flipped = Math.cos(mid) < 0;
      g.save();
      g.translate(cx, cy);
      g.rotate(flipped ? mid + Math.PI : mid);
      g.textBaseline = 'middle';
      g.textAlign = flipped ? 'left' : 'right';
      g.fillStyle = hit ? '#04060e' : prize.color;
      g.font = prize.jackpot ? '700 24px "Chakra Petch", sans-serif' : '700 38px "Chakra Petch", sans-serif';
      g.fillText(prize.text, flipped ? -R + 16 : R - 16, 0);
      g.restore();
    }

    // hub
    g.beginPath();
    g.arc(cx, cy, 52, 0, TAU);
    g.fillStyle = '#0b1122';
    g.fill();
    g.strokeStyle = '#ff48c0';
    g.lineWidth = 3;
    g.stroke();

    // fixed pointer at the top
    g.beginPath();
    g.moveTo(cx, cy - R - 30);
    g.lineTo(cx - 24, cy - R + 10);
    g.lineTo(cx + 24, cy - R + 10);
    g.closePath();
    g.fillStyle = '#ffcf4a';
    g.fill();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (this.phase === 'reveal' && this.resultIdx >= 0) {
      const prize = PRIZES[this.resultIdx];
      g.font = '700 46px "Noto Sans JP", sans-serif';
      g.fillStyle = prize.color;
      g.shadowColor = prize.color;
      g.shadowBlur = 26;
      g.fillText(prize.jackpot ? 'JACKPOT!!' : `${prize.medals} メダル`, cx, 34);
      g.shadowBlur = 0;
    } else {
      g.font = '700 26px "Noto Sans JP", sans-serif';
      g.fillStyle = '#8fb4e8';
      g.fillText('穴に落ちた瞬間が当たり', cx, 30);
    }
  }
}
