import { Square, SquareKind } from '../state/Board';

/**
 * Visual language for the すごろく monitor.
 *
 * Kept out of the minigame so the palette, the board geometry and the tile
 * drawing are one thing you can look at and judge, rather than colour literals
 * scattered through a render method. Every square kind gets a hue and an icon —
 * the icon is what makes a tile readable on a screen the player is looking at
 * from across the room, where the text never will be.
 */
export const KIND_STYLE: Record<SquareKind, { color: string; dim: string; icon: string }> = {
  empty: { color: '#54688f', dim: '#141c2e', icon: '' },
  medal: { color: '#ffcf4a', dim: '#4a3c14', icon: 'coin' },
  jpup: { color: '#ff48c0', dim: '#4a123a', icon: 'jp' },
  dice: { color: '#5ce1ff', dim: '#10384a', icon: 'dice' },
  twice: { color: '#4ade9b', dim: '#12402c', icon: 'dice2' },
  pick: { color: '#ffe24a', dim: '#4a4210', icon: 'hand' },
  boost: { color: '#ff9a3c', dim: '#4a2c10', icon: 'x2' },
  warp: { color: '#8fd0ff', dim: '#123048', icon: 'warp' },
  back: { color: '#ff5a6e', dim: '#4a1a20', icon: 'back' },
  goal: { color: '#ffd24a', dim: '#4a3a10', icon: 'goal' },
};


export const INK = {
  bg: '#05070f',
  panel: '#0b1122',
  track: '#1b2846',
  line: 'rgba(120, 180, 255, 0.30)',
  text: '#eaf2ff',
  sub: '#7f9ac4',
  gold: '#ffcf4a',
  magenta: '#ff48c0',
  cyan: '#18e0ff',
};

export const FONT_DISPLAY = '"Chakra Petch", "Noto Sans JP", sans-serif';
export const FONT_UI = '"Noto Sans JP", sans-serif';

export interface Pt {
  x: number;
  y: number;
}

export function roundRect(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// --- the course window ------------------------------------------------------
// Only a WINDOW of the run is on screen: about a dozen squares around the token,
// laid out in rows. Printing all fifty at once made every tile too small to read
// the thing that matters most — what is coming up next. The window is recomputed
// between turns, never mid-walk, so the token is always seen to travel across the
// board rather than the board sliding under it.
//
// The rows are NOT serpentine. A true boustrophedon reverses every other row, so
// half the board is read right-to-left and the player has to work out which way
// "forward" is on the row they happen to be on. Instead every row runs LEFT TO
// RIGHT and the wrap between them is an empty S-bend with no squares on it: the
// return leg is plainly a connector rather than part of the route, and forward is
// always the same direction on screen.

export interface Course {
  x: number;
  y: number;
  cols: number;
  pitchX: number;
  pitchY: number;
}

/** How many squares the window shows. */
export const WINDOW = 12;

/** How far outside the row the S-bend swings, as a fraction of the column pitch. */
const BEND = 0.62;

/** Centre of window slot `n` — always left to right, row by row. */
function tileAt(c: Course, n: number): Pt {
  const row = Math.floor(n / c.cols);
  const col = n % c.cols;
  return { x: c.x + col * c.pitchX, y: c.y + row * c.pitchY };
}

/**
 * The empty return leg from the end of row `row` to the start of row `row+1`,
 * as a polyline: out to the right, down the outside, back across, and in.
 */
function bendPath(c: Course, row: number): Pt[] {
  const y0 = c.y + row * c.pitchY;
  const y1 = y0 + c.pitchY;
  const right = c.x + (c.cols - 1) * c.pitchX;
  const outR = right + c.pitchX * BEND;
  const outL = c.x - c.pitchX * BEND;
  const mid = (y0 + y1) / 2;
  return [
    { x: right, y: y0 },
    { x: outR, y: y0 },
    { x: outR, y: mid },
    { x: outL, y: mid },
    { x: outL, y: y1 },
    { x: c.x, y: y1 },
  ];
}

/** Length of a polyline, and the point a fraction `f` along it. */
function alongPath(pts: Pt[], f: number): Pt {
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d);
    total += d;
  }
  let want = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const t = seg[i] > 0 ? want / seg[i] : 0;
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    want -= seg[i];
  }
  return pts[pts.length - 1];
}

