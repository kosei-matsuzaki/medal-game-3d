import * as THREE from 'three';
import { LAYOUT } from '../pusher/layout';

/**
 * Position & tilt an object so it lies FLAT on the back-top monitor screen,
 * hugging the glass. The offset is applied along the screen NORMAL (after the
 * tilt) so content stays a constant hair above the display surface. `zBias`
 * nudges it along that normal for layering; `scale` uniformly scales the
 * content. Shared by the monitor chrome, the stock gauge and the slot display
 * so they all anchor identically.
 */
export function anchorToMonitor(obj: THREE.Object3D, zBias = 0, scale = 1): void {
  const m = LAYOUT.monitor;
  obj.position.set(m.x, m.y, m.z);
  obj.rotation.x = m.rotX;
  obj.translateZ(m.contentOffset + zBias);
  if (scale !== 1) obj.scale.setScalar(scale);
}
