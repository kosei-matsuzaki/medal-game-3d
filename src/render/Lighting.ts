import * as THREE from 'three';

export interface Lights {
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  group: THREE.Group;
}

/**
 * Cabinet lighting: one shadow-casting key light fitted to the play area,
 * plus a colored rim and hemisphere fill for depth. IBL (environment) does
 * most of the reflective work; these add directionality and contact shadows.
 */
export function setupLighting(scene: THREE.Scene): Lights {
  const group = new THREE.Group();
  group.name = 'lighting';

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
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

  const rim = new THREE.DirectionalLight(0x4d7bff, 1.1);
  rim.position.set(-6, 4, -6);
  group.add(rim);

  const fill = new THREE.HemisphereLight(0xbfd4ff, 0x141018, 0.6);
  group.add(fill);

  const ambient = new THREE.AmbientLight(0xffffff, 0.12);
  group.add(ambient);

  scene.add(group);
  return { key, rim, fill, ambient, group };
}
