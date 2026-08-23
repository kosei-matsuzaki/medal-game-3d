import * as THREE from 'three';

export interface Lights {
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  rimWarm: THREE.DirectionalLight;
  spot: THREE.SpotLight;
  fill: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  group: THREE.Group;
}

/**
 * Cabinet lighting. Colour design: a WARM key against a BLUE rim on one side and
 * a MAGENTA rim on the other, so the picture carries the same three hues as the
 * cabinet neon (cyan / magenta / gold) instead of reading uniformly blue.
 * A spot from the marquee makes the playfield the brightest area in frame —
 * without it the key lights everything evenly and nothing claims the eye.
 * IBL (see Environment.ts) still does most of the reflective work.
 */
export function setupLighting(scene: THREE.Scene): Lights {
  const group = new THREE.Group();
  group.name = 'lighting';

  const key = new THREE.DirectionalLight(0xfff2e0, 2.0);
  key.position.set(4, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  const s = 9;
  key.shadow.camera.left = -s;
  key.shadow.camera.right = s;
  key.shadow.camera.top = s;
  key.shadow.camera.bottom = -s;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  group.add(key);
  group.add(key.target);
  key.target.position.set(0, 0, 1);

  // cool rim on the left, magenta rim on the right — opposite sides so the
  // cabinet edges separate from the background in two different colours.
  const rim = new THREE.DirectionalLight(0x4d7bff, 1.1);
  rim.position.set(-6, 4, -6);
  group.add(rim);

  const rimWarm = new THREE.DirectionalLight(0xff48c0, 0.7);
  rimWarm.position.set(6, 3, -5);
  group.add(rimWarm);

  // marquee spot aimed at the coin field — the brightest patch in the frame.
  // NOTE: three r155+ lights are physically based (intensity in candela with
  // 1/d² decay), so this needs to be ~d² larger than a directional's number:
  // at ~6.3m, 42 lands around 1.05 — enough to claim the eye without blowing
  // the pusher deck to white, which 70 did.
  const spot = new THREE.SpotLight(0xffe6bd, 46, 16, 0.56, 0.6, 2);
  spot.position.set(0, 6.6, 1.4);
  // Aimed FORWARD of the pusher deck, not at it. The decisive part of the field
  // is now the lower table between the deck and the front edge — that is where
  // the side drains are and where a medal's fate is settled. Lighting the deck
  // alone left that whole zone reading as black floor.
  spot.target.position.set(0, 0.25, 1.5);
  group.add(spot);
  group.add(spot.target);

  // both pulled down now that the environment map carries more of the exposure
  const fill = new THREE.HemisphereLight(0xbfd4ff, 0x141018, 0.4);
  group.add(fill);

  const ambient = new THREE.AmbientLight(0xffffff, 0.06);
  group.add(ambient);

  scene.add(group);
  return { key, rim, rimWarm, spot, fill, ambient, group };
}
