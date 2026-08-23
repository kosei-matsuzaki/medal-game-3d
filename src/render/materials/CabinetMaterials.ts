import * as THREE from 'three';
import { fieldTexture, fieldEmissiveTexture } from './textureGen';

export interface CabinetMaterials {
  field: THREE.MeshStandardMaterial;
  frame: THREE.MeshPhysicalMaterial;
  pusher: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  neonBlue: THREE.MeshStandardMaterial;
  neonPink: THREE.MeshStandardMaterial;
}

export function createCabinetMaterials(): CabinetMaterials {
  const field = new THREE.MeshStandardMaterial({
    map: fieldTexture(),
    color: 0x20263e,
    metalness: 0.5,
    roughness: 0.3,
    envMapIntensity: 1.0,
    emissive: 0x2a55cc,
    emissiveMap: fieldEmissiveTexture(),
    emissiveIntensity: 0.8,
  });

  const frame = new THREE.MeshPhysicalMaterial({
    color: 0x14161f,
    metalness: 0.9,
    roughness: 0.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
    envMapIntensity: 1.0,
  });

  const pusher = new THREE.MeshStandardMaterial({
    color: 0x3a4055,
    metalness: 0.8,
    roughness: 0.35,
    envMapIntensity: 0.9,
  });

  const accent = new THREE.MeshStandardMaterial({
    color: 0x18d8ff,
    emissive: 0x0aa6ff,
    emissiveIntensity: 2.2,
    metalness: 0.2,
    roughness: 0.4,
  });

  const neonBlue = new THREE.MeshStandardMaterial({
    color: 0x2090ff,
    emissive: 0x1466ff,
    emissiveIntensity: 2.6,
    metalness: 0.1,
    roughness: 0.35,
  });

  const neonPink = new THREE.MeshStandardMaterial({
    color: 0xff48c0,
    emissive: 0xff1aa0,
    emissiveIntensity: 2.6,
    metalness: 0.1,
    roughness: 0.35,
  });

  return { field, frame, pusher, accent, neonBlue, neonPink };
}
