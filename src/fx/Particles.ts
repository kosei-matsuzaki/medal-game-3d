import * as THREE from 'three';
import { create2D } from '../render/canvasText';

interface P {
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * Lightweight additive Points particle system (sparks / confetti) with a fixed
 * pool. Driven on the CPU; one draw call.
 */
export class Particles {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private positions: Float32Array;
  private colors: Float32Array;
  private parts: P[] = [];
  private cursor = 0;
  private capacity: number;
  private gravity = -9;

  constructor(scene: THREE.Scene, capacity = 600) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) {
      this.parts.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0 });
      this.positions[i * 3 + 1] = -999;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.18,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: sparkTexture(),
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, count: number, color: THREE.Color, speed = 6): void {
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const p = this.parts[idx];
      p.maxLife = 0.6 + Math.random() * 1.0;
      p.life = p.maxLife;
      const ang = Math.random() * Math.PI * 2;
      const elev = Math.random() * Math.PI * 0.5;
      const s = speed * (0.4 + Math.random() * 0.6);
      p.vx = Math.cos(ang) * Math.cos(elev) * s;
      p.vy = Math.sin(elev) * s + 2;
      p.vz = Math.sin(ang) * Math.cos(elev) * s;
      this.positions[idx * 3] = x;
      this.positions[idx * 3 + 1] = y;
      this.positions[idx * 3 + 2] = z;
      const c = color.clone().offsetHSL((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.2);
      this.colors[idx * 3] = c.r;
      this.colors[idx * 3 + 1] = c.g;
      this.colors[idx * 3 + 2] = c.b;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy += this.gravity * dt;
      this.positions[i * 3] += p.vx * dt;
      this.positions[i * 3 + 1] += p.vy * dt;
      this.positions[i * 3 + 2] += p.vz * dt;
      const f = Math.max(0, p.life / p.maxLife);
      this.colors[i * 3] *= 1; // keep hue
      if (p.life <= 0) this.positions[i * 3 + 1] = -999;
      // fade via shrinking handled by overall opacity; dim color
      const dim = 0.98 + f * 0.02;
      this.colors[i * 3] *= dim;
      this.colors[i * 3 + 1] *= dim;
      this.colors[i * 3 + 2] *= dim;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

function sparkTexture(): THREE.Texture {
  const [c, ctx] = create2D(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,240,200,0.9)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
