import * as THREE from 'three';
import { LAYOUT } from '../pusher/layout';

/**
 * The arcade floor at LAYOUT.groundY. Without it the cabinet's shadow has
 * nothing to land on and the whole rig reads as floating in a gradient.
 *
 * Two layers: a near-black, slightly glossy slab (low roughness so the
 * environment map smears across it just enough to feel like a real floor), plus
 * an additive radial pool directly under the cabinet — "one spotlit machine on a
 * dark arcade floor" rather than an object on a backdrop.
 */
export function setupFloor(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  group.name = 'floor';

  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({
      color: 0x05070f,
      roughness: 0.22,
      metalness: 0.05,
    })
  );
  slab.rotation.x = -Math.PI / 2;
  // a hair below groundY so it can't z-fight the payout bin's underside, which
  // sits exactly on that plane
  slab.position.y = LAYOUT.groundY - 0.005;
  slab.receiveShadow = true;
  group.add(slab);

  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 13),
    new THREE.MeshBasicMaterial({
      map: lightPoolTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, LAYOUT.groundY + 0.01, 0.4);
  pool.renderOrder = -1;
  group.add(pool);

  scene.add(group);
  return group;
}

/** Soft warm radial falloff — the light the marquee spot spills onto the floor. */
function lightPoolTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255, 224, 176, 0.30)');
  g.addColorStop(0.35, 'rgba(255, 206, 140, 0.14)');
  g.addColorStop(0.7, 'rgba(120, 150, 220, 0.04)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