/**
 * Centre of window slot `k` (fractional allowed).
 *
 * A fractional k that straddles a row boundary walks the S-bend rather than
 * cutting the diagonal — the piece has to be SEEN to take the return leg, or the
 * bend is just decoration the token ignores.
 */
export function windowPoint(c: Course, k: number): Pt {
  const i0 = Math.floor(k);
  const f = k - i0;
  if (f < 0.001) return tileAt(c, i0);
  const row = Math.floor(i0 / c.cols);
  const wraps = Math.floor((i0 + 1) / c.cols) > row;
  if (wraps) return alongPath(bendPath(c, row), f);
  const p = tileAt(c, i0);
  const q = tileAt(c, i0 + 1);
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
}

/** The ribbon the visible squares sit on, plus the empty S-bends between rows. */
export function drawCourse(g: CanvasRenderingContext2D, c: Course, count: number): void {
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';

  const rows = Math.ceil(count / c.cols);
  const rowRun = (row: number): [Pt, Pt] => {
    const first = row * c.cols;
    const last = Math.min(count - 1, first + c.cols - 1);
    return [tileAt(c, first), tileAt(c, last)];
  };

  // 1. the rows themselves — wide, solid, and the part with squares on it
  g.beginPath();
  for (let row = 0; row < rows; row++) {
    const [a, b] = rowRun(row);
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
  }
  g.strokeStyle = INK.track;
  g.lineWidth = 96;
  g.stroke();
  g.strokeStyle = 'rgba(120, 180, 255, 0.10)';
  g.lineWidth = 88;
  g.stroke();

  // 2. the return legs — deliberately NARROWER and dashed. They carry no squares,
  //    and a connector drawn as wide as the rows would read as more board.
  g.beginPath();
  for (let row = 0; row < rows - 1; row++) {
    const pts = bendPath(c, row);
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  }
  g.strokeStyle = 'rgba(120, 180, 255, 0.14)';
  g.lineWidth = 34;
  g.stroke();
  g.setLineDash([14, 14]);
  g.strokeStyle = 'rgba(140, 200, 255, 0.42)';
  g.lineWidth = 3;
  g.stroke();
  g.setLineDash([]);

  // 3. chevrons down each row, so "forward" is stated rather than inferred
  g.fillStyle = 'rgba(150, 205, 255, 0.30)';
  for (let row = 0; row < rows; row++) {
    const [a, b] = rowRun(row);
    for (let x = a.x + c.pitchX * 0.5; x < b.x; x += c.pitchX) {
      g.beginPath();
      g.moveTo(x - 9, a.y - 13);
      g.lineTo(x + 9, a.y);
      g.lineTo(x - 9, a.y + 13);
      g.closePath();
      g.fill();
    }
  }
  g.restore();
}

