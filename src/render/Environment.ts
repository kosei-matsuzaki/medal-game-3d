import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

/**
 * Builds the PBR environment (IBL). Uses an HDRI if present in
 * public/assets/hdri/studio.hdr, otherwise falls back to the procedural
 * RoomEnvironment so reflections work from day one.
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
      useRoomEnvironment(pmrem, scene);
    }
  } else {
    // Procedural fallback — no external file required.
    useRoomEnvironment(pmrem, scene);
  }
  pmrem.dispose();

  // Dark, slightly bluish backdrop with a subtle vertical gradient.
  scene.background = makeGradientBackground();
}

function useRoomEnvironment(pmrem: THREE.PMREMGenerator, scene: THREE.Scene): void {
  const roomEnv = new RoomEnvironment();
  scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
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
