// MIDDEN — trench generation. Deterministic given a seed.

import {
  COLS, ROWS, BEDROCK_ROW, STRATA, CATALOGUE, CONDITIONS, ECONOMY, strataForRow,
} from './content.js';

// --- seeded RNG -------------------------------------------------------------
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rng, list) {
  const total = list.reduce((s, x) => s + (x.weight || 1), 0);
  let r = rng() * total;
  for (const x of list) { r -= (x.weight || 1); if (r <= 0) return x; }
  return list[list.length - 1];
}

// --- cells ------------------------------------------------------------------
// state: 'earth' | 'open' | 'buried-part' | 'exposed-part' | 'restored-part'
//        | 'rubble' | 'prop' | 'bedrock'
//
// Solidity (what holds load):  earth, buried-part, exposed-part,
//                              restored-part, prop, bedrock
// Void (holds nothing):        open, rubble

export const SOLID_STATES = new Set([
  'earth', 'buried-part', 'exposed-part', 'restored-part', 'prop', 'bedrock',
]);

export function idx(c, r) { return r * COLS + c; }
export function inBounds(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }

export function makeWorld(seedStr) {
  const seed = hashSeed(String(seedStr));
  const rng = mulberry32(seed);

  const cells = new Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const isBedrock = r >= BEDROCK_ROW;
      cells[idx(c, r)] = {
        c, r,
        state: isBedrock ? 'bedrock' : 'earth',
        stratum: isBedrock ? null : strataForRow(r).key,
        bId: null,
        partX: 0, partY: 0,      // position within the building footprint
        sounded: false,
        find: 0,                 // loose salvage in topsoil
        detail: rng(),           // deterministic per-cell art seed
        detail2: rng(),
        shakeUntil: 0,
      };
    }
  }

  // loose finds through every stratum — the trickle of income that keeps a
  // shaft from being pure outgoing
  for (let r = 0; r < BEDROCK_ROW; r++) {
    const st = strataForRow(r);
    for (let c = 0; c < COLS; c++) {
      if (rng() < ECONOMY.spoilFindChance) {
        cells[idx(c, r)].find = ECONOMY.spoilFindValue(st.index);
      }
    }
  }

  const buildings = [];
  let nextId = 1;

  for (const stratum of STRATA) {
    if (stratum.index === 0) continue;
    const catalogue = CATALOGUE[stratum.key];
    const [r0, r1] = stratum.rows;
    const bandCells = COLS * (r1 - r0 + 1);
    // Enough soil between the buildings for routes to exist.
    const targetFill = 0.48;
    let filled = 0;
    let guard = 0;

    while (filled < bandCells * targetFill && guard++ < 400) {
      const def = pickWeighted(rng, catalogue);
      const maxC = COLS - def.w;
      const maxR = r1 - def.h + 1;
      if (maxC < 0 || maxR < r0) continue;
      const c0 = Math.floor(rng() * (maxC + 1));
      const rr0 = r0 + Math.floor(rng() * (maxR - r0 + 1));

      // free?
      let free = true;
      for (let dy = 0; dy < def.h && free; dy++) {
        for (let dx = 0; dx < def.w; dx++) {
          if (cells[idx(c0 + dx, rr0 + dy)].bId !== null) { free = false; break; }
        }
      }
      if (!free) continue;

      const condition = pickWeighted(rng, Object.values(CONDITIONS)).key;
      const b = {
        id: nextId++,
        key: def.key,
        name: def.name,
        desc: def.desc,
        tags: def.tags.slice(),
        stratumKey: stratum.key,
        stratumIndex: stratum.index,
        condition,
        w: def.w, h: def.h,
        c0, r0: rr0,
        cells: [],
        state: 'buried',        // buried | exposed | restored | salvaged | collapsed
        revealedCount: 0,
        undermined: false,
        warned: false,
        restoredAt: 0,
      };
      for (let dy = 0; dy < def.h; dy++) {
        for (let dx = 0; dx < def.w; dx++) {
          const cell = cells[idx(c0 + dx, rr0 + dy)];
          cell.bId = b.id;
          cell.state = 'buried-part';
          cell.partX = dx; cell.partY = dy;
          b.cells.push({ c: c0 + dx, r: rr0 + dy });
        }
      }
      buildings.push(b);
      filled += def.w * def.h;
    }
  }

  // Precompute costs/values now that footprints exist.
  for (const b of buildings) {
    b.restoreCost = ECONOMY.restoreCost(b);
    b.salvageValue = ECONOMY.salvageYield(b);
    b.baseValue = ECONOMY.baseValue(b);
  }

  // Wavy stratum boundary offsets, for painting only.
  const boundaryNoise = [];
  for (let c = 0; c <= COLS; c++) boundaryNoise.push(rng());

  return { seed, seedStr: String(seedStr), cells, buildings, boundaryNoise };
}

export function cellAt(world, c, r) {
  if (!inBounds(c, r)) return null;
  return world.cells[idx(c, r)];
}

export function buildingById(world, id) {
  return world.buildings.find((b) => b.id === id) || null;
}

export function isSolid(world, c, r) {
  if (r >= ROWS) return true;              // below bedrock is solid
  if (!inBounds(c, r)) return true;        // trench walls are solid
  return SOLID_STATES.has(world.cells[idx(c, r)].state);
}

export function isVoid(world, c, r) {
  if (!inBounds(c, r)) return false;
  const s = world.cells[idx(c, r)].state;
  return s === 'open' || s === 'rubble';
}

// Passable is NOT the same as void. A building you have brushed out is a room:
// you can work through it, but its walls still carry load. A building you have
// restored is whole again — it seals the ground beneath it against your own
// spade, which is the one protection restoring buys you.
export function isPassable(world, c, r) {
  if (!inBounds(c, r)) return false;
  const s = world.cells[idx(c, r)].state;
  return s === 'open' || s === 'rubble' || s === 'exposed-part';
}

// A cell can be cleared if it touches worked ground: the surface, or a cell
// you have already opened.
export function isReachable(world, c, r) {
  if (!inBounds(c, r)) return false;
  const cell = world.cells[idx(c, r)];
  if (cell.state === 'bedrock' || isVoid(world, c, r)) return false;
  if (cell.state === 'exposed-part' || cell.state === 'restored-part' || cell.state === 'prop') return false;
  if (r === 0) return true;
  return isPassable(world, c - 1, r) || isPassable(world, c + 1, r)
      || isPassable(world, c, r - 1) || isPassable(world, c, r + 1);
}

// The cells a building rests on: one row below each footprint column.
export function footingCells(b) {
  const out = [];
  const bottom = b.r0 + b.h - 1;
  for (let dx = 0; dx < b.w; dx++) out.push({ c: b.c0 + dx, r: bottom + 1 });
  return out;
}

export function isUndermined(world, b) {
  if (b.state !== 'exposed' && b.state !== 'restored') return false;
  return footingCells(b).some(({ c, r }) => isVoid(world, c, r));
}
