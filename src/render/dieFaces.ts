import * as THREE from 'three';

/** Pip layouts per face, in a -1..1 unit square. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-0.45, -0.45], [0.45, 0.45]],
  3: [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
  4: [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]],
  5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
  6: [[-0.45, -0.55], [0.45, -0.55], [-0.45, 0], [0.45, 0], [-0.45, 0.55], [0.45, 0.55]],
};

/**
 * BoxGeometry material order is +X, -X, +Y, -Y, +Z, -Z. Laid out so opposite
 * faces sum to seven, which is what makes an object read as a real die rather
 * than a numbered box.
 */
export const BOX_FACE_ORDER = [3, 4, 1, 6, 2, 5] as const;

/** Local-space outward normals, indexed by the number printed on that face. */
export const FACE_NORMALS: { value: number; n: THREE.Vector3 }[] = [
  { value: 1, n: new THREE.Vector3(0, 1, 0) },
  { value: 6, n: new THREE.Vector3(0, -1, 0) },
  { value: 2, n: new THREE.Vector3(0, 0, 1) },
  { value: 5, n: new THREE.Vector3(0, 0, -1) },
  { value: 3, n: new THREE.Vector3(1, 0, 0) },
  { value: 4, n: new THREE.Vector3(-1, 0, 0) },
];

/** Ivory face with pips, as an sRGB canvas texture. */
export function dieFaceTexture(value: number, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  // slight vertical shade so the die does not read as flat white card
  const bg = g.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, '#fdfaf0');
  bg.addColorStop(1, '#e6dfcb');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  g.fillStyle = value === 1 ? '#e0342f' : '#1a1c26';
  for (const [px, py] of PIPS[value]) {
    g.beginPath();
    g.arc(size / 2 + px * size * 0.33, size / 2 + py * size * 0.33, size * 0.088, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Six materials for a die, in BoxGeometry face order.
 * `emissive` lifts the faces a little for objects that live outside the main
 * lighting (the tray sits well clear of the marquee spot).
 */
export function dieMaterials(emissive = 0): THREE.MeshStandardMaterial[] {
  return BOX_FACE_ORDER.map((v) => {
    const map = dieFaceTexture(v);
    return new THREE.MeshStandardMaterial({
      map,
      roughness: 0.42,
      metalness: 0.0,
      ...(emissive > 0
        ? { emissive: new THREE.Color(0xffffff), emissiveMap: map, emissiveIntensity: emissive }
        : {}),
    });
  });
}

/** The face pointing most nearly straight up for a given world rotation. */
export function faceUp(q: THREE.Quaternion, tmp = new THREE.Vector3()): number {
  let best = 1;
  let bestY = -Infinity;
  for (const f of FACE_NORMALS) {
    tmp.copy(f.n).applyQuaternion(q);
    if (tmp.y > bestY) {
      bestY = tmp.y;
      best = f.value;
    }
  }
  return best;
}
