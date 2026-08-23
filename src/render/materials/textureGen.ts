import * as THREE from 'three';
import { create2D as canvas } from '../canvasText';

/** Procedural texture generation — keeps the project asset-free by default. */

/** Glossy dark playfield with a regular dot/peg pattern (arcade pusher look). */
export function fieldTexture(size = 512): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  // deep blue-black base with a faint vignette glow
  const bg = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.7);
  bg.addColorStop(0, '#10182e');
  bg.addColorStop(1, '#070a16');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // regular grid of small studs/dots
  const step = 34;
  for (let y = step / 2; y < size; y += step) {
    for (let x = step / 2; x < size; x += step) {
      const r = 4.5;
      const g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0, x, y, r);
      g.addColorStop(0, 'rgba(150,180,230,0.9)');
      g.addColorStop(0.5, 'rgba(60,90,150,0.5)');
      g.addColorStop(1, 'rgba(20,30,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = 4;
  return tex;
}

/** Emissive map matching fieldTexture's dots so the studs glow under bloom. */
export function fieldEmissiveTexture(size = 512): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const step = 34;
  for (let y = step / 2; y < size; y += step) {
    for (let x = step / 2; x < size; x += step) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 3.5);
      g.addColorStop(0, 'rgba(70,130,255,0.8)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}
