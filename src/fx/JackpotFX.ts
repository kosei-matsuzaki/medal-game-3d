import * as THREE from 'three';
import { Particles } from './Particles';
import { MedalBurst } from './MedalBurst';
import { PostFX } from '../render/PostFX';
import { CameraRig } from '../camera/CameraRig';
import { bus } from '../core/EventBus';

/**
 * Orchestrates the big spectacle: bloom spike, camera shake, confetti bursts,
 * and a mass medal fountain. Used for jackpot wins and big payouts.
 */
export class JackpotFX {
  private confettiTimer = 0;
  private confettiRemaining = 0;

  constructor(
    private particles: Particles,
    private burst: MedalBurst,
    private postfx: PostFX,
    private camera: CameraRig
  ) {
    bus.on('fx:burst', ({ count, jackpot }) => this.burst.fire(count, jackpot));
    bus.on('fx:shake', ({ intensity, duration }) => this.camera.shake(intensity, duration));
    bus.on('fx:flash', () => this.postfx.pulseBloom(2.0));
  }

  /** Full jackpot celebration. */
  celebrate(medalCount: number): void {
    this.postfx.pulseBloom(3.0);
    this.camera.shake(0.35, 1.2);
    this.burst.fire(medalCount, true);
    this.confettiRemaining = 2.5;
    this.confettiTimer = 0;
    bus.emit('sfx', { name: 'jackpot' });
  }

  /** Smaller burst for ordinary big wins. */
  bigWin(medalCount: number): void {
    this.postfx.pulseBloom(1.3);
    this.camera.shake(0.12, 0.5);
    this.confettiRemaining = 0.8;
    this.particles.emit(0, 2, 0.5, 80, new THREE.Color(0xffd060), 7);
    bus.emit('sfx', { name: 'bigwin' });
  }

  update(dt: number): void {
    if (this.confettiRemaining > 0) {
      this.confettiRemaining -= dt;
      this.confettiTimer -= dt;
      if (this.confettiTimer <= 0) {
        this.confettiTimer = 0.12;
        const x = (Math.random() - 0.5) * 4;
        this.particles.emit(x, 4 + Math.random(), 0.5, 40, new THREE.Color().setHSL(Math.random(), 0.9, 0.6), 8);
      }
    }
    this.particles.update(dt);
  }
}
