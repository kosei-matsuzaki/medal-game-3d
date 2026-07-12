import * as THREE from 'three';
import { bus } from '../core/EventBus';
import { LAYOUT } from '../pusher/layout';
import { STOCK_MAX } from '../state/SlotStock';
import { create2D } from '../render/canvasText';
import { anchorToMonitor } from './monitorAnchor';

const MULT_COLOR = ['#2a3350', '#eaf2ff', '#36d399', '#3a9bff', '#c08bff', '#ffcf4a'];
// index 0 = empty, 1..5 = ×1..×5

function tileTexture(mult: number): THREE.CanvasTexture {
  const [c, ctx] = create2D(128);
  const col = MULT_COLOR[mult] ?? MULT_COLOR[0];
  // background
  ctx.fillStyle = mult === 0 ? '#0a0e1c' : '#05070f';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = col;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 112, 112);
  if (mult > 0) {
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = col;
    ctx.shadowBlur = 16;
    ctx.font = '900 64px "Segoe UI", sans-serif';
    ctx.fillText(`×${mult}`, 64, 70);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 10-slot slot-stock gauge shown on the back-top monitor. Each tile shows that
 * stocked spin's multiplier (×1..×5) or empty. Front (next to play) is on the left.
 */
export class StockDisplay {
  private group = new THREE.Group();
  private tiles: THREE.Mesh[] = [];
  private textures: THREE.CanvasTexture[] = [];
  private current = new Array(STOCK_MAX).fill(-1);

  constructor(scene: THREE.Scene) {
    const m = LAYOUT.monitor;
    anchorToMonitor(this.group, 0.002);

    // precompute textures for empty + ×1..×5
    for (let k = 0; k <= 5; k++) this.textures.push(tileTexture(k));

    const tileW = 0.4;
    const gap = 0.04;
    const span = STOCK_MAX * (tileW + gap) - gap;
    const y = -m.height / 2 + 0.42; // bottom row of the monitor
    for (let i = 0; i < STOCK_MAX; i++) {
      const tile = new THREE.Mesh(
        new THREE.PlaneGeometry(tileW, tileW),
        new THREE.MeshBasicMaterial({ map: this.textures[0], transparent: true })
      );
      tile.position.set(-span / 2 + tileW / 2 + i * (tileW + gap), y, 0);
      this.group.add(tile);
      this.tiles.push(tile);
    }

    scene.add(this.group);

    bus.on('stock:changed', ({ slots }) => this.update(slots));
  }

  private update(slots: number[]): void {
    for (let i = 0; i < STOCK_MAX; i++) {
      const mult = i < slots.length ? slots[i] : 0;
      if (this.current[i] === mult) continue;
      this.current[i] = mult;
      (this.tiles[i].material as THREE.MeshBasicMaterial).map = this.textures[mult];
      (this.tiles[i].material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
  }
}
