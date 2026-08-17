// MIDDEN — rules engine. Deliberately free of rendering and DOM so it can be
// driven headlessly by MIDDEN.sim().

import {
  COLS, ROWS, ECONOMY, TAGS, affinity, affinityNote, STRATA, EPILOGUE_GRADES,
} from './content.js';
import {
  makeWorld, cellAt, buildingById, isVoid, isPassable, isReachable, isUndermined,
  footingCells, idx,
} from './world.js';

export function createGame(seedStr) {
  const world = makeWorld(seedStr);
  return {
    world,
    salvage: ECONOMY.startingSalvage,
    spent: 0,
    earned: ECONOMY.startingSalvage,
    actions: 0,
    log: [],
    events: [],            // transient, drained by the renderer for effects
    pendingCollapse: new Set(),
    over: false,
    ended: null,
    stats: { cleared: 0, restored: 0, salvaged: 0, collapsed: 0, soundings: 0, props: 0 },
  };
}

// --- logging ---------------------------------------------------------------
export function logLine(g, text, tone = 'plain') {
  g.log.push({ text, tone, n: g.actions });
  if (g.log.length > 120) g.log.shift();
}

function emit(g, type, data) { g.events.push({ type, ...data }); }

// --- scoring ---------------------------------------------------------------
// Two restored buildings are adjacent if any of their cells are orthogonally
// adjacent. Cross-stratum pairs count double, in both directions.
export function adjacentPairs(g) {
  const { world } = g;
  const restored = world.buildings.filter((b) => b.state === 'restored');
  const owner = new Map();
  for (const b of restored) for (const { c, r } of b.cells) owner.set(idx(c, r), b.id);

  const seen = new Set();
  const pairs = [];
  for (const b of restored) {
    for (const { c, r } of b.cells) {
      const nbrs = [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]];
      for (const [nc, nr] of nbrs) {
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
        const oid = owner.get(idx(nc, nr));
        if (!oid || oid === b.id) continue;
        const key = b.id < oid ? `${b.id}:${oid}` : `${oid}:${b.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push([b, buildingById(world, oid)]);
      }
    }
  }
  return pairs;
}

export function pairScore(a, b) {
  let best = 0;
  let note = null;
  for (const ta of a.tags) {
    for (const tb of b.tags) {
      const v = affinity(ta, tb);
      if (note === null || Math.abs(v) > Math.abs(best)) { best = v; note = affinityNote(ta, tb); }
    }
  }
  const cross = a.stratumIndex !== b.stratumIndex;
  return {
    raw: best,
    value: cross ? best * ECONOMY.crossStratumMultiplier : best,
    cross,
    note,
  };
}

export function coherence(g) {
  let base = 0;
  for (const b of g.world.buildings) if (b.state === 'restored') base += b.baseValue;
  let adj = 0;
  const detail = [];
  for (const [a, b] of adjacentPairs(g)) {
    const s = pairScore(a, b);
    adj += s.value;
    detail.push({ a, b, ...s });
  }
  return { total: base + adj, base, adj, detail };
}

// Preview of what restoring `b` would add right now.
export function previewRestore(g, b) {
  const parts = [];
  let delta = b.baseValue;
  const owner = new Map();
  for (const o of g.world.buildings) {
    if (o.state !== 'restored') continue;
    for (const { c, r } of o.cells) owner.set(idx(c, r), o.id);
  }
  const touched = new Set();
  for (const { c, r } of b.cells) {
    for (const [nc, nr] of [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]]) {
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const oid = owner.get(idx(nc, nr));
      if (!oid || touched.has(oid)) continue;
      touched.add(oid);
      const other = buildingById(g.world, oid);
      const s = pairScore(b, other);
      delta += s.value;
      parts.push({ other, ...s });
    }
  }
  return { delta, parts };
}

// --- collapse --------------------------------------------------------------
function voidOut(g, b, kind) {
  for (const { c, r } of b.cells) {
    const cell = cellAt(g.world, c, r);
    cell.state = kind;        // 'rubble' for collapse, 'open' for salvage
    cell.bId = null;
  }
}

function collapseBuilding(g, b, cascade) {
  const wasRestored = b.state === 'restored';
  b.state = 'collapsed';
  b.undermined = false;
  b.warned = false;
  voidOut(g, b, 'rubble');
  g.pendingCollapse.delete(b.id);
  g.stats.collapsed++;
  emit(g, 'collapse', { b, cascade });
  logLine(
    g,
    cascade
      ? `${b.name} goes with it.`
      : wasRestored
        ? `${b.name} comes down. Everything you put into it is under it now.`
        : `${b.name} falls in before you could decide what to do with it.`,
    'bad',
  );
}

// Resolve every currently-undermined building. Direct collapses get one action
// of warning; anything toppled by the resulting void goes immediately.
export function resolveCollapses(g) {
  let fell = 0;

  // Anything already standing on air before this resolution has either had its
  // warning, or is owed one. Only voids opened by a collapse cascade instantly.
  const preUndermined = new Set(
    g.world.buildings
      .filter((b) => (b.state === 'exposed' || b.state === 'restored') && isUndermined(g.world, b))
      .map((b) => b.id),
  );

  // matured warnings from the previous action
  for (const id of Array.from(g.pendingCollapse)) {
    const b = buildingById(g.world, id);
    if (!b || (b.state !== 'exposed' && b.state !== 'restored')) { g.pendingCollapse.delete(id); continue; }
    if (!isUndermined(g.world, b)) { g.pendingCollapse.delete(id); b.undermined = false; b.warned = false; continue; }
    collapseBuilding(g, b, false);
    fell++;
  }

  // cascade upward: rubble is not load-bearing, so what sat on the fallen
  // building goes with it — immediately, with no warning of its own
  let guard = 0;
  while (guard++ < 200) {
    const next = g.world.buildings.filter(
      (b) => (b.state === 'exposed' || b.state === 'restored')
          && !preUndermined.has(b.id)
          && isUndermined(g.world, b),
    );
    if (!next.length) break;
    for (const b of next) { collapseBuilding(g, b, true); fell++; }
  }
  return fell;
}

// Flag anything the player's action just undermined.
export function markUndermined(g) {
  for (const b of g.world.buildings) {
    if (b.state !== 'exposed' && b.state !== 'restored') { b.undermined = false; continue; }
    const u = isUndermined(g.world, b);
    b.undermined = u;
    if (u && !g.pendingCollapse.has(b.id)) {
      g.pendingCollapse.add(b.id);
      b.warned = true;
      emit(g, 'undermine', { b });
      logLine(g, `${b.name} is standing on open air. It will not stand long.`, 'warn');
    } else if (!u) {
      b.warned = false;
      g.pendingCollapse.delete(b.id);
    }
  }
}

// Every player action funnels through here.
//
// Order matters: the action resolves BEFORE last turn's warnings mature.
// Resolving first would mean the prop you place to save a building arrives
// after it has already come down — the grace window would be consumed by the
// very action meant to use it.
function act(g, fn) {
  if (g.over) return { ok: false, why: 'The dig is closed.' };
  const res = fn();
  if (res.ok) {
    g.actions++;
    resolveCollapses(g);
    markUndermined(g);
    checkExhaustion(g);
  }
  return res;
}

// --- actions ---------------------------------------------------------------
export function digCostAt(r) { return ECONOMY.digCost(r); }

export function canClear(g, c, r) {
  const cell = cellAt(g.world, c, r);
  if (!cell) return { ok: false, why: 'Outside the trench.' };
  if (cell.state === 'bedrock') return { ok: false, why: 'Bedrock. The trench stops here.' };
  if (isVoid(g.world, c, r)) return { ok: false, why: 'Already open.' };
  if (!isReachable(g.world, c, r)) return { ok: false, why: 'No open face touches this. Dig in from the surface.' };
  const cost = digCostAt(r);
  if (g.salvage < cost) return { ok: false, why: `Needs ${cost} salvage to shore.` };
  return { ok: true, cost };
}

export function clearCell(g, c, r) {
  return act(g, () => {
    const check = canClear(g, c, r);
    if (!check.ok) return check;
    const cell = cellAt(g.world, c, r);
    g.salvage -= check.cost;
    g.spent += check.cost;
    g.stats.cleared++;

    if (cell.bId !== null) {
      const b = buildingById(g.world, cell.bId);
      cell.state = 'exposed-part';
      b.revealedCount++;
      emit(g, 'dig', { c, r, hitStone: true });
      if (b.revealedCount === 1) {
        logLine(g, `Masonry. ${b.name}, or what is left of it.`, 'find');
        emit(g, 'reveal', { b, first: true });
      }
      if (b.revealedCount >= b.cells.length && b.state === 'buried') {
        b.state = 'exposed';
        logLine(g, `${b.name} is fully clear. ${b.desc}`, 'good');
        emit(g, 'reveal', { b, full: true });
      }
    } else {
      cell.state = 'open';
      emit(g, 'dig', { c, r, hitStone: false });
    }

    if (cell.find) {
      g.salvage += cell.find;
      g.earned += cell.find;
      logLine(g, `Loose worked stone in the spoil. +${cell.find} salvage.`, 'good');
      emit(g, 'find', { c, r, amount: cell.find });
      cell.find = 0;
    }
    return { ok: true };
  });
}

export function canSound(g, c) {
  if (c < 0 || c >= COLS) return { ok: false, why: 'Outside the trench.' };
  if (g.salvage < ECONOMY.soundingCost) return { ok: false, why: `Needs ${ECONOMY.soundingCost} salvage.` };
  return { ok: true, cost: ECONOMY.soundingCost };
}

// Drives a thin rod down a column from the first unsounded, unopened cell.
export function sound(g, c) {
  return act(g, () => {
    const check = canSound(g, c);
    if (!check.ok) return check;
    let start = 0;
    while (start < ROWS && (isVoid(g.world, c, start) || cellAt(g.world, c, start).sounded)) start++;
    if (start >= ROWS) return { ok: false, why: 'This column is already read to bedrock.' };

    g.salvage -= check.cost;
    g.spent += check.cost;
    g.stats.soundings++;
    let hits = 0;
    for (let i = 0; i < ECONOMY.soundingDepth; i++) {
      const r = start + i;
      if (r >= ROWS) break;
      const cell = cellAt(g.world, c, r);
      cell.sounded = true;
      if (cell.bId !== null) hits++;
    }
    emit(g, 'sound', { c, start, depth: Math.min(ECONOMY.soundingDepth, ROWS - start) });
    logLine(
      g,
      hits ? `The rod knocks on something ${hits === 1 ? 'once' : `${hits} times`} going down.`
           : 'The rod goes down clean. Nothing but silt.',
      hits ? 'find' : 'plain',
    );
    return { ok: true };
  });
}

export function canProp(g, c, r) {
  const cell = cellAt(g.world, c, r);
  if (!cell) return { ok: false, why: 'Outside the trench.' };
  if (!isVoid(g.world, c, r)) return { ok: false, why: 'Props go in open ground.' };
  if (g.salvage < ECONOMY.propCost) return { ok: false, why: `Needs ${ECONOMY.propCost} salvage.` };
  return { ok: true, cost: ECONOMY.propCost };
}

export function prop(g, c, r) {
  return act(g, () => {
    const check = canProp(g, c, r);
    if (!check.ok) return check;
    g.salvage -= check.cost;
    g.spent += check.cost;
    g.stats.props++;
    cellAt(g.world, c, r).state = 'prop';
    emit(g, 'prop', { c, r });
    logLine(g, 'Timber in, wedged tight. It will hold.', 'good');
    return { ok: true };
  });
}

export function canRestore(g, b) {
  if (!b) return { ok: false, why: 'Nothing selected.' };
  if (b.state !== 'exposed') return { ok: false, why: 'Clear the whole footprint first.' };
  if (g.salvage < b.restoreCost) return { ok: false, why: `Needs ${b.restoreCost} salvage.` };
  return { ok: true, cost: b.restoreCost };
}

export function restore(g, bId) {
  return act(g, () => {
    const b = buildingById(g.world, bId);
    const check = canRestore(g, b);
    if (!check.ok) return check;
    const before = coherence(g).total;
    g.salvage -= b.restoreCost;
    g.spent += b.restoreCost;
    b.state = 'restored';
    b.restoredAt = g.actions;
    for (const { c, r } of b.cells) cellAt(g.world, c, r).state = 'restored-part';
    g.stats.restored++;
    const after = coherence(g).total;
    emit(g, 'restore', { b, delta: after - before });
    logLine(g, `${b.name} stands again. Coherence ${after - before >= 0 ? '+' : ''}${after - before}.`, after - before >= 0 ? 'good' : 'warn');
    return { ok: true, delta: after - before };
  });
}

export function canSalvage(g, b) {
  if (!b) return { ok: false, why: 'Nothing selected.' };
  if (b.state !== 'exposed' && b.state !== 'restored') return { ok: false, why: 'Clear the whole footprint first.' };
  return { ok: true, yield: b.state === 'restored' ? Math.round(b.salvageValue * 0.6) : b.salvageValue };
}

export function salvage(g, bId) {
  return act(g, () => {
    const b = buildingById(g.world, bId);
    const check = canSalvage(g, b);
    if (!check.ok) return check;
    const gain = check.yield;
    g.salvage += gain;
    g.earned += gain;
    b.state = 'salvaged';
    voidOut(g, b, 'open');
    g.stats.salvaged++;
    emit(g, 'salvage', { b, gain });
    logLine(g, `${b.name} broken up for stone. +${gain} salvage.`, 'plain');
    return { ok: true, gain };
  });
}

// --- end conditions --------------------------------------------------------
export function legalMovesExist(g) {
  for (const b of g.world.buildings) {
    if (b.state === 'exposed') return true;              // salvage always free
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isReachable(g.world, c, r) && g.salvage >= digCostAt(r)) return true;
    }
  }
  // Soundings alone are not a living: if you cannot clear and cannot break
  // anything up, the dig is over.
  return false;
}

function checkExhaustion(g) {
  if (g.over) return;
  if (!legalMovesExist(g)) endRun(g, 'exhausted');
}

export function endRun(g, reason = 'backfilled') {
  if (g.over) return;
  resolveCollapses(g);
  g.over = true;
  const score = coherence(g);
  const grade = EPILOGUE_GRADES.find((x) => score.total >= x.min);
  const lost = g.world.buildings.filter((b) => b.state === 'collapsed');
  const broken = g.world.buildings.filter((b) => b.state === 'salvaged');
  const saved = g.world.buildings.filter((b) => b.state === 'restored');
  const untouched = g.world.buildings.filter((b) => b.state === 'buried');
  g.ended = {
    reason, score, grade, saved, lost, broken, untouched,
    strataTouched: STRATA.filter((s) => s.index > 0 && g.world.buildings.some(
      (b) => b.stratumKey === s.key && b.state !== 'buried',
    )),
  };
  logLine(g, reason === 'exhausted'
    ? 'Nothing left you can afford to touch. The dig closes itself.'
    : 'You backfill the trench and walk out of the vale.', 'end');
  emit(g, 'end', {});
  return g.ended;
}

// --- helpers used by UI ----------------------------------------------------
export { buildingById, cellAt, isVoid, isPassable, isReachable, isUndermined, footingCells };

export function traceVisible(g, c, r) {
  const cell = cellAt(g.world, c, r);
  if (!cell) return false;
  if (cell.state !== 'earth' && cell.state !== 'buried-part') return false;
  if (r === 0) return true;
  return isPassable(g.world, c - 1, r) || isPassable(g.world, c + 1, r)
      || isPassable(g.world, c, r - 1) || isPassable(g.world, c, r + 1);
}

export function tagInfo(key) { return TAGS[key]; }
