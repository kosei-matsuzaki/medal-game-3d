import * as THREE from 'three';

/**
 * Shared canvas-2D / text-texture helpers. Several UI and minigame pieces draw
 * glowing text into a canvas and wrap it in a THREE texture/plane; this keeps
 * that in one place (and centralises the `getContext('2d')` null check).
 */

/** Create a 2D canvas + context. Throws if the 2D context is unavailable. */
export function create2D(
  width: number,
  height = width
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return [canvas, ctx];
}

export interface TextStyle {
  font: string;
  /** a solid colour, or [top→bottom] stops for a vertical gradient fill */
  color: string | readonly string[];
  glow?: string;
  glowBlur?: number;
}

/** Render centred text onto a transparent, sRGB CanvasTexture. */
export function textTexture(
  width: number,
  height: number,
  text: string,
  style: TextStyle
): THREE.CanvasTexture {
  const [c, g] = create2D(width, height);
  g.font = style.font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (Array.isArray(style.color)) {
    const grad = g.createLinearGradient(0, 0, 0, height);
    style.color.forEach((col, i) =>
      grad.addColorStop(i / Math.max(1, style.color.length - 1), col)
    );
    g.fillStyle = grad;
  } else {
    g.fillStyle = style.color as string;
  }
  if (style.glow) {
    g.shadowColor = style.glow;
    g.shadowBlur = style.glowBlur ?? 24;
  }
  g.fillText(text, width / 2, height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A transparent textured plane carrying centred text (a 3D label / billboard). */
export function textPlane(
  text: string,
  style: TextStyle,
  canvasW: number,
  canvasH: number,
  planeW: number,
  planeH: number
): THREE.Mesh {
  const tex = textTexture(canvasW, canvasH, text, style);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(planeW, planeH),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
}
