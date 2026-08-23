import * as THREE from 'three';
import {
  medalRoughnessMap,
  medalFaceMap,
  medalBumpMap,
  medalEdgeMap,
  medalEdgeBumpMap,
} from './medalTexture';

/**
 * Materials for one medal, in CylinderGeometry group order: [side, top, bottom].
 *
 * The edge gets its own material rather than sharing the face's. A cylinder side
 * band stretched with a face texture is exactly the smooth, featureless rim that
 * makes a 3D coin look cheap; giving it milled flutes of its own is the single
 * cheapest thing that makes one read as struck metal.
 */
export interface MedalMaterials {
  standard: THREE.MeshPhysicalMaterial[];
  jackpot: THREE.MeshPhysicalMaterial[];
}

/**
 * Silver PBR medal. The jackpot variant is emissive so it drives bloom during the
 * mass-payout rain — it is the same coin catching a light the others do not.
 */
export function createMedalMaterials(): MedalMaterials {
  const rough = medalRoughnessMap();
  const face = medalFaceMap();
  const bump = medalBumpMap();
  const edge = medalEdgeMap();
  const edgeBump = medalEdgeBumpMap();

  // WHITE, with the nickel tint carried by the maps instead.
  //
  // `color` multiplies `map`, and at metalness 1 the product is the specular
  // colour — so tinting here as well as in the texture squares the darkening and
  // sinks the whole coin toward black. The maps are already the colour the metal
  // should be; this must not darken them again.
  const SILVER = 0xffffff;

  const faceMat = new THREE.MeshPhysicalMaterial({
    color: SILVER,
    map: face,
    bumpMap: bump,
    bumpScale: 0.9,
    roughnessMap: rough,
    metalness: 1.0,
    roughness: 0.3,
    clearcoat: 0.25,
    clearcoatRoughness: 0.4,
    envMapIntensity: 1.5,
  });

  const edgeMat = new THREE.MeshPhysicalMaterial({
    color: SILVER,
    map: edge,
    bumpMap: edgeBump,
    bumpScale: 1.4,
    metalness: 1.0,
    // rougher than the face: the milled edge is the part that never gets polished
    roughness: 0.42,
    envMapIntensity: 1.45,
  });

  const gold = (m: THREE.MeshPhysicalMaterial): THREE.MeshPhysicalMaterial => {
    const j = m.clone();
    j.color = new THREE.Color(0xfff2c8);
    j.emissive = new THREE.Color(0xffb040);
    j.emissiveIntensity = 1.5;
    j.roughness = Math.max(0.16, m.roughness - 0.1);
    j.envMapIntensity = 1.7;
    return j;
  };

  return {
    standard: [edgeMat, faceMat, faceMat],
    jackpot: [gold(edgeMat), gold(faceMat), gold(faceMat)],
  };
}
