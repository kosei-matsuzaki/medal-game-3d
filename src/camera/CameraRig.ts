import * as THREE from 'three';
import { damp } from '../utils/math';

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/**
 * Main game camera with smoothly-damped pose transitions. CameraDirector pushes
 * named poses (play, board, jackpot, bonus) and the rig eases toward them.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector3(0, 0.4, 1.2);
  private desired: CameraPose;
  private shakeAmp = 0;
  private shakeTime = 0;

  // Free-orbit state. When `free` is on, the user is dragging the camera and it
  // orbits around `pivot` on a sphere (yaw/pitch/radius) instead of easing toward
  // a named pose. Auto-poses (PLAY / disc / JP …) are ignored until resetFree().
  private free = false;
  private yaw = 0;
  private pitch = 0.6;
  private radius = 15;
  private readonly pivot = new THREE.Vector3();
  private static readonly PITCH_MIN = -0.15; // just below horizon
  private static readonly PITCH_MAX = 1.45; // near top-down
  private static readonly RADIUS_MIN = 3.5;
  private static readonly RADIUS_MAX = 42;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
    this.desired = CameraRig.PLAY;
    this.camera.position.copy(this.desired.position);
    this.camera.lookAt(this.target);
  }

  get isFree(): boolean {
    return this.free;
  }

  // Main view. Frames the playfield, the payout tray AND the back-top monitor —
  // but tightly: the subject fills ~91% of frame height (it was 68%, which left
  // the big black bands top and bottom). A longer lens (fov 46, was 56) flattens
  // the perspective so the cabinet reads as a product shot, and the lower eye
  // height (4.7, was 6.4) looks slightly UP at it, which makes it read as bigger.
  static readonly PLAY: CameraPose = {
    position: new THREE.Vector3(0, 4.7, 13.4),
    target: new THREE.Vector3(0, 0.75, -0.2),
    fov: 46,
  };
  // Board turn push-in — fills the frame with the monitor so the one moment the
  // game is actually about isn't the smallest thing on screen.
  static readonly SLOT: CameraPose = {
    position: new THREE.Vector3(0, 3.9, 5.2),
    target: new THREE.Vector3(0, 3.55, -2.2),
    fov: 34,
  };
  // Dice tray — the unit is BOLTED TO THE LEFT TAPER WALL at roughly
  // (-3.26, 1.35, 2.22) rather than standing on a pedestal out at x=-4.3.
  //
  // Framed WIDE on purpose. A tight pose filled the screen with a metal box and
  // cut the cabinet out entirely, which loses the one thing the new mounting was
  // for — the tray is part of this machine. This keeps the cabinet's left flank
  // and the monitor in frame while still reading the dice, and the sight line
  // stays outboard of the cabinet so its own wall is never in the way.
  static readonly DICE: CameraPose = {
    position: new THREE.Vector3(-3.7, 4.35, 7.3),
    target: new THREE.Vector3(-2.55, 1.95, 2.5),
    fov: 40,
  };
  // チンチロ — the same tray, aimed OFF to the right of it so the tray lands in
  // the left third of frame and the hand panel owns the right. Same trick the
  // bowl pose uses; only the aim point moves, so the angle on the dice is
  // unchanged.
  static readonly CHINCHIRO: CameraPose = {
    position: new THREE.Vector3(-3.7, 4.35, 7.3),
    target: new THREE.Vector3(-1.9, 1.95, 2.4),
    fov: 42,
  };
  // Jackpot bowl — looks DOWN INTO the funnel, now bolted to the RIGHT taper wall
  // at roughly (3.43, 1.35, 2.26). Aimed LEFT of the bowl's centre on purpose, so
  // the bowl sits in the right half of frame and the roulette overlay owns the
  // left. Kept outboard of the cabinet for the same reason as the tray.
  static readonly BOWL: CameraPose = {
    position: new THREE.Vector3(3.8, 4.45, 7.4),
    target: new THREE.Vector3(2.5, 2.0, 2.5),
    fov: 40,
  };
  // Alternate FIXED view: tighter still on the field + monitor. Deliberately
  // crops the payout tray — this is the "look at the machine" view, PLAY is the
  // "play the machine" one.
  static readonly BONUS: CameraPose = {
    position: new THREE.Vector3(0, 3.9, 10.2),
    target: new THREE.Vector3(0, 1.5, -1.0),
    fov: 42,
  };

  setPose(pose: CameraPose): void {
    this.desired = pose;
  }

  /** Seed the spherical orbit params from the CURRENT camera so grabbing the
   *  view is seamless (no jump). Called the first time the user starts dragging. */
  private enterFree(): void {
    if (this.free) return;
    this.free = true;
    this.pivot.copy(this.target);
    const off = this.camera.position.clone().sub(this.pivot);
    this.radius = THREE.MathUtils.clamp(off.length(), CameraRig.RADIUS_MIN, CameraRig.RADIUS_MAX);
    this.yaw = Math.atan2(off.x, off.z);
    this.pitch = THREE.MathUtils.clamp(
      Math.asin(off.y / Math.max(1e-4, off.length())),
      CameraRig.PITCH_MIN,
      CameraRig.PITCH_MAX,
    );
  }

  /** Orbit the view. dx/dy are pointer deltas in pixels. */
  orbit(dx: number, dy: number): void {
    this.enterFree();
    this.yaw -= dx * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.005, CameraRig.PITCH_MIN, CameraRig.PITCH_MAX);
  }

  /** Dolly in/out. `delta` is a wheel deltaY (positive = zoom out). */
  zoom(delta: number): void {
    this.enterFree();
    this.radius = THREE.MathUtils.clamp(
      this.radius * (1 + delta * 0.0012),
      CameraRig.RADIUS_MIN,
      CameraRig.RADIUS_MAX,
    );
  }

  /** Pan the pivot in the camera's screen plane. dx/dy are pointer deltas. */
  pan(dx: number, dy: number): void {
    this.enterFree();
    const scale = this.radius * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.pivot.addScaledVector(right, -dx * scale);
    this.pivot.addScaledVector(up, dy * scale);
  }

  /** Release manual control and return to the auto-framed pose. */
  resetFree(): void {
    this.free = false;
  }

  shake(intensity: number, duration: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, intensity);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  update(dt: number): void {
    const k = 4.5;
    if (this.free) {
      // user-controlled orbit around the pivot; ease toward the spherical target
      // so drags feel smooth. fov relaxes to a neutral value while free.
      const cp = Math.cos(this.pitch);
      const tx = this.pivot.x + this.radius * cp * Math.sin(this.yaw);
      const ty = this.pivot.y + this.radius * Math.sin(this.pitch);
      const tz = this.pivot.z + this.radius * cp * Math.cos(this.yaw);
      this.camera.position.x = damp(this.camera.position.x, tx, 10, dt);
      this.camera.position.y = damp(this.camera.position.y, ty, 10, dt);
      this.camera.position.z = damp(this.camera.position.z, tz, 10, dt);
      this.target.x = damp(this.target.x, this.pivot.x, 10, dt);
      this.target.y = damp(this.target.y, this.pivot.y, 10, dt);
      this.target.z = damp(this.target.z, this.pivot.z, 10, dt);
      this.camera.fov = damp(this.camera.fov, 50, k, dt);
    } else {
      this.camera.position.x = damp(this.camera.position.x, this.desired.position.x, k, dt);
      this.camera.position.y = damp(this.camera.position.y, this.desired.position.y, k, dt);
      this.camera.position.z = damp(this.camera.position.z, this.desired.position.z, k, dt);
      this.target.x = damp(this.target.x, this.desired.target.x, k, dt);
      this.target.y = damp(this.target.y, this.desired.target.y, k, dt);
      this.target.z = damp(this.target.z, this.desired.target.z, k, dt);
      this.camera.fov = damp(this.camera.fov, this.desired.fov, k, dt);
    }
    this.camera.updateProjectionMatrix();

    this.camera.lookAt(this.target);

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const a = this.shakeAmp * Math.min(1, this.shakeTime * 3);
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      if (this.shakeTime <= 0) this.shakeAmp = 0;
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
