import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

/**
 * Builds the PBR environment (IBL). Uses an HDRI if present in
 * public/assets/hdri/studio.hdr, otherwise builds the procedural arcade
 * environment below — NOT three's RoomEnvironment.
 *
 * This matters more than any other single setting: the medals are
 * `metalness: 1.0`, so their colour is ~entirely the environment reflection.
 * A neutral grey room makes gold read as grey plastic, and it contradicts the
 * dark blue backdrop (bright white reflections on a night scene = "CG").
 */
export async function setupEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  hdriUrl = 'assets/hdri/studio.hdr'
): Promise<void> {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  if (await hdriExists(hdriUrl)) {
    try {
      const hdr = await new RGBELoader().loadAsync(hdriUrl);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = pmrem.fromEquirectangular(hdr).texture;
      hdr.dispose();
    } catch {
      useArcadeEnvironment(pmrem, scene);
    }
  } else {
    // Procedural fallback — no external file required.
    useArcadeEnvironment(pmrem, scene);
  }
  pmrem.dispose();

  // Dark, slightly bluish backdrop with a subtle vertical gradient.
  scene.background = makeGradientBackground();
}

function useArcadeEnvironment(pmrem: THREE.PMREMGenerator, scene: THREE.Scene): void {
  const env = buildArcadeEnvironment();
  scene.environment = pmrem.fromScene(env, 0.02).texture;
  disposeScene(env);
}

/**
 * A hand-built lighting box for THIS cabinet: a warm top light that puts a
 * vertical highlight down each medal face, cyan/magenta side panels matching the
 * cabinet neon so the coin edges pick up the room's colour, and a near-black
 * floor so nothing washes in from below.
 */
function buildArcadeEnvironment(): THREE.Scene {
  const env = new THREE.Scene();

  const plane = (w: number, h: number, color: number, intensity: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
    );
    m.material.color.multiplyScalar(intensity);
    return m;
  };

  // top: warm key panel — the vertical specular streak on every coin face
  const top = plane(12, 12, 0xfff0d0, 3.0);
  top.rotation.x = Math.PI / 2;
  top.position.y = 6;

  // Sides: the cabinet's own neon colours, so the coin rims pick up the room.
  // Kept well below the top panel — pushed harder these read as saturated red
  // and green specks on the coin edges rather than a tint on gold.
  const left = plane(10, 8, 0x18e0ff, 0.9);
  left.rotation.y = Math.PI / 2;
  left.position.x = -6;

  const right = plane(10, 8, 0xff48c0, 0.75);
  right.rotation.y = -Math.PI / 2;
  right.position.x = 6;

  // Front: a dim cool fill. Without it every surface angled toward the camera
  // reflects nothing at all, and metal reflecting nothing renders black — which
  // is what turned half the coin pile into dark chips.
  const front = plane(12, 8, 0x2c3654, 0.9);
  front.rotation.y = Math.PI;
  front.position.z = 6;

  // back + floor: kept dark so the gold stays saturated instead of washing out
  const back = plane(12, 8, 0x141a2e, 1.0);
  back.position.z = -6;

  const floor = plane(12, 12, 0x05070f, 1.0);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -6;

  env.add(top, left, right, front, back, floor);
  return env;
}

/** The env scene is only ever rasterised once by PMREM — free it right after. */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => mat.dispose());
  });
}

/** True only if the URL exists AND is a binary asset (not an SPA-fallback HTML). */
async function hdriExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') ?? '';
    return !type.includes('text/html');
  } catch {
    return false;
  }
}

function makeGradientBackground(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#10131f');
  g.addColorStop(0.55, '#080a12');
  g.addColorStop(1, '#03040a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
