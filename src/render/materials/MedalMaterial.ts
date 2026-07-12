import * as THREE from 'three';
import { medalRoughnessMap, medalEmblemMap } from './textureGen';

export interface MedalMaterials {
  standard: THREE.MeshPhysicalMaterial;
  jackpot: THREE.MeshPhysicalMaterial;
}

/**
 * Gold PBR medal material. The jackpot variant is emissive so it drives bloom
 * during the mass-payout rain.
 */
export function createMedalMaterials(): MedalMaterials {
  const rough = medalRoughnessMap();
  const emblem = medalEmblemMap();

  const standard = new THREE.MeshPhysicalMaterial({
    color: 0xffc64a,
    metalness: 1.0,
    roughness: 0.32,
    roughnessMap: rough,
    map: emblem,
    clearcoat: 0.4,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.35,
  });
  // tint the emblem map toward gold so the $ reads as engraved gold, not gray
  standard.map!.colorSpace = THREE.SRGBColorSpace;

  const jackpot = new THREE.MeshPhysicalMaterial({
    color: 0xfff0b0,
    metalness: 1.0,
    roughness: 0.22,
    roughnessMap: rough,
    map: emblem,
    emissive: 0xffaa22,
    emissiveIntensity: 1.6,
    clearcoat: 0.6,
    envMapIntensity: 1.6,
  });

  return { standard, jackpot };
}
