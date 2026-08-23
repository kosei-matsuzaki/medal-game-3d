import * as THREE from 'three';
import { create2D as canvas } from '../canvasText';

/**
 * MEDAL SURFACE MAPS
 *
 * A pusher medal is a struck metal token, and what makes one read as real rather
 * than as a coloured disc is entirely surface: a raised rim, a milled edge, a
 * struck relief, and brushed tooling marks catching the light differently across
 * the face. Colour alone does none of that — a flat cylinder looks like a washer
 * no matter how good its metalness value is.
 *
 * So the face gets three maps that agree with each other: an albedo with the
 * relief shaded into it, a bump map carrying the SAME relief as height, and a
 * roughness map where the struck field is duller than the polished rim.
 */

/** Radial brushed tooling, drawn into whatever context is passed. */
function brush(
  ctx: CanvasRenderingContext2D,
  size: number,
  alpha: number,
  lo: number,
  hi: number
): void {
  const cx = size / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 900; i++) {
    const a = (i / 900) * Math.PI * 2 + Math.random() * 0.01;
    const shade = lo + Math.floor(Math.random() * (hi - lo));
    ctx.strokeStyle = 'rgb(' + shade + ',' + shade + ',' + shade + ')';
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * cx * 0.08, cx + Math.sin(a) * cx * 0.08);
    ctx.lineTo(cx + Math.cos(a) * cx, cx + Math.sin(a) * cx);
    ctx.stroke();
  }
  ctx.restore();
}

/** Star polygon path, used by both the albedo and the height map. */
function starPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  r1: number,
  r2: number,
  off: number
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? r1 : r2;
    const px = cx + off + Math.cos(a) * r;
    const py = cx + off + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Roughness for the medal FACE: polished rim, duller struck field. */
export function medalRoughnessMap(size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  const cx = size / 2;
  ctx.fillStyle = '#5c5c5c';
  ctx.fillRect(0, 0, size, size);
  brush(ctx, size, 0.45, 70, 130);
  // The raised rim is the highest-wear part of a real token, so the most polished.
  ctx.strokeStyle = '#2e2e2e';
  ctx.lineWidth = size * 0.055;
  ctx.beginPath();
  ctx.arc(cx, cx, cx * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  // and the struck field inside it reads matte against that
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#909090';
  ctx.beginPath();
  ctx.arc(cx, cx, cx * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

/**
 * The struck face: raised rim, beaded inner ring, star emblem and lettering.
 *
 * Drawn as light-from-top-left relief — every raised element gets a bright edge
 * on its upper-left and a dark one on its lower-right. That baked shading is what
 * carries the relief at the size these are actually seen: a medal is a few dozen
 * pixels across on screen, and a bump map alone has nothing to work with there.
 */
export function medalFaceMap(size = 512): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  const cx = size / 2;

  // base metal, darkening toward the edge so the disc reads as curved
  const bg = ctx.createRadialGradient(cx * 0.75, cx * 0.72, size * 0.05, cx, cx, cx);
  bg.addColorStop(0, '#f4f7fb');
  bg.addColorStop(0.62, '#ced5df');
  bg.addColorStop(1, '#b9c1cd');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cx, cx, 0, Math.PI * 2);
  ctx.fill();
  brush(ctx, size, 0.1, 190, 245);

  // raised rim — bright top-left arc, dark bottom-right arc
  const rimR = cx * 0.9;
  ctx.lineWidth = size * 0.05;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cx, rimR, Math.PI * 0.62, Math.PI * 1.72);
  ctx.stroke();
  ctx.strokeStyle = '#6b7482';
  ctx.beginPath();
  ctx.arc(cx, cx, rimR, Math.PI * 1.72, Math.PI * 2.62);
  ctx.stroke();

  // beaded inner ring — the detail that most says "struck" rather than "printed"
  const beadR = cx * 0.72;
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    const bx = cx + Math.cos(a) * beadR;
    const by = cx + Math.sin(a) * beadR;
    const r = size * 0.012;
    const gg = ctx.createRadialGradient(bx - r * 0.4, by - r * 0.4, 0, bx, by, r);
    gg.addColorStop(0, '#ffffff');
    gg.addColorStop(1, '#8b93a1');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // struck star, offset twice for relief
  const r1 = cx * 0.4;
  const r2 = cx * 0.17;
  starPath(ctx, cx, r1, r2, size * 0.008);
  ctx.fillStyle = '#79818f';
  ctx.fill();
  starPath(ctx, cx, r1, r2, -size * 0.006);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  starPath(ctx, cx, r1, r2, 0);
  ctx.fillStyle = '#e2e8f0';
  ctx.fill();

  // lettering arced around the top of the rim
  ctx.save();
  ctx.translate(cx, cx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 ' + size * 0.082 + 'px Georgia, serif';
  const label = 'GOLD RUSH';
  const spread = Math.PI * 0.62;
  for (let i = 0; i < label.length; i++) {
    const a = -Math.PI / 2 - spread / 2 + (spread * i) / (label.length - 1);
    ctx.save();
    ctx.rotate(a + Math.PI / 2);
    ctx.translate(0, -cx * 0.55);
    ctx.fillStyle = '#7b8391';
    ctx.fillText(label[i], size * 0.006, size * 0.006);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label[i], -size * 0.004, -size * 0.004);
    ctx.restore();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Height for the same relief, so the lighting agrees with the painted shading. */
export function medalBumpMap(size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  const cx = size / 2;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#6a6a6a'; // the field
  ctx.beginPath();
  ctx.arc(cx, cx, cx * 0.995, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff'; // raised rim
  ctx.lineWidth = size * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cx, cx * 0.9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#dcdcdc'; // beads
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * cx * 0.72, cx + Math.sin(a) * cx * 0.72, size * 0.012, 0, Math.PI * 2);
    ctx.fill();
  }
  starPath(ctx, cx, cx * 0.4, cx * 0.17, 0);
  ctx.fillStyle = '#e8e8e8';
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

const FLUTES = 84;

/**
 * The MILLED (reeded) edge — vertical flutes around the rim.
 *
 * This is the strongest single "real coin" cue and it costs one tiny texture: the
 * edge of a struck token is knurled, and a smooth cylindrical band is most of
 * what makes a 3D coin look like a game asset rather than money.
 */
function fluteTexture(w: number, h: number, lo: number, span: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < w; i++) {
    // one cosine per flute: bright crest, dark valley
    const v = 0.5 + 0.5 * Math.cos((i / w) * FLUTES * Math.PI * 2);
    const shade = Math.floor(lo + v * span);
    ctx.fillStyle = 'rgb(' + shade + ',' + shade + ',' + shade + ')';
    ctx.fillRect(i, 0, 1, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Albedo for the milled edge.
 *
 * Kept BRIGHT (170-255, not 120-245). At metalness 1 the albedo is the specular
 * colour, so a mid-grey flute map is not "a shaded groove", it is dark metal —
 * the first version of this made every medal look like a black poker chip with a
 * silver face. The flutes are carried by the bump map; the albedo only has to
 * stay the colour of nickel.
 */
export function medalEdgeMap(w = 512, h = 16): THREE.CanvasTexture {
  const tex = fluteTexture(w, h, 170, 85);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Height for the milled edge — the same flutes, used as relief. */
export function medalEdgeBumpMap(w = 512, h = 16): THREE.CanvasTexture {
  return fluteTexture(w, h, 0, 255);
}