/** Overall progress along the whole run, for the bit the window cannot show. */
export function drawProgress(
  g: CanvasRenderingContext2D,
  x: number, y: number, w: number,
  pos: number, goal: number
): void {
  const h = 10;
  g.save();
  roundRect(g, x, y, w, h, h / 2);
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.fill();
  const t = Math.max(0, Math.min(1, pos / goal));
  if (t > 0) {
    roundRect(g, x, y, Math.max(h, w * t), h, h / 2);
    g.fillStyle = INK.gold;
    g.fill();
  }
  // goal flag at the far end
  g.fillStyle = KIND_STYLE.goal.color;
  g.beginPath();
  g.arc(x + w, y + h / 2, 7, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** The queue of turns already paid for but not yet played. */
export function drawStock(
  g: CanvasRenderingContext2D,
  x: number, y: number, pending: number
): void {
  g.save();
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `600 19px ${FONT_UI}`;
  g.fillStyle = INK.sub;
  g.fillText('ストック', x, y);

  const shown = Math.min(pending, 5);
  for (let i = 0; i < shown; i++) {
    const dx = x + 84 + i * 34;
    roundRect(g, dx, y - 14, 28, 28, 7);
    g.fillStyle = '#f2ecdb';
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = '#1a1c26';
    for (const [px, py] of [[-0.42, -0.42], [0.42, 0.42], [0, 0]] as [number, number][]) {
      g.beginPath();
      g.arc(dx + 14 + px * 11, y + py * 11, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (pending > shown) {
    g.fillStyle = INK.gold;
    g.font = `700 21px ${FONT_DISPLAY}`;
    g.fillText('+' + (pending - shown), x + 84 + shown * 34 + 6, y);
  }
  if (pending === 0) {
    g.fillStyle = 'rgba(127,154,196,0.5)';
    g.font = `600 18px ${FONT_UI}`;
    g.fillText('なし', x + 84, y);
  }
  g.restore();
}

/** Small pictogram centred on (cx, cy), drawn in `color` at roughly `s` pixels. */
export function drawIcon(
  g: CanvasRenderingContext2D,
  icon: string,
  cx: number,
  cy: number,
  s: number,
  color: string
): void {
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = Math.max(1.8, s * 0.12);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const u = s / 2;

  switch (icon) {
    case 'coin':
      g.beginPath();
      g.arc(0, 0, u * 0.8, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(0, -u * 0.42);
      g.lineTo(0, u * 0.42);
      g.stroke();
      break;
    case 'down':
      g.beginPath();
      g.moveTo(0, -u * 0.8);
      g.lineTo(0, u * 0.45);
      g.stroke();
      g.beginPath();
      g.moveTo(-u * 0.5, u * 0.02);
      g.lineTo(0, u * 0.72);
      g.lineTo(u * 0.5, u * 0.02);
      g.stroke();
      break;
    case 'dice':
      roundRect(g, -u * 0.68, -u * 0.68, u * 1.36, u * 1.36, u * 0.26);
      g.stroke();
      g.beginPath();
      g.arc(-u * 0.26, -u * 0.26, u * 0.13, 0, Math.PI * 2);
      g.arc(u * 0.26, u * 0.26, u * 0.13, 0, Math.PI * 2);
      g.arc(0, 0, u * 0.13, 0, Math.PI * 2);
      g.fill();
      break;
    case 'dice2':
      roundRect(g, -u * 0.9, -u * 0.5, u * 0.86, u * 0.86, u * 0.18);
      g.stroke();
      roundRect(g, u * 0.06, -u * 0.24, u * 0.86, u * 0.86, u * 0.18);
      g.stroke();
      g.beginPath();
      g.arc(-u * 0.47, -u * 0.07, u * 0.1, 0, Math.PI * 2);
      g.arc(u * 0.49, u * 0.19, u * 0.1, 0, Math.PI * 2);
      g.fill();
      break;
    case 'hand':
      g.beginPath();
      g.moveTo(-u * 0.42, u * 0.72);
      g.lineTo(-u * 0.42, -u * 0.2);
      g.moveTo(-u * 0.12, u * 0.4);
      g.lineTo(-u * 0.12, -u * 0.66);
      g.moveTo(u * 0.18, u * 0.4);
      g.lineTo(u * 0.18, -u * 0.5);
      g.moveTo(u * 0.48, u * 0.5);
      g.lineTo(u * 0.48, -u * 0.24);
      g.stroke();
      break;
    case 'x2':
      g.font = `700 ${Math.round(s * 0.72)}px "Chakra Petch", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('×2', 0, u * 0.06);
      break;
    case 'jp':
      g.beginPath();
      g.arc(0, 0, u * 0.78, 0, Math.PI * 2);
      g.stroke();
      g.font = `700 ${Math.round(s * 0.5)}px "Chakra Petch", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('JP', 0, u * 0.04);
      break;
    case 'goal':
      // chequered flag
      g.beginPath();
      g.moveTo(-u * 0.55, u * 0.85);
      g.lineTo(-u * 0.55, -u * 0.8);
      g.stroke();
      for (let r = 0; r < 3; r++) {
        for (let cc = 0; cc < 3; cc++) {
          if ((r + cc) % 2) continue;
          g.fillRect(-u * 0.44 + cc * u * 0.34, -u * 0.78 + r * u * 0.34, u * 0.34, u * 0.34);
        }
      }
      break;
    case 'warp':
      g.beginPath();
      g.moveTo(-u * 0.72, u * 0.18);
      g.lineTo(u * 0.04, u * 0.18);
      g.lineTo(-u * 0.18, u * 0.82);
      g.moveTo(-u * 0.04, -u * 0.82);
      g.lineTo(u * 0.72, -u * 0.82);
      g.lineTo(-u * 0.04, -u * 0.18);
      g.stroke();
      break;
    case 'back':
      g.beginPath();
      g.arc(0, u * 0.05, u * 0.6, Math.PI * 0.15, Math.PI * 1.5);
      g.stroke();
      g.beginPath();
      g.moveTo(-u * 0.62, -u * 0.42);
      g.lineTo(-u * 0.6, u * 0.16);
      g.lineTo(-u * 0.06, u * 0.02);
      g.stroke();
      break;
    case 'again':
      g.beginPath();
      g.arc(0, 0, u * 0.6, Math.PI * 0.85, Math.PI * 0.35);
      g.stroke();
      g.beginPath();
      g.moveTo(u * 0.6, -u * 0.5);
      g.lineTo(u * 0.62, u * 0.06);
      g.lineTo(u * 0.06, -u * 0.08);
      g.stroke();
      break;
    case 'star': {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? u * 0.82 : u * 0.34;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.stroke();
      break;
    }
    default:
      break;
  }
  g.restore();
}

/** One board square, centred on (x, y). */
export function drawTile(
  g: CanvasRenderingContext2D,
  sq: Square,
  index: number,
  x: number,
  y: number,
  size: number,
  opts: { here: boolean; passed: boolean }
): void {
  const st = KIND_STYLE[sq.kind];
  const half = size / 2;
  const goal = sq.kind === 'goal';
  g.save();

  roundRect(g, x - half, y - half, size, size, 10);
  g.fillStyle = opts.here ? st.dim : opts.passed ? '#0e1526' : INK.panel;
  g.fill();
  roundRect(g, x - half, y - half, size, size, 10);
  g.strokeStyle = st.color;
  g.lineWidth = opts.here ? 3.5 : goal ? 3 : 1.6;
  g.globalAlpha = opts.passed && !opts.here ? 0.4 : 1;
  g.stroke();

  if (opts.here || goal) {
    g.shadowColor = opts.here ? INK.gold : st.color;
    g.shadowBlur = 14;
    g.stroke();
    g.shadowBlur = 0;
  }

  // An empty square carries only its number: the run is mostly empties, and
  // giving each one an icon would bury the squares that matter in noise.
  if (sq.kind === 'empty') {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = st.color;
    g.globalAlpha = opts.passed ? 0.35 : 0.6;
    g.font = `600 ${Math.round(size * 0.3)}px ${FONT_DISPLAY}`;
    g.fillText(String(index), x, y);
    g.restore();
    return;
  }

  drawIcon(g, st.icon, x, y - size * 0.14, size * 0.44, st.color);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = st.color;
  const numeric = sq.kind === 'medal';
  g.font = `700 ${Math.round(size * (numeric ? 0.27 : 0.19))}px ${numeric ? FONT_DISPLAY : FONT_UI}`;
  g.fillText(sq.label, x, y + size * 0.33);
  g.restore();
}

/** The player's token, with a hop arc while it is moving between squares. */
export function drawPiece(g: CanvasRenderingContext2D, x: number, y: number, lift: number): void {
  g.save();
  // Shadow stays on the board while the token lifts — that separation is the
  // whole reason a hop reads as a hop rather than a slide.
  g.globalAlpha = Math.max(0.12, 0.5 - lift * 0.015);
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(x, y + 16, 15 - lift * 0.2, 5 - lift * 0.05, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;

  // Sits ABOVE the square rather than on top of its icon: a token that covers
  // the tile hides the very thing the player is trying to read.
  const py = y - lift - 14;
  g.strokeStyle = 'rgba(255, 207, 74, 0.5)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(x, py + 10);
  g.lineTo(x, y + 12);
  g.stroke();

  g.shadowColor = INK.gold;
  g.shadowBlur = 18;
  g.fillStyle = INK.gold;
  g.beginPath();
  g.arc(x, py, 13, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = '#fff6d8';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x, py, 13, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#2a1500';
  g.beginPath();
  g.arc(x, py, 5.5, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** A die face drawn flat, for the on-screen readout of a physical throw. */
export function drawDieFace(
  g: CanvasRenderingContext2D,
  x: number, y: number, size: number, value: number, color = '#f6f1e2'
): void {
  const pips: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-0.45, -0.45], [0.45, 0.45]],
    3: [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
    4: [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]],
    5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
    6: [[-0.45, -0.55], [0.45, -0.55], [-0.45, 0], [0.45, 0], [-0.45, 0.55], [0.45, 0.55]],
  };
  g.save();
  roundRect(g, x - size / 2, y - size / 2, size, size, size * 0.18);
  g.fillStyle = color;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = value === 1 ? '#e0342f' : '#1a1c26';
  for (const [px, py] of pips[Math.max(1, Math.min(6, value))] ?? [[0, 0]]) {
    g.beginPath();
    g.arc(x + px * size * 0.33, y + py * size * 0.33, size * 0.085, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
