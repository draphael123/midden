// MIDDEN — painterly cross-section renderer.
//
// Layering:
//   1. sky + mist + rain               (dynamic, cheap)
//   2. baked earth                     (static, baked once per world)
//   3. dug layer: voids, structures    (re-baked only when the world changes)
//   4. dynamic: glow, warnings, particles, lantern, grain, vignette

import { COLS, ROWS, STRATA, BEDROCK_PALETTE, strataForRow } from './content.js';
import { cellAt, isVoid, isPassable, idx } from './world.js';
import { traceVisible } from './game.js';

export const VIEW = { W: 880, H: 648, CELL: 44, OX: 88, OY: 140 };
const { CELL, OX, OY } = VIEW;

export const options = {
  lantern: true,
  grain: true,
  shake: true,
  rain: true,
  motes: true,
  grid: false,
  reducedMotion: false,
};

// ---------------------------------------------------------------------------
// Small deterministic helpers
// ---------------------------------------------------------------------------
function rnd(seed) { const x = Math.sin(seed * 127.1) * 43758.5453; return x - Math.floor(x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = clamp(Math.round(r + amt * 255), 0, 255);
  g = clamp(Math.round(g + amt * 255), 0, 255);
  b = clamp(Math.round(b + amt * 255), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function offscreen(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

// ---------------------------------------------------------------------------
// Baked textures
// ---------------------------------------------------------------------------
let grainTile = null;
function bakeGrain() {
  if (grainTile) return grainTile;
  const S = 128;
  const cv = offscreen(S, S);
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    // high-frequency only — low-frequency noise reads as blotches when tiled
    const v = 128 + (Math.random() - 0.5) * 90;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 26;
  }
  g.putImageData(img, 0, 0);
  grainTile = cv;
  return cv;
}

// ---------------------------------------------------------------------------
// Baked earth — the undisturbed trench, painted once
// ---------------------------------------------------------------------------
export function bakeEarth(world) {
  const cv = offscreen(VIEW.W, VIEW.H);
  const g = cv.getContext('2d');

  const bandY = (row) => OY + row * CELL;
  // Smooth, not random-per-strip: independent noise at each 4px strip reads as
  // a castellated skyline along every stratum boundary.
  const wobble = (x, band) => Math.sin(x * 0.0118 + band * 2.3) * 7.5
                            + Math.sin(x * 0.0295 + band * 5.1) * 4.0
                            + Math.sin(x * 0.0067 + band * 1.1) * 5.5;

  // vertical strips give the strata an irregular, settled boundary
  const STEP = 4;
  for (let x = 0; x < VIEW.W; x += STEP) {
    for (let s = 0; s < STRATA.length; s++) {
      const st = STRATA[s];
      const top = bandY(st.rows[0]) + (s === 0 ? 0 : wobble(x, s));
      const bot = bandY(st.rows[1] + 1) + (s === STRATA.length - 1 ? 0 : wobble(x, s + 1));
      const grad = g.createLinearGradient(0, top, 0, bot);
      grad.addColorStop(0, st.palette.light);
      grad.addColorStop(0.35, st.palette.base);
      grad.addColorStop(1, st.palette.dark);
      g.fillStyle = grad;
      g.fillRect(x, top, STEP + 1, bot - top);
    }
    // bedrock
    const brTop = bandY(STRATA[STRATA.length - 1].rows[1] + 1);
    const grad = g.createLinearGradient(0, brTop, 0, VIEW.H);
    grad.addColorStop(0, BEDROCK_PALETTE.mid);
    grad.addColorStop(1, BEDROCK_PALETTE.dark);
    g.fillStyle = grad;
    g.fillRect(x, brTop, STEP + 1, VIEW.H - brTop);
  }

  // horizontal bedding lines — the thing that makes soil read as *strata*
  g.save();
  g.globalAlpha = 0.16;
  for (let i = 0; i < 130; i++) {
    const y = OY + rnd(i * 3.7) * (VIEW.H - OY);
    const st = strataForRow(Math.floor((y - OY) / CELL)) || STRATA[STRATA.length - 1];
    g.strokeStyle = rnd(i * 9.1) > 0.5 ? shade(st.palette.dark, -0.04) : st.palette.light;
    g.lineWidth = 0.6 + rnd(i * 5.5) * 1.6;
    g.beginPath();
    let x = 0;
    g.moveTo(0, y);
    while (x < VIEW.W) {
      x += 22 + rnd(i * 2.1 + x) * 40;
      g.lineTo(x, y + (rnd(i + x * 0.03) - 0.5) * 5);
    }
    g.stroke();
  }
  g.restore();

  // grit, pebbles, sherds, roots
  for (let r = 0; r < ROWS; r++) {
    for (let c = -2; c < COLS + 2; c++) {
      const px = OX + c * CELL, py = OY + r * CELL;
      const st = strataForRow(r) || STRATA[STRATA.length - 1];
      const pal = r >= ROWS - 1 ? BEDROCK_PALETTE : st.palette;
      const s0 = rnd(c * 13.3 + r * 7.7);

      // specks
      g.save();
      for (let i = 0; i < 26; i++) {
        const a = rnd(s0 * 100 + i * 3.3);
        const b = rnd(s0 * 55 + i * 9.1);
        g.fillStyle = i % 3 === 0 ? pal.speck : shade(pal.dark, -0.03);
        g.globalAlpha = 0.18 + a * 0.3;
        const sz = 0.7 + b * 1.7;
        g.fillRect(px + a * CELL, py + b * CELL, sz, sz);
      }
      g.restore();

      // pebbles
      const nPeb = Math.floor(rnd(s0 * 3 + 1.1) * 3);
      for (let i = 0; i < nPeb; i++) {
        const a = rnd(s0 * 71 + i * 17.3), b = rnd(s0 * 29 + i * 5.9);
        const rx = 2 + rnd(s0 + i) * 4, ry = rx * (0.5 + rnd(s0 * 2 + i) * 0.5);
        const x = px + a * CELL, y = py + b * CELL;
        g.save();
        g.translate(x, y); g.rotate(rnd(s0 * 6 + i) * Math.PI);
        g.fillStyle = shade(pal.dark, -0.05);
        g.beginPath(); g.ellipse(0.7, 0.9, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = pal.light;
        g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = shade(pal.light, 0.06);
        g.beginPath(); g.ellipse(-rx * 0.25, -ry * 0.3, rx * 0.5, ry * 0.45, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }

      // roots, only near the surface
      if (r <= 2 && rnd(s0 * 41) > 0.45) {
        g.save();
        g.strokeStyle = pal.root;
        g.lineWidth = 0.8 + rnd(s0 * 12) * 1.4;
        g.globalAlpha = 0.55;
        g.beginPath();
        let x = px + rnd(s0 * 8) * CELL, y = py;
        g.moveTo(x, y);
        for (let i = 0; i < 5; i++) {
          x += (rnd(s0 * 3 + i) - 0.5) * 16;
          y += 5 + rnd(s0 * 4 + i) * 9;
          g.lineTo(x, y);
        }
        g.stroke();
        g.restore();
      }
    }
  }

  // depth darkening + the Under-Builders' faint phosphorescence
  const dep = g.createLinearGradient(0, OY, 0, VIEW.H);
  dep.addColorStop(0, 'rgba(20,16,12,0)');
  dep.addColorStop(0.55, 'rgba(14,14,18,0.16)');
  dep.addColorStop(1, 'rgba(6,10,14,0.42)');
  g.fillStyle = dep;
  g.fillRect(0, OY, VIEW.W, VIEW.H - OY);

  const under = STRATA[3];
  const ph = g.createLinearGradient(0, OY + under.rows[0] * CELL, 0, OY + (under.rows[1] + 1) * CELL);
  ph.addColorStop(0, 'rgba(127,214,207,0.00)');
  ph.addColorStop(0.5, 'rgba(127,214,207,0.055)');
  ph.addColorStop(1, 'rgba(127,214,207,0.015)');
  g.fillStyle = ph;
  g.fillRect(0, OY + under.rows[0] * CELL, VIEW.W, (under.rows[1] - under.rows[0] + 1) * CELL);

  // grain
  const tile = bakeGrain();
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = g.createPattern(tile, 'repeat');
  g.fillRect(0, OY, VIEW.W, VIEW.H - OY);
  g.restore();

  // the turf lip at the top of the cut
  g.save();
  g.fillStyle = '#3f4a2c';
  g.beginPath();
  g.moveTo(0, OY);
  for (let x = 0; x <= VIEW.W; x += 6) {
    g.lineTo(x, OY - 3 - rnd(x * 0.13) * 5);
  }
  g.lineTo(VIEW.W, OY + 6); g.lineTo(0, OY + 6); g.closePath();
  g.fill();
  g.strokeStyle = '#57663a'; g.lineWidth = 1;
  for (let x = 0; x < VIEW.W; x += 3) {
    const h = 3 + rnd(x * 0.7) * 7;
    g.beginPath();
    g.moveTo(x, OY - 1);
    g.lineTo(x + (rnd(x * 1.3) - 0.5) * 4, OY - 1 - h);
    g.stroke();
  }
  g.restore();

  return cv;
}

// ---------------------------------------------------------------------------
// Structure art
// ---------------------------------------------------------------------------
const STONE = {
  near:  { wall: '#8d5f47', wall2: '#a3765a', mortar: '#c4ad92', dark: '#4d3325', roof: '#6e4436', roof2: '#88594541', wood: '#4b3524', accent: '#d9a05b' },
  reed:  { wall: '#a99a76', wall2: '#bcae8b', mortar: '#8b8163', dark: '#3c3928', roof: '#8a7746', roof2: '#a08c56', wood: '#403a29', accent: '#c8b36d' },
  under: { wall: '#a9b8b6', wall2: '#c2cfcc', mortar: '#7d908f', dark: '#33413f', roof: '#8ba39f', roof2: '#a2b8b4', wood: '#5d716e', accent: '#7fd6cf' },
};

const SHAPE = {
  cottage: 'house', bakehouse: 'house', smithy: 'house', toll: 'house',
  chapel: 'chapel', byre: 'hall', school: 'hall',
  well: 'shaft', cistern: 'tank', graverow: 'graves',
  longhouse: 'hall', bonehouse: 'hall', kiln: 'kiln', weir: 'frame', rack: 'frame',
  mootring: 'ring', sunkenhut: 'pit', springhs: 'pit', post: 'post',
  vault: 'arch', conduit: 'arch', hollowway: 'arch',
  effigy: 'pillars', pillar: 'pillars',
  coldcell: 'slab', reliquary: 'slab', sink: 'shaft',
};

function buildingRect(b) {
  return { x: OX + b.c0 * CELL, y: OY + b.r0 * CELL, w: b.w * CELL, h: b.h * CELL };
}

function wallFill(g, x, y, w, h, pal, restored, seed) {
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, restored ? pal.wall2 : shade(pal.wall, -0.09));
  grad.addColorStop(1, restored ? pal.wall : shade(pal.dark, 0.02));
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);

  // courses
  g.save();
  g.globalAlpha = restored ? 0.5 : 0.32;
  g.strokeStyle = pal.mortar;
  g.lineWidth = 1;
  const ch = 7;
  for (let yy = y + ch; yy < y + h; yy += ch) {
    g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke();
  }
  for (let yy = y; yy < y + h; yy += ch) {
    const off = ((yy - y) / ch) % 2 ? 7 : 0;
    for (let xx = x + off; xx < x + w; xx += 14) {
      g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, Math.min(yy + ch, y + h)); g.stroke();
    }
  }
  g.restore();

  if (!restored) {
    // slumped soil clinging to unrestored fabric
    g.save();
    g.globalAlpha = 0.42;
    g.fillStyle = '#3a2c1e';
    for (let i = 0; i < 9; i++) {
      const a = rnd(seed * 31 + i), c2 = rnd(seed * 17 + i * 3);
      g.beginPath();
      g.ellipse(x + a * w, y + h - c2 * h * 0.5, 5 + c2 * 12, 3 + c2 * 7, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // cracks
    g.save();
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      let cx = x + rnd(seed * 7 + i) * w, cy = y;
      g.beginPath(); g.moveTo(cx, cy);
      for (let k = 0; k < 4; k++) { cx += (rnd(seed + i * 3 + k) - 0.5) * 12; cy += h / 4; g.lineTo(cx, cy); }
      g.stroke();
    }
    g.restore();
  }
}

function litWindow(g, x, y, w, h, restored, pal) {
  if (restored) {
    g.fillStyle = '#f0c072';
    g.fillRect(x, y, w, h);
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 2.6);
    gr.addColorStop(0, 'rgba(255,190,110,0.5)');
    gr.addColorStop(1, 'rgba(255,190,110,0)');
    g.fillStyle = gr;
    g.fillRect(x - w * 2.6, y - w * 2.6, w * 5.2 + w, w * 5.2 + h);
    g.restore();
  } else {
    g.fillStyle = 'rgba(10,8,6,0.85)';
    g.fillRect(x, y, w, h);
  }
}

function drawShape(g, b, restored) {
  const { x, y, w, h } = buildingRect(b);
  const pal = STONE[b.stratumKey];
  const shape = SHAPE[b.key] || 'house';
  const seed = b.id * 3.77;
  g.save();

  switch (shape) {
    case 'house': {
      const roofH = Math.min(h * 0.42, 20);
      wallFill(g, x + 2, y + roofH, w - 4, h - roofH - 1, pal, restored, seed);
      g.fillStyle = restored ? pal.roof2 : shade(pal.roof, -0.1);
      g.beginPath();
      g.moveTo(x, y + roofH + 2);
      g.lineTo(x + w / 2, y + 2);
      g.lineTo(x + w, y + roofH + 2);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.stroke();
      const nw = Math.max(1, Math.floor(w / 22));
      for (let i = 0; i < nw; i++) {
        litWindow(g, x + 8 + i * 22, y + roofH + 9, 7, 8, restored, pal);
      }
      // chimney
      g.fillStyle = shade(pal.wall, -0.15);
      g.fillRect(x + w - 14, y + 3, 7, roofH + 2);
      break;
    }
    case 'hall': {
      const roofH = Math.min(h * 0.36, 15);
      wallFill(g, x + 2, y + roofH, w - 4, h - roofH - 1, pal, restored, seed);
      g.fillStyle = restored ? pal.roof2 : shade(pal.roof, -0.1);
      g.beginPath();
      g.moveTo(x + 1, y + roofH + 2);
      g.lineTo(x + 8, y + 3); g.lineTo(x + w - 8, y + 3);
      g.lineTo(x + w - 1, y + roofH + 2);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.stroke();
      // posts
      g.fillStyle = pal.wood;
      for (let i = 0; i < b.w * 2; i++) g.fillRect(x + 6 + i * (w / (b.w * 2)), y + roofH, 3, h - roofH - 2);
      for (let i = 0; i < b.w; i++) litWindow(g, x + 14 + i * 40, y + roofH + 10, 9, 7, restored, pal);
      break;
    }
    case 'chapel': {
      const roofH = Math.min(h * 0.3, 22);
      wallFill(g, x + 4, y + roofH, w - 8, h - roofH - 1, pal, restored, seed);
      g.fillStyle = restored ? pal.roof2 : shade(pal.roof, -0.1);
      g.beginPath();
      g.moveTo(x + 2, y + roofH + 2); g.lineTo(x + w / 2, y + 6); g.lineTo(x + w - 2, y + roofH + 2);
      g.closePath(); g.fill();
      // tower + cross
      g.fillStyle = restored ? pal.wall2 : shade(pal.wall, -0.1);
      g.fillRect(x + w / 2 - 7, y + 2, 14, roofH + 6);
      g.strokeStyle = restored ? pal.accent : shade(pal.dark, 0.12);
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(x + w / 2, y - 10); g.lineTo(x + w / 2, y + 2);
      g.moveTo(x + w / 2 - 5, y - 5); g.lineTo(x + w / 2 + 5, y - 5);
      g.stroke();
      // lancet window
      const wx = x + w / 2 - 5, wy = y + roofH + 14;
      if (restored) {
        g.fillStyle = '#f2c778';
        g.beginPath();
        g.moveTo(wx, wy + 16); g.lineTo(wx, wy + 5);
        g.quadraticCurveTo(wx + 5, wy - 5, wx + 10, wy + 5);
        g.lineTo(wx + 10, wy + 16); g.closePath(); g.fill();
        g.save(); g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(wx + 5, wy + 8, 0, wx + 5, wy + 8, 40);
        gr.addColorStop(0, 'rgba(255,200,120,0.42)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
        g.fillStyle = gr; g.fillRect(wx - 40, wy - 32, 90, 90); g.restore();
      } else {
        g.fillStyle = 'rgba(8,6,5,0.8)';
        g.fillRect(wx, wy, 10, 16);
      }
      break;
    }
    case 'shaft': {
      g.fillStyle = shade(pal.dark, -0.06);
      g.fillRect(x + w * 0.22, y + 8, w * 0.56, h - 8);
      g.fillStyle = restored ? pal.wall2 : shade(pal.wall, -0.08);
      g.fillRect(x + w * 0.16, y + 4, w * 0.68, 10);
      g.save();
      g.globalAlpha = 0.6; g.strokeStyle = pal.mortar; g.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        g.beginPath();
        g.moveTo(x + w * 0.22, y + 8 + i * ((h - 8) / 5));
        g.lineTo(x + w * 0.78, y + 8 + i * ((h - 8) / 5));
        g.stroke();
      }
      g.restore();
      // headframe
      g.strokeStyle = pal.wood; g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x + w * 0.2, y + 6); g.lineTo(x + w * 0.5, y - 8); g.lineTo(x + w * 0.8, y + 6);
      g.stroke();
      if (restored) {
        g.save(); g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(x + w / 2, y + h * 0.7, 0, x + w / 2, y + h * 0.7, w);
        gr.addColorStop(0, 'rgba(110,190,220,0.32)'); gr.addColorStop(1, 'rgba(110,190,220,0)');
        g.fillStyle = gr; g.fillRect(x - w, y - h, w * 3, h * 3); g.restore();
      }
      break;
    }
    case 'tank': {
      wallFill(g, x + 3, y + 3, w - 6, h - 6, pal, restored, seed);
      const wl = y + h * 0.42;
      g.fillStyle = restored ? 'rgba(96,166,190,0.72)' : 'rgba(50,72,72,0.55)';
      g.fillRect(x + 6, wl, w - 12, y + h - 6 - wl);
      if (restored) {
        g.strokeStyle = 'rgba(190,235,245,0.5)'; g.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          g.beginPath(); g.moveTo(x + 8, wl + 4 + i * 6); g.lineTo(x + w - 8, wl + 5 + i * 6); g.stroke();
        }
      }
      break;
    }
    case 'graves': {
      g.fillStyle = shade(pal.dark, 0.04);
      g.fillRect(x + 2, y + h - 8, w - 4, 7);
      const n = Math.max(3, Math.floor(w / 14));
      for (let i = 0; i < n; i++) {
        const gx = x + 8 + i * ((w - 16) / (n - 1 || 1));
        const gh = 12 + rnd(seed + i) * 9;
        const tilt = (rnd(seed * 2 + i) - 0.5) * 0.3;
        g.save();
        g.translate(gx, y + h - 8); g.rotate(tilt);
        g.fillStyle = restored ? pal.wall2 : shade(pal.wall, -0.14);
        g.beginPath();
        g.moveTo(-4, 0); g.lineTo(-4, -gh + 4);
        g.quadraticCurveTo(0, -gh - 3, 4, -gh + 4);
        g.lineTo(4, 0); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.8; g.stroke();
        g.restore();
      }
      break;
    }
    case 'kiln': {
      g.fillStyle = restored ? pal.wall2 : shade(pal.wall, -0.1);
      g.beginPath();
      g.moveTo(x + 5, y + h - 2);
      g.lineTo(x + 9, y + 8);
      g.quadraticCurveTo(x + w / 2, y - 1, x + w - 9, y + 8);
      g.lineTo(x + w - 5, y + h - 2);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.stroke();
      // stoke hole
      const fx = x + w / 2, fy = y + h - 12;
      g.fillStyle = restored ? '#ff9a3c' : 'rgba(8,6,5,0.85)';
      g.beginPath(); g.arc(fx, fy, 6, 0, Math.PI * 2); g.fill();
      if (restored) {
        g.save(); g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(fx, fy, 0, fx, fy, 42);
        gr.addColorStop(0, 'rgba(255,140,50,0.5)'); gr.addColorStop(1, 'rgba(255,140,50,0)');
        g.fillStyle = gr; g.fillRect(fx - 42, fy - 42, 84, 84); g.restore();
      }
      break;
    }
    case 'frame': {
      g.strokeStyle = restored ? pal.wood : shade(pal.wood, -0.06);
      g.lineWidth = 4;
      const n = Math.max(2, b.w + 1);
      for (let i = 0; i < n; i++) {
        const px = x + 8 + i * ((w - 16) / (n - 1));
        g.beginPath(); g.moveTo(px, y + h - 2); g.lineTo(px + (rnd(seed + i) - 0.5) * 5, y + 6); g.stroke();
      }
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + 4, y + 10); g.lineTo(x + w - 4, y + 12); g.stroke();
      g.beginPath(); g.moveTo(x + 4, y + h * 0.55); g.lineTo(x + w - 4, y + h * 0.55 + 2); g.stroke();
      if (restored) {
        g.strokeStyle = 'rgba(200,180,120,0.75)'; g.lineWidth = 1.4;
        for (let i = 0; i < 6; i++) {
          const hx = x + 10 + rnd(seed * 4 + i) * (w - 20);
          g.beginPath(); g.moveTo(hx, y + 12); g.lineTo(hx, y + 12 + 8 + rnd(seed + i) * 9); g.stroke();
        }
      }
      break;
    }
    case 'ring': {
      const cx = x + w / 2, cy = y + h / 2, rx = w * 0.42, ry = h * 0.3;
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(cx, cy + 6, rx, ry, 0, 0, Math.PI * 2); g.stroke();
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const sx = cx + Math.cos(a) * rx, sy = cy + 6 + Math.sin(a) * ry;
        const sh = 9 + rnd(seed + i) * 7;
        g.save();
        g.translate(sx, sy); g.rotate((rnd(seed * 3 + i) - 0.5) * 0.35);
        g.fillStyle = restored ? pal.wall2 : shade(pal.wall, -0.13);
        g.fillRect(-4, -sh, 8, sh);
        g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.8; g.strokeRect(-4, -sh, 8, sh);
        g.restore();
      }
      if (restored) {
        g.save(); g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(cx, cy + 4, 0, cx, cy + 4, w * 0.5);
        gr.addColorStop(0, 'rgba(240,190,110,0.28)'); gr.addColorStop(1, 'rgba(240,190,110,0)');
        g.fillStyle = gr; g.fillRect(x - w, y - h, w * 3, h * 3); g.restore();
      }
      break;
    }
    case 'pit': {
      g.fillStyle = shade(pal.dark, -0.04);
      g.beginPath();
      g.moveTo(x + 5, y + 10); g.lineTo(x + w - 5, y + 10);
      g.lineTo(x + w - 9, y + h - 3); g.lineTo(x + 9, y + h - 3);
      g.closePath(); g.fill();
      g.strokeStyle = pal.wood; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + 4, y + 12); g.lineTo(x + w / 2, y + 1); g.lineTo(x + w - 4, y + 12); g.stroke();
      if (restored) {
        g.fillStyle = '#ff9c46';
        g.beginPath(); g.ellipse(x + w / 2, y + h - 9, 6, 3.4, 0, 0, Math.PI * 2); g.fill();
        g.save(); g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(x + w / 2, y + h - 9, 0, x + w / 2, y + h - 9, 40);
        gr.addColorStop(0, 'rgba(255,150,60,0.45)'); gr.addColorStop(1, 'rgba(255,150,60,0)');
        g.fillStyle = gr; g.fillRect(x - 40, y - 40, w + 80, h + 80); g.restore();
      }
      break;
    }
    case 'post': {
      const cx = x + w / 2;
      g.fillStyle = restored ? pal.wood : shade(pal.wood, -0.05);
      g.fillRect(cx - 5, y + 4, 10, h - 6);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.9;
      for (let i = 0; i < 3; i++) {
        const fy = y + 10 + i * ((h - 16) / 3);
        g.beginPath(); g.arc(cx, fy, 3.2, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.moveTo(cx - 3.4, fy + 1.2); g.lineTo(cx + 3.4, fy + 1.2); g.stroke();
      }
      if (restored) {
        g.save(); g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(cx, y + h / 2, 0, cx, y + h / 2, 34);
        gr.addColorStop(0, 'rgba(220,190,120,0.3)'); gr.addColorStop(1, 'rgba(220,190,120,0)');
        g.fillStyle = gr; g.fillRect(cx - 34, y + h / 2 - 34, 68, 68); g.restore();
      }
      break;
    }
    case 'arch': {
      g.fillStyle = restored ? pal.wall2 : shade(pal.wall, -0.1);
      g.fillRect(x + 2, y + 2, w - 4, h - 3);
      g.fillStyle = shade(pal.dark, -0.08);
      const n = Math.max(1, b.w);
      for (let i = 0; i < n; i++) {
        const ax = x + 6 + i * ((w - 12) / n), aw = (w - 12) / n - 5;
        g.beginPath();
        g.moveTo(ax, y + h - 4);
        g.lineTo(ax, y + h * 0.5);
        g.quadraticCurveTo(ax + aw / 2, y + 4, ax + aw, y + h * 0.5);
        g.lineTo(ax + aw, y + h - 4);
        g.closePath(); g.fill();
        g.strokeStyle = restored ? pal.mortar : 'rgba(0,0,0,0.3)';
        g.lineWidth = 1.6; g.stroke();
      }
      // dressed-joint hint
      g.save(); g.globalAlpha = 0.35; g.strokeStyle = pal.mortar; g.lineWidth = 1;
      for (let yy = y + 8; yy < y + h - 4; yy += 9) { g.beginPath(); g.moveTo(x + 2, yy); g.lineTo(x + w - 2, yy); g.stroke(); }
      g.restore();
      if (restored && b.stratumKey === 'under') {
        g.save(); g.globalCompositeOperation = 'lighter';
        const gr = g.createLinearGradient(x, y, x, y + h);
        gr.addColorStop(0, 'rgba(127,214,207,0.20)'); gr.addColorStop(1, 'rgba(127,214,207,0.02)');
        g.fillStyle = gr; g.fillRect(x, y, w, h); g.restore();
      }
      break;
    }
    case 'pillars': {
      g.fillStyle = shade(pal.dark, -0.05);
      g.fillRect(x + 2, y + 2, w - 4, h - 3);
      const n = Math.max(3, b.w * 2);
      for (let i = 0; i < n; i++) {
        const px = x + 8 + i * ((w - 16) / (n - 1));
        g.fillStyle = restored ? pal.wall2 : shade(pal.wall, -0.12);
        g.fillRect(px - 3.5, y + 8, 7, h - 16);
        g.fillRect(px - 5.5, y + 5, 11, 4);
        g.fillRect(px - 5.5, y + h - 11, 11, 4);
      }
      g.fillStyle = restored ? pal.wall : shade(pal.wall, -0.16);
      g.fillRect(x + 3, y + 2, w - 6, 5);
      g.fillRect(x + 3, y + h - 6, w - 6, 4);
      if (restored) {
        g.save(); g.globalCompositeOperation = 'lighter';
        const gr = g.createLinearGradient(x, y + h, x, y);
        gr.addColorStop(0, 'rgba(127,214,207,0.26)'); gr.addColorStop(1, 'rgba(127,214,207,0)');
        g.fillStyle = gr; g.fillRect(x, y, w, h); g.restore();
      }
      break;
    }
    case 'slab':
    default: {
      wallFill(g, x + 4, y + 5, w - 8, h - 9, pal, restored, seed);
      g.strokeStyle = restored ? pal.accent : 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.6;
      g.strokeRect(x + 8, y + 9, w - 16, h - 17);
      if (restored && b.stratumKey === 'under') {
        g.save(); g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.9);
        gr.addColorStop(0, 'rgba(127,214,207,0.3)'); gr.addColorStop(1, 'rgba(127,214,207,0)');
        g.fillStyle = gr; g.fillRect(x - w, y - h, w * 3, h * 3); g.restore();
      }
      break;
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Dug layer — voids, rubble, props, structures. Re-baked on world change.
// ---------------------------------------------------------------------------
export function bakeDug(game, earth) {
  const { world } = game;
  const cv = offscreen(VIEW.W, VIEW.H);
  const g = cv.getContext('2d');

  // 1. voids
  const voidPath = new Path2D();
  const rubblePath = new Path2D();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = world.cells[idx(c, r)];
      const x = OX + c * CELL, y = OY + r * CELL;
      if (cell.state === 'open') voidPath.rect(x, y, CELL, CELL);
      else if (cell.state === 'rubble') { voidPath.rect(x, y, CELL, CELL); rubblePath.rect(x, y, CELL, CELL); }
    }
  }
  // A cleared cell is not a hole in space — you are looking at the back wall of
  // the cut. Re-lay the baked soil inside the void and put it in shadow, so the
  // trench reads as excavated earth instead of a black mass.
  g.save();
  g.clip(voidPath);
  if (earth) g.drawImage(earth, 0, 0);
  else { g.fillStyle = '#2a221a'; g.fill(voidPath); }
  const shade1 = g.createLinearGradient(0, OY, 0, VIEW.H);
  shade1.addColorStop(0, 'rgba(13,10,7,0.72)');
  shade1.addColorStop(0.55, 'rgba(11,10,9,0.79)');
  shade1.addColorStop(1, 'rgba(7,10,13,0.85)');
  g.fillStyle = shade1;
  g.fillRect(0, OY, VIEW.W, VIEW.H - OY);
  g.restore();

  // ambient occlusion where solid meets void
  g.save();
  g.clip(voidPath);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isVoid(world, c, r)) continue;
      const x = OX + c * CELL, y = OY + r * CELL;
      const sides = [
        [!isVoid(world, c, r - 1) && r > 0, 0, 0, CELL, 1],
        [!isVoid(world, c, r + 1), 0, CELL, CELL, -1],
        [!isVoid(world, c - 1, r), 0, 0, 1, CELL],
        [!isVoid(world, c + 1, r), CELL, 0, -1, CELL],
      ];
      for (const [on, dx, dy, sx, sy] of sides) {
        if (!on) continue;
        const horiz = Math.abs(sx) === CELL;
        const depth = 14;
        const gx0 = x + dx, gy0 = y + dy;
        const grad = horiz
          ? g.createLinearGradient(gx0, gy0, gx0, gy0 + (sy > 0 ? depth : -depth))
          : g.createLinearGradient(gx0, gy0, gx0 + (sx > 0 ? depth : -depth), gy0);
        grad.addColorStop(0, 'rgba(0,0,0,0.72)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        if (horiz) g.fillRect(x, sy > 0 ? gy0 : gy0 - depth, CELL, depth);
        else g.fillRect(sx > 0 ? gx0 : gx0 - depth, y, depth, CELL);
      }
      // loose spoil resting on the floor of the cut
      if (!isVoid(world, c, r + 1)) {
        g.fillStyle = 'rgba(58,44,30,0.85)';
        g.beginPath();
        g.moveTo(x, y + CELL);
        for (let i = 0; i <= 6; i++) {
          g.lineTo(x + (i / 6) * CELL, y + CELL - 2 - rnd(c * 7 + r * 3 + i) * 5);
        }
        g.lineTo(x + CELL, y + CELL); g.closePath(); g.fill();
      }
    }
  }
  g.restore();

  // rubble heaps
  g.save();
  g.clip(rubblePath);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (world.cells[idx(c, r)].state !== 'rubble') continue;
      const x = OX + c * CELL, y = OY + r * CELL;
      for (let i = 0; i < 16; i++) {
        const a = rnd(c * 31 + r * 17 + i * 3.1), b2 = rnd(c * 11 + r * 29 + i * 7.7);
        const sz = 3 + b2 * 8;
        g.save();
        g.translate(x + a * CELL, y + CELL - 4 - b2 * CELL * 0.7);
        g.rotate((a - 0.5) * 2);
        g.fillStyle = ['#6b5b4a', '#574838', '#7d6b56', '#3f352a'][i % 4];
        g.fillRect(-sz / 2, -sz / 2, sz, sz * 0.7);
        g.restore();
      }
    }
  }
  g.restore();

  // 2. structures, clipped to the cells actually cleared
  for (const b of world.buildings) {
    if (b.state === 'salvaged' || b.state === 'collapsed') continue;
    if (b.revealedCount === 0) continue;
    const clip = new Path2D();
    let any = false;
    for (const { c, r } of b.cells) {
      const cell = cellAt(world, c, r);
      if (cell.state === 'exposed-part' || cell.state === 'restored-part') {
        clip.rect(OX + c * CELL, OY + r * CELL, CELL, CELL);
        any = true;
      }
    }
    if (!any) continue;
    g.save();
    g.clip(clip);
    drawShape(g, b, b.state === 'restored');
    g.restore();
  }

  // 3. props
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (world.cells[idx(c, r)].state !== 'prop') continue;
      const x = OX + c * CELL, y = OY + r * CELL;
      g.save();
      g.fillStyle = '#7a5c36';
      g.fillRect(x + 6, y + 3, 7, CELL - 6);
      g.fillRect(x + CELL - 13, y + 3, 7, CELL - 6);
      g.fillStyle = '#8d6b40';
      g.fillRect(x + 2, y + 1, CELL - 4, 5);
      g.fillRect(x + 2, y + CELL - 6, CELL - 4, 5);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
      g.strokeRect(x + 6, y + 3, 7, CELL - 6);
      g.strokeRect(x + CELL - 13, y + 3, 7, CELL - 6);
      // diagonal brace
      g.strokeStyle = '#6b4f2e'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(x + 9, y + CELL - 5); g.lineTo(x + CELL - 9, y + 6); g.stroke();
      g.restore();
    }
  }

  // 4. traces on the dig face + sounding ghosts
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = world.cells[idx(c, r)];
      const x = OX + c * CELL, y = OY + r * CELL;

      if (cell.sounded && (cell.state === 'earth' || cell.state === 'buried-part')) {
        g.save();
        g.globalAlpha = 0.5;
        if (cell.bId !== null) {
          const st = STRATA.find((s) => s.key === cell.stratum);
          g.strokeStyle = st && st.glow ? st.glow : '#d8c79a';
          g.setLineDash([4, 3]);
          g.lineWidth = 1.4;
          g.strokeRect(x + 5, y + 5, CELL - 10, CELL - 10);
          g.setLineDash([]);
          g.fillStyle = 'rgba(216,199,154,0.10)';
          g.fillRect(x + 5, y + 5, CELL - 10, CELL - 10);
        } else {
          g.fillStyle = 'rgba(255,255,255,0.13)';
          g.beginPath(); g.arc(x + CELL / 2, y + CELL / 2, 2, 0, Math.PI * 2); g.fill();
        }
        g.restore();
      }

      if (cell.bId !== null && traceVisible(game, c, r)) {
        const faces = [
          isPassable(world, c, r - 1) || r === 0 ? 'top' : null,
          isPassable(world, c, r + 1) ? 'bottom' : null,
          isPassable(world, c - 1, r) ? 'left' : null,
          isPassable(world, c + 1, r) ? 'right' : null,
        ].filter(Boolean);
        g.save();
        g.globalAlpha = 0.85;
        for (const f of faces) {
          const pal = STONE[cell.stratum] || STONE.near;
          g.fillStyle = pal.mortar;
          const t = 3;
          if (f === 'top') g.fillRect(x + 6, y + 1, CELL - 12, t);
          if (f === 'bottom') g.fillRect(x + 6, y + CELL - 1 - t, CELL - 12, t);
          if (f === 'left') g.fillRect(x + 1, y + 6, t, CELL - 12);
          if (f === 'right') g.fillRect(x + CELL - 1 - t, y + 6, t, CELL - 12);
        }
        // discoloured settling stain
        g.globalAlpha = 0.22;
        g.fillStyle = '#2a2018';
        g.beginPath();
        g.ellipse(x + CELL / 2, y + CELL / 2, CELL * 0.34, CELL * 0.26, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  }

  return cv;
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------
export class Particles {
  constructor() { this.list = []; }
  spawn(p) { if (this.list.length < 900) this.list.push(p); }

  burstDust(x, y, n = 14, tint = '#8a7050') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 20 + Math.random() * 90;
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20,
        life: 0, max: 0.5 + Math.random() * 0.9, size: 1 + Math.random() * 3.4,
        color: tint, grav: 40, fade: 1,
      });
    }
  }

  burstDebris(x, y, n = 18) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, s = 60 + Math.random() * 220;
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0, max: 0.9 + Math.random() * 1.1, size: 2 + Math.random() * 4,
        color: ['#6b5b4a', '#8a7a63', '#4a3f32'][i % 3], grav: 620, fade: 1, spin: true,
      });
    }
  }

  columnDust(x, y0, y1, n = 30) {
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 40,
        y: lerp(y0, y1, Math.random()),
        vx: (Math.random() - 0.5) * 40, vy: -10 - Math.random() * 40,
        life: 0, max: 1.2 + Math.random() * 1.6, size: 2 + Math.random() * 6,
        color: '#a08f74', grav: -6, fade: 1,
      });
    }
  }

  sparkle(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 10 + Math.random() * 55;
      this.spawn({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30,
        life: 0, max: 0.7 + Math.random() * 0.9, size: 1 + Math.random() * 2.2,
        color, grav: -12, fade: 1, glow: true,
      });
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life += dt;
      if (p.life >= p.max) { this.list.splice(i, 1); continue; }
      p.vy += (p.grav || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt;
    }
  }

  draw(g) {
    for (const p of this.list) {
      const t = 1 - p.life / p.max;
      g.save();
      g.globalAlpha = clamp(t, 0, 1) * 0.9;
      if (p.glow) g.globalCompositeOperation = 'lighter';
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      g.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// Sky, weather, motes
// ---------------------------------------------------------------------------
const motes = [];
function ensureMotes() {
  if (motes.length) return;
  for (let i = 0; i < 90; i++) {
    motes.push({
      x: Math.random() * VIEW.W,
      y: OY + Math.random() * (VIEW.H - OY),
      vx: (Math.random() - 0.5) * 9,
      vy: -2 - Math.random() * 7,
      s: 0.6 + Math.random() * 1.8,
      ph: Math.random() * Math.PI * 2,
    });
  }
}

const rainDrops = [];
function ensureRain() {
  if (rainDrops.length) return;
  for (let i = 0; i < 110; i++) {
    rainDrops.push({ x: Math.random() * VIEW.W, y: Math.random() * OY, v: 260 + Math.random() * 300, len: 6 + Math.random() * 12 });
  }
}

function drawSky(g, t) {
  const grad = g.createLinearGradient(0, 0, 0, OY);
  grad.addColorStop(0, '#2b3440');
  grad.addColorStop(0.55, '#4a5563');
  grad.addColorStop(1, '#77786e');
  g.fillStyle = grad;
  g.fillRect(0, 0, VIEW.W, OY);

  // pale sun behind cloud
  const sx = VIEW.W * 0.74, sy = OY * 0.34;
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, 120);
  sun.addColorStop(0, 'rgba(255,238,205,0.30)');
  sun.addColorStop(1, 'rgba(255,238,205,0)');
  g.fillStyle = sun;
  g.fillRect(sx - 130, sy - 130, 260, 260);

  // drifting cloud bands
  g.save();
  for (let i = 0; i < 5; i++) {
    const speed = 5 + i * 3.5;
    const y = 14 + i * 22;
    const off = ((t * speed) % (VIEW.W + 400)) - 200;
    g.globalAlpha = 0.09 + i * 0.022;
    g.fillStyle = i % 2 ? '#cfd6d8' : '#9aa4a8';
    g.beginPath();
    for (let k = -1; k < 4; k++) {
      const cx = off + k * 320;
      g.ellipse(cx, y, 150 + i * 26, 12 + i * 3.4, 0, 0, Math.PI * 2);
    }
    g.fill();
  }
  g.restore();

  // far treeline / hedge along the horizon
  g.save();
  g.fillStyle = '#3a4536';
  g.beginPath();
  g.moveTo(0, OY);
  for (let x = 0; x <= VIEW.W; x += 8) {
    const h = 12 + Math.sin(x * 0.031) * 5 + rnd(x * 0.07) * 12;
    g.lineTo(x, OY - h);
  }
  g.lineTo(VIEW.W, OY); g.closePath();
  g.globalAlpha = 0.85;
  g.fill();
  g.restore();

  // ground haze at the lip
  const haze = g.createLinearGradient(0, OY - 40, 0, OY);
  haze.addColorStop(0, 'rgba(200,205,200,0)');
  haze.addColorStop(1, 'rgba(205,208,200,0.22)');
  g.fillStyle = haze;
  g.fillRect(0, OY - 40, VIEW.W, 40);
}

function drawRain(g, dt) {
  ensureRain();
  g.save();
  g.strokeStyle = 'rgba(200,215,225,0.28)';
  g.lineWidth = 1;
  g.beginPath();
  for (const d of rainDrops) {
    d.y += d.v * dt;
    d.x += 26 * dt;
    if (d.y > OY) { d.y = -10; d.x = Math.random() * VIEW.W; }
    g.moveTo(d.x, d.y);
    g.lineTo(d.x - 2, d.y + d.len);
  }
  g.stroke();
  g.restore();
}

function drawMotes(g, dt, t, lamp) {
  ensureMotes();
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const m of motes) {
    m.x += (m.vx + Math.sin(t * 0.6 + m.ph) * 5) * dt;
    m.y += m.vy * dt;
    if (m.y < OY - 10) { m.y = VIEW.H + 6; m.x = Math.random() * VIEW.W; }
    if (m.x < -8) m.x = VIEW.W + 8;
    if (m.x > VIEW.W + 8) m.x = -8;
    let a = 0.06;
    if (lamp) {
      const d = Math.hypot(m.x - lamp.x, m.y - lamp.y);
      a += clamp(1 - d / 190, 0, 1) * 0.4;
    }
    g.globalAlpha = a;
    g.fillStyle = '#ffe6bc';
    g.fillRect(m.x, m.y, m.s, m.s);
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Main draw
// ---------------------------------------------------------------------------
export function cellFromPoint(px, py) {
  const c = Math.floor((px - OX) / CELL);
  const r = Math.floor((py - OY) / CELL);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return { c, r };
}

export function cellCenter(c, r) {
  return { x: OX + c * CELL + CELL / 2, y: OY + r * CELL + CELL / 2 };
}

export function draw(g, game, view) {
  const { t, dt, earth, dug, particles, hover, selected, lamp, shake, hint } = view;
  const { world } = game;

  g.save();
  if (options.shake && shake > 0.05 && !options.reducedMotion) {
    g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }

  drawSky(g, t);
  if (options.rain && !options.reducedMotion) drawRain(g, dt);

  g.drawImage(earth, 0, 0);
  g.drawImage(dug, 0, 0);

  // side masks — the trench is a cut, the field continues past it
  g.save();
  g.fillStyle = 'rgba(8,7,6,0.5)';
  g.fillRect(0, OY, OX, VIEW.H - OY);
  g.fillRect(OX + COLS * CELL, OY, VIEW.W - OX - COLS * CELL, VIEW.H - OY);
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 2;
  g.strokeRect(OX, OY, COLS * CELL, ROWS * CELL);
  g.restore();

  // undermined buildings: pulsing cracks + trickling dust
  const pulse = 0.5 + 0.5 * Math.sin(t * 7);
  for (const b of world.buildings) {
    if (!b.undermined) continue;
    const x = OX + b.c0 * CELL, y = OY + b.r0 * CELL, w = b.w * CELL, h = b.h * CELL;
    g.save();
    g.strokeStyle = `rgba(226,92,60,${0.45 + pulse * 0.5})`;
    g.lineWidth = 2;
    g.setLineDash([7, 5]);
    g.lineDashOffset = -t * 22;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    g.restore();
    if (Math.random() < 0.5 && !options.reducedMotion) {
      particles.spawn({
        x: x + Math.random() * w, y: y + h - 2,
        vx: (Math.random() - 0.5) * 8, vy: 30 + Math.random() * 40,
        life: 0, max: 0.6, size: 1 + Math.random() * 2, color: '#9c8a6d', grav: 120, fade: 1,
      });
    }
  }

  // restored glow, breathing
  for (const b of world.buildings) {
    if (b.state !== 'restored') continue;
    const x = OX + b.c0 * CELL, y = OY + b.r0 * CELL, w = b.w * CELL, h = b.h * CELL;
    const warm = b.stratumKey === 'under' ? [127, 214, 207] : [255, 186, 106];
    const amp = 0.10 + 0.035 * Math.sin(t * 1.6 + b.id);
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 1.15);
    gr.addColorStop(0, `rgba(${warm[0]},${warm[1]},${warm[2]},${amp})`);
    gr.addColorStop(1, `rgba(${warm[0]},${warm[1]},${warm[2]},0)`);
    g.fillStyle = gr;
    g.fillRect(x - w, y - h, w * 3, h * 3);
    g.restore();
    // hearth smoke drifting up the trench
    if (!options.reducedMotion && Math.random() < 0.14 && b.stratumKey !== 'under') {
      particles.spawn({
        x: x + w * 0.72, y: y + 4,
        vx: 4 + Math.random() * 8, vy: -14 - Math.random() * 12,
        life: 0, max: 2.4, size: 2 + Math.random() * 4, color: '#8e8578', grav: -3, fade: 1,
      });
    }
  }

  particles.update(dt);
  particles.draw(g);

  if (options.grid) {
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) { g.beginPath(); g.moveTo(OX + c * CELL, OY); g.lineTo(OX + c * CELL, OY + ROWS * CELL); g.stroke(); }
    for (let r = 0; r <= ROWS; r++) { g.beginPath(); g.moveTo(OX, OY + r * CELL); g.lineTo(OX + COLS * CELL, OY + r * CELL); g.stroke(); }
    g.restore();
  }

  // selection + footing hint
  if (selected) {
    const x = OX + selected.c0 * CELL, y = OY + selected.r0 * CELL;
    g.save();
    g.strokeStyle = 'rgba(240,206,140,0.95)';
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, selected.w * CELL - 2, selected.h * CELL - 2);
    g.setLineDash([5, 4]);
    g.strokeStyle = 'rgba(240,206,140,0.5)';
    const bottom = selected.r0 + selected.h;
    for (let dx = 0; dx < selected.w; dx++) {
      g.strokeRect(OX + (selected.c0 + dx) * CELL + 2, OY + bottom * CELL + 2, CELL - 4, CELL - 4);
    }
    g.restore();
  }

  // hover
  if (hover) {
    const x = OX + hover.c * CELL, y = OY + hover.r * CELL;
    g.save();
    g.strokeStyle = hint && hint.bad ? 'rgba(226,92,60,0.9)' : 'rgba(255,240,210,0.75)';
    g.lineWidth = 1.6;
    g.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
    g.fillStyle = hint && hint.bad ? 'rgba(226,92,60,0.12)' : 'rgba(255,240,210,0.09)';
    g.fillRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
    g.restore();
  }

  // lantern
  if (options.lantern && lamp) {
    g.save();
    g.globalCompositeOperation = 'soft-light';
    const gr = g.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, 175);
    gr.addColorStop(0, 'rgba(255,214,150,0.40)');
    gr.addColorStop(0.5, 'rgba(255,190,120,0.14)');
    gr.addColorStop(1, 'rgba(255,180,110,0)');
    g.fillStyle = gr;
    g.fillRect(lamp.x - 180, lamp.y - 180, 360, 360);
    g.restore();
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gr2 = g.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, 105);
    gr2.addColorStop(0, 'rgba(255,196,120,0.075)');
    gr2.addColorStop(1, 'rgba(255,196,120,0)');
    g.fillStyle = gr2;
    g.fillRect(lamp.x - 110, lamp.y - 110, 220, 220);
    g.restore();
  }

  if (options.motes && !options.reducedMotion) drawMotes(g, dt, t, options.lantern ? lamp : null);

  // vignette
  const vg = g.createRadialGradient(VIEW.W / 2, VIEW.H * 0.52, VIEW.H * 0.28, VIEW.W / 2, VIEW.H * 0.52, VIEW.H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, VIEW.W, VIEW.H);

  if (options.grain) {
    g.save();
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.5;
    const tile = bakeGrain();
    const pat = g.createPattern(tile, 'repeat');
    g.fillStyle = pat;
    g.translate((t * 3) % 128 - 128, (t * 2) % 128 - 128);
    g.fillRect(0, 0, VIEW.W + 256, VIEW.H + 256);
    g.restore();
  }

  g.restore();
}

// stratum label ribbons down the left margin
export function drawStrataLabels(g) {
  g.save();
  g.font = '600 10px ui-sans-serif, system-ui, sans-serif';
  g.textBaseline = 'middle';
  for (const s of STRATA) {
    const y = OY + ((s.rows[0] + s.rows[1] + 1) / 2) * CELL;
    g.save();
    g.translate(OX - 16, y);
    g.rotate(-Math.PI / 2);
    g.fillStyle = s.glow ? 'rgba(127,214,207,0.75)' : 'rgba(226,214,190,0.6)';
    g.textAlign = 'center';
    g.fillText(s.name.toUpperCase(), 0, 0);
    g.restore();
  }
  g.restore();
}
