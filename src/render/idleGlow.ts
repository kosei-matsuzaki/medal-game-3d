import * as THREE from 'three';

/** How much of its full emissive a unit keeps while it is NOT the active game. */
const IDLE_FACTOR = 0.18;

/**
 * Dims a side unit's decorative emissives while it is idle.
 *
 * The JP disc and the disc turntable are physically large and were lit at full
 * strength at all times, which made them outweigh the pusher cabinet they exist
 * to serve — the eye went to the accessory, not the main event. Gating the glow
 * on "is this unit actually playing?" leaves exactly one thing glowing at a time,
 * and makes the unit lighting up a real signal that its turn has come.
 *
 * Collects MATERIALS (not meshes), so meshes rebuilt later — e.g. the disc's
 * filled-hole markers — inherit the current state through their shared material.
 */
export class IdleGlow {
  private entries: { mat: THREE.MeshStandardMaterial; base: number }[] = [];
  private active = true;

  /** Register every emissive standard material found under `roots`. */
  constructor(roots: THREE.Object3D[], extra: THREE.MeshStandardMaterial[] = []) {
    const seen = new Set<THREE.Material>();
    const consider = (mat: THREE.Material) => {
      if (seen.has(mat)) return;
      seen.add(mat);
      const m = mat as THREE.MeshStandardMaterial;
      // skip anything that isn't actually emitting (glass, plain metal, labels)
      if (!m.emissive || m.emissive.getHex() === 0x000000) return;
      if (typeof m.emissiveIntensity !== 'number') return;
      this.entries.push({ mat: m, base: m.emissiveIntensity });
    };
    for (const root of roots) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(consider);
      });
    }
    extra.forEach(consider);
    this.setActive(false);
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    const k = on ? 1 : IDLE_FACTOR;
    for (const e of this.entries) e.mat.emissiveIntensity = e.base * k;
  }
}
