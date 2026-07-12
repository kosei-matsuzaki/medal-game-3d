import * as THREE from 'three';
import { SLOT_SYMBOLS, SlotSymbol } from '../state/Economy';

// Symbol colours: odd numbers RED, even numbers BLUE, 7 is RAINBOW, BALL orange.
const RED = '#ff4d4d';
const BLUE = '#3aa0ff';
const RAINBOW_STOPS = ['#ff3b3b', '#ff9d3c', '#ffe24a', '#46e06a', '#36b9ff', '#9b7bff', '#ff5ad0'];

const CELL = 256;

/** Draw one symbol cell into ctx at (x,y) with side `size`. */
function drawSymbol(ctx: CanvasRenderingContext2D, sym: SlotSymbol, x: number, y: number, size: number): void {
  const isBall = sym === 'BALL';
  const isSeven = sym === '7';
  const num = isBall ? 0 : Number(sym);
  // glow / accent colour (gradient handles the 7 fill separately)
  const fg = isBall ? '#ff8a2c' : isSeven ? '#ffe24a' : num % 2 === 1 ? RED : BLUE;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const g = ctx.createLinearGradient(0, y, 0, y + size);
  g.addColorStop(0, '#141826');
  g.addColorStop(1, '#0a0e1c');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, size, size);
  // separator line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + size);
  ctx.lineTo(x + size, y + size);
  ctx.stroke();

  if (isBall) {
    const grad = ctx.createRadialGradient(cx - 18, cy - 22, 8, cx, cy, size * 0.36);
    grad.addColorStop(0, '#ffe6c0');
    grad.addColorStop(0.4, '#ff9d3c');
    grad.addColorStop(1, '#c8531a');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.shadowColor = fg;
    ctx.shadowBlur = 26;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${size * 0.62}px 'Segoe UI', sans-serif`;
    if (isSeven) {
      // rainbow gradient across the glyph
      const rg = ctx.createLinearGradient(x + size * 0.2, y, x + size * 0.8, y + size);
      RAINBOW_STOPS.forEach((c, i) => rg.addColorStop(i / (RAINBOW_STOPS.length - 1), c));
      ctx.fillStyle = rg;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 28;
    } else {
      ctx.fillStyle = fg;
      ctx.shadowColor = fg;
      ctx.shadowBlur = 22;
    }
    ctx.fillText(sym, cx, cy + size * 0.04);
    ctx.restore();
  }
}

/**
 * Vertical strip texture of all reel symbols, for a scrolling slot reel.
 * Symbol i is drawn so that `offset.y = i / N` (with repeat.y = 1/N) centres it
 * in the reel window. wrapT = RepeatWrapping for seamless scrolling.
 */
export function symbolStripTexture(): THREE.CanvasTexture {
  const N = SLOT_SYMBOLS.length;
  const c = document.createElement('canvas');
  c.width = CELL;
  c.height = CELL * N;
  const ctx = c.getContext('2d')!;
  // symbol i at row (N-1-i) from the top so texture-v [i/N,(i+1)/N] holds symbol i
  for (let i = 0; i < N; i++) {
    drawSymbol(ctx, SLOT_SYMBOLS[i], 0, (N - 1 - i) * CELL, CELL);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1 / N);
  tex.anisotropy = 4;
  return tex;
}
