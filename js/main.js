// MIDDEN — boot, screens, input, loop.

import {
  COLS, ROWS, STRATA, TAGS, INTRO_LINES, HOWTO_SECTIONS, ECONOMY, CONDITIONS,
} from './content.js';
import { makeWorld, cellAt, isVoid } from './world.js';
import * as G from './game.js';
import {
  VIEW, options, bakeEarth, bakeDug, draw, drawStrataLabels, cellFromPoint,
  cellCenter, Particles,
} from './render.js';
import * as A from './audio.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  game: null,
  earth: null,
  dug: null,
  dirty: true,
  mode: 'clear',
  selected: null,
  hover: null,
  lamp: { x: VIEW.W / 2, y: VIEW.H / 2 },
  shake: 0,
  t: 0,
  last: 0,
  running: false,
  seed: '',
  confirmAction: null,
};

const canvas = $('#trench');
const ctx = canvas.getContext('2d');
const particles = new Particles();

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------
const PREFS_KEY = 'midden.prefs.v1';
const prefs = {
  master: 80, sfx: 90, amb: 55, mute: false,
  lantern: true, grain: true, rain: true, motes: true, shake: true, reduced: false,
  grid: false, confirmBreak: true,
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) Object.assign(prefs, JSON.parse(raw));
  } catch { /* private mode, whatever */ }
  applyPrefs();
  syncPrefUI();
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}
function applyPrefs() {
  A.settings.master = prefs.master / 100;
  A.settings.sfx = prefs.sfx / 100;
  A.settings.ambience = prefs.amb / 100;
  A.settings.muted = prefs.mute;
  A.applySettings();
  options.lantern = prefs.lantern;
  options.grain = prefs.grain;
  options.rain = prefs.rain;
  options.motes = prefs.motes;
  options.shake = prefs.shake;
  options.reducedMotion = prefs.reduced;
  options.grid = prefs.grid;
}
function syncPrefUI() {
  $('#volMaster').value = prefs.master; $('#volMasterV').textContent = prefs.master;
  $('#volSfx').value = prefs.sfx;       $('#volSfxV').textContent = prefs.sfx;
  $('#volAmb').value = prefs.amb;       $('#volAmbV').textContent = prefs.amb;
  $('#optMute').checked = prefs.mute;
  $('#optLantern').checked = prefs.lantern;
  $('#optGrain').checked = prefs.grain;
  $('#optRain').checked = prefs.rain;
  $('#optMotes').checked = prefs.motes;
  $('#optShake').checked = prefs.shake;
  $('#optReduced').checked = prefs.reduced;
  $('#optGrid').checked = prefs.grid;
  $('#optConfirm').checked = prefs.confirmBreak;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function show(id) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $(`#${id}`).classList.add('active');
}

function randomSeed() {
  const words = ['fen', 'holt', 'mire', 'wold', 'garth', 'lea', 'stow', 'thorpe', 'bank', 'hythe'];
  return words[Math.floor(Math.random() * words.length)] + '-' + Math.floor(100 + Math.random() * 900);
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function newGame(seed) {
  S.seed = seed || randomSeed();
  S.game = G.createGame(S.seed);
  S.earth = bakeEarth(S.game.world);
  S.dirty = true;
  S.selected = null;
  S.hover = null;
  S.shake = 0;
  particles.list.length = 0;
  G.logLine(S.game, `Trench ${S.seed} opened. The Board expects a return.`, 'end');
  renderPanel();
  renderLog();
  renderReadouts();
  return S.game;
}

function rebake() {
  S.dug = bakeDug(S.game, S.earth);
  S.dirty = false;
}

// ---------------------------------------------------------------------------
// Event drain → sound, particles, shake, floaters
// ---------------------------------------------------------------------------
function drainEvents() {
  const g = S.game;
  if (!g.events.length) return;
  for (const ev of g.events) {
    switch (ev.type) {
      case 'dig': {
        const p = cellCenter(ev.c, ev.r);
        if (ev.hitStone) { A.sfx.digStone(); particles.burstDust(p.x, p.y, 10, '#b6a481'); }
        else { A.sfx.dig(); particles.burstDust(p.x, p.y, 14); }
        break;
      }
      case 'find': {
        const p = cellCenter(ev.c, ev.r);
        A.sfx.find();
        particles.sparkle(p.x, p.y, '#ffd48a', 14);
        floater(p.x, p.y, `+${ev.amount}`, '#f0c789');
        break;
      }
      case 'reveal':
        A.sfx.reveal();
        break;
      case 'sound': {
        A.sfx.sounding();
        const p = cellCenter(ev.c, ev.start);
        particles.sparkle(p.x, p.y - 10, '#cfe6ff', 8);
        break;
      }
      case 'prop': {
        A.sfx.prop();
        const p = cellCenter(ev.c, ev.r);
        particles.burstDust(p.x, p.y, 8, '#8d6b40');
        break;
      }
      case 'restore': {
        A.sfx.restore();
        const p = cellCenter(ev.b.c0 + (ev.b.w - 1) / 2, ev.b.r0 + (ev.b.h - 1) / 2);
        particles.sparkle(p.x, p.y, ev.b.stratumKey === 'under' ? '#7fd6cf' : '#ffd08a', 26);
        floater(p.x, p.y - 12, `${ev.delta >= 0 ? '+' : ''}${ev.delta}`, ev.delta >= 0 ? '#a7c47a' : '#e2705a');
        break;
      }
      case 'salvage': {
        A.sfx.salvage();
        const p = cellCenter(ev.b.c0 + (ev.b.w - 1) / 2, ev.b.r0 + (ev.b.h - 1) / 2);
        particles.burstDebris(p.x, p.y, 22);
        particles.burstDust(p.x, p.y, 20, '#6d5b45');
        floater(p.x, p.y - 10, `+${ev.gain}`, '#f0c789');
        S.shake = Math.max(S.shake, 3);
        break;
      }
      case 'undermine':
        A.sfx.groan();
        toast(`${ev.b.name} is undermined. Prop the ground beneath it, or lose it.`, true);
        break;
      case 'collapse': {
        A.sfx.collapse();
        const p = cellCenter(ev.b.c0 + (ev.b.w - 1) / 2, ev.b.r0 + (ev.b.h - 1) / 2);
        particles.burstDebris(p.x, p.y, 34);
        particles.columnDust(p.x, p.y - 20, p.y + 30, 42);
        S.shake = Math.max(S.shake, ev.cascade ? 14 : 11);
        if (S.selected && S.selected.id === ev.b.id) S.selected = null;
        break;
      }
      case 'end':
        A.sfx.end();
        break;
    }
  }
  g.events.length = 0;
  S.dirty = true;
}

// ---------------------------------------------------------------------------
// Toast / floaters
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function floater(cx, cy, text, color) {
  const wrap = $('#floaters');
  const el = document.createElement('div');
  el.className = 'floater';
  el.textContent = text;
  el.style.color = color;
  el.style.left = `${(cx / VIEW.W) * 100}%`;
  el.style.top = `${(cy / VIEW.H) * 100}%`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
function bumpEl(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

let lastSalvage = null, lastScore = null;
function renderReadouts() {
  const g = S.game;
  const sc = G.coherence(g).total;
  const sEl = $('#rvSalvage'), cEl = $('#rvScore');
  if (lastSalvage !== null && g.salvage !== lastSalvage) bumpEl(sEl);
  if (lastScore !== null && sc !== lastScore) bumpEl(cEl);
  sEl.textContent = g.salvage;
  cEl.textContent = sc;
  cEl.classList.toggle('neg', sc < 0);
  lastSalvage = g.salvage; lastScore = sc;
}

function tagChip(key) {
  const t = TAGS[key];
  return `<span class="tag" style="color:${t.color}">${t.glyph} ${t.label}</span>`;
}

function renderPanel() {
  const g = S.game;
  const card = $('#selCard');
  const b = S.selected;

  if (!b) {
    const hoverInfo = S.hover ? describeCell(S.hover.c, S.hover.r) : null;
    card.innerHTML = `
      <div class="card-empty">
        ${hoverInfo || `<p><strong>Nothing selected.</strong></p>
        <p class="muted">Clear soil from the surface downward. Masonry on the open face shows as a pale seam; a sounding returns silhouettes without names.</p>`}
      </div>`;
    return;
  }

  const st = STRATA.find((s) => s.key === b.stratumKey);
  const cond = CONDITIONS[b.condition];
  const canR = G.canRestore(g, b);
  const canS = G.canSalvage(g, b);
  const pv = b.state === 'exposed' ? G.previewRestore(g, b) : null;

  let pairsHtml = '';
  if (pv && pv.parts.length) {
    pairsHtml = `<div class="pairs">${pv.parts.map((p) => `
      <div class="pair">
        <span>beside ${p.other.name} ${p.cross ? '<span class="cross">· CROSS-STRATUM ×2</span>' : ''}</span>
        <b class="${p.value >= 0 ? 'pos' : 'neg'}">${p.value >= 0 ? '+' : ''}${p.value}</b>
      </div>
      <div class="pair"><span class="muted" style="font-style:italic;font-size:.72rem">${p.note || ''}</span><span></span></div>
    `).join('')}</div>`;
  }

  const stateLabel = {
    buried: 'Partly cleared', exposed: 'Cleared', restored: 'Standing',
    salvaged: 'Broken up', collapsed: 'Fallen',
  }[b.state];

  card.innerHTML = `
    <h3>${b.name}</h3>
    <div class="sub ${b.stratumKey === 'under' ? 'under' : ''}">${st.name} · ${cond.label} · ${stateLabel}</div>
    <div class="tags">${b.tags.map(tagChip).join('')}</div>
    <p class="desc">${b.state === 'buried' ? 'Still half in the ground. Clear the rest of the footprint.' : b.desc}</p>
    ${b.undermined ? `<div class="warnbar"><strong>Undermined.</strong> Open ground beneath it. It falls on your next action unless you prop the gap.</div>` : ''}
    <div class="statline"><span>Footprint</span><b>${b.w}×${b.h}</b></div>
    <div class="statline"><span>Restore</span><b>${b.restoreCost} salvage</b></div>
    <div class="statline"><span>Break up</span><b class="pos">+${canS.ok ? canS.yield : b.salvageValue} salvage</b></div>
    ${pv ? `<div class="statline"><span>Coherence if restored</span><b class="${pv.delta >= 0 ? 'pos' : 'neg'}">${pv.delta >= 0 ? '+' : ''}${pv.delta}</b></div>` : ''}
    ${pairsHtml}
    <div class="actions">
      <button class="btn btn-primary" id="actRestore" ${canR.ok ? '' : 'disabled'} title="${canR.ok ? '' : canR.why}">Restore</button>
      <button class="btn btn-danger" id="actSalvage" ${canS.ok ? '' : 'disabled'} title="${canS.ok ? '' : canS.why}">Break up</button>
    </div>
  `;

  const rb = $('#actRestore'), sb = $('#actSalvage');
  if (rb) rb.onclick = () => doRestore(b);
  if (sb) sb.onclick = () => doSalvage(b);
}

function describeCell(c, r) {
  const g = S.game;
  const cell = cellAt(g.world, c, r);
  if (!cell) return null;
  if (cell.state === 'bedrock') return `<p><strong>Bedrock.</strong></p><p class="muted">The trench stops here. Nothing was ever built below this.</p>`;
  if (isVoid(g.world, c, r)) {
    return `<p><strong>Open ground.</strong></p><p class="muted">Cleared. Holds nothing up. A prop here (${ECONOMY.propCost} salvage) would.</p>`;
  }
  if (cell.state === 'prop') return `<p><strong>Propped.</strong></p><p class="muted">Timber, wedged. Counts as solid ground.</p>`;
  const st = STRATA.find((s) => s.key === cell.stratum);
  const cost = G.digCostAt(r);
  const trace = cell.bId !== null && G.traceVisible(g, c, r);
  const sounded = cell.sounded && cell.bId !== null;
  let hint = '<p class="muted">Undisturbed soil, as far as you can tell.</p>';
  if (trace) hint = `<p style="color:var(--amber-2)">A seam of worked stone shows in the face.</p>`;
  else if (sounded) hint = `<p style="color:var(--cyan)">The rod struck something here. Shape only — no telling what.</p>`;
  return `
    <p><strong>${st.name}</strong> <span class="muted">· ${st.sub}</span></p>
    <p class="muted" style="font-style:italic">${st.blurb}</p>
    ${hint}
    <div class="statline"><span>Clear this cell</span><b>${cost} salvage</b></div>`;
}

function renderLog() {
  const el = $('#log');
  const lines = S.game.log.slice(-40);
  el.innerHTML = lines.map((l) => `<p class="${l.tone}">${l.text}</p>`).join('');
  el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function after(res) {
  drainEvents();
  renderReadouts();
  renderLog();
  renderPanel();
  if (S.game.over) setTimeout(showEnd, 1400);
  if (res && !res.ok && res.why) { A.sfx.deny(); toast(res.why, true); }
  return res;
}

function doClear(c, r) { after(G.clearCell(S.game, c, r)); }
function doSound(c) { after(G.sound(S.game, c)); }
function doProp(c, r) { after(G.prop(S.game, c, r)); }
function doRestore(b) {
  const res = after(G.restore(S.game, b.id));
  if (res.ok) S.selected = G.buildingById(S.game.world, b.id);
}
function doSalvage(b) {
  if (b.state === 'restored' && prefs.confirmBreak) {
    $('#confirmText').innerHTML = `<strong>${b.name}</strong> is standing. Breaking it up returns only <b>${Math.round(b.salvageValue * 0.6)}</b> salvage and forfeits its coherence.`;
    S.confirmAction = () => { S.selected = null; after(G.salvage(S.game, b.id)); };
    openModal('#confirmModal');
    return;
  }
  S.selected = null;
  after(G.salvage(S.game, b.id));
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function pointerToView(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * VIEW.W;
  const y = ((ev.clientY - rect.top) / rect.height) * VIEW.H;
  return { x, y };
}

canvas.addEventListener('pointermove', (ev) => {
  const p = pointerToView(ev);
  S.lamp.x = p.x; S.lamp.y = p.y;
  const cell = cellFromPoint(p.x, p.y);
  const changed = (!!cell !== !!S.hover) || (cell && S.hover && (cell.c !== S.hover.c || cell.r !== S.hover.r));
  S.hover = cell;
  if (changed) {
    if (cell) $('#costClear').textContent = G.digCostAt(cell.r);
    if (!S.selected) renderPanel();
  }
});

canvas.addEventListener('pointerleave', () => { S.hover = null; });

canvas.addEventListener('pointerdown', (ev) => {
  A.unlock();
  if (S.game.over) return;
  const p = pointerToView(ev);
  const cell = cellFromPoint(p.x, p.y);
  if (!cell) return;
  const { c, r } = cell;
  const world = S.game.world;
  const wc = cellAt(world, c, r);

  if (ev.button === 2) {
    S.selected = wc && wc.bId !== null ? G.buildingById(world, wc.bId) : null;
    renderPanel();
    return;
  }

  if (S.mode === 'sound') { doSound(c); return; }
  if (S.mode === 'prop') { doProp(c, r); return; }

  // clear mode: clicking already-cleared masonry selects the building
  if (wc && (wc.state === 'exposed-part' || wc.state === 'restored-part')) {
    S.selected = G.buildingById(world, wc.bId);
    A.sfx.click();
    renderPanel();
    return;
  }
  doClear(c, r);
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT') return;
  const k = ev.key.toLowerCase();
  if (k === 'escape') {
    const open = $$('.modal.open');
    if (open.length) { open.forEach((m) => m.classList.remove('open')); return; }
    S.selected = null; renderPanel(); return;
  }
  if (!$('#gameScreen').classList.contains('active')) return;
  if (k === 'q') setMode('clear');
  if (k === 'w') setMode('sound');
  if (k === 'e') setMode('prop');
  if (k === 'g') { prefs.grid = !prefs.grid; applyPrefs(); syncPrefUI(); savePrefs(); }
  if (k === 'r' && S.selected) { const btn = $('#actRestore'); if (btn && !btn.disabled) doRestore(S.selected); }
  if (k === 'f' && S.selected) { const btn = $('#actSalvage'); if (btn && !btn.disabled) doSalvage(S.selected); }
});

function setMode(m) {
  S.mode = m;
  $$('.tool[data-mode]').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
  A.sfx.tick();
}
$$('.tool[data-mode]').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function openModal(sel) { $(sel).classList.add('open'); A.sfx.click(); }
$$('[data-close]').forEach((b) => b.addEventListener('click', (e) => {
  e.target.closest('.modal').classList.remove('open');
}));
$$('.modal').forEach((m) => m.addEventListener('click', (e) => {
  if (e.target === m) m.classList.remove('open');
}));
$('#confirmYes').addEventListener('click', () => {
  $('#confirmModal').classList.remove('open');
  if (S.confirmAction) S.confirmAction();
  S.confirmAction = null;
});

$('#howtoBody').innerHTML = HOWTO_SECTIONS.map((s) => `<h4>${s.title}</h4><p>${s.body}</p>`).join('')
  + `<h4>Controls</h4><p><b>Q</b> clear · <b>W</b> sounding · <b>E</b> prop · <b>R</b> restore · <b>F</b> break up · right-click to inspect · <b>G</b> grid.</p>`;

// settings wiring
const bindRange = (id, key, label) => {
  $(id).addEventListener('input', (e) => {
    prefs[key] = +e.target.value;
    $(label).textContent = e.target.value;
    applyPrefs(); savePrefs();
  });
};
bindRange('#volMaster', 'master', '#volMasterV');
bindRange('#volSfx', 'sfx', '#volSfxV');
bindRange('#volAmb', 'amb', '#volAmbV');

const bindCheck = (id, key, after2) => {
  $(id).addEventListener('change', (e) => {
    prefs[key] = e.target.checked;
    applyPrefs(); savePrefs();
    if (after2) after2();
  });
};
bindCheck('#optMute', 'mute');
bindCheck('#optLantern', 'lantern');
bindCheck('#optGrain', 'grain');
bindCheck('#optRain', 'rain');
bindCheck('#optMotes', 'motes');
bindCheck('#optShake', 'shake');
bindCheck('#optReduced', 'reduced');
bindCheck('#optGrid', 'grid');
bindCheck('#optConfirm', 'confirmBreak');

$('#btnSettingsTitle').addEventListener('click', () => openModal('#settingsModal'));
$('#btnSettingsGame').addEventListener('click', () => openModal('#settingsModal'));
$('#btnHowto').addEventListener('click', () => openModal('#howtoModal'));
$('#btnHowtoGame').addEventListener('click', () => openModal('#howtoModal'));

// ---------------------------------------------------------------------------
// Title screen art
// ---------------------------------------------------------------------------
const titleCanvas = $('#titleCanvas');
const tctx = titleCanvas.getContext('2d');
let titleEarth = null;

function sizeTitle() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  titleCanvas.width = Math.floor(window.innerWidth * dpr);
  titleCanvas.height = Math.floor(window.innerHeight * dpr);
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', sizeTitle);

function drawTitle(t) {
  if (!titleEarth) return;
  const w = window.innerWidth, h = window.innerHeight;
  tctx.clearRect(0, 0, w, h);
  // cover-fit the baked cross-section
  const scale = Math.max(w / VIEW.W, h / (VIEW.H - VIEW.OY + 60));
  const dw = VIEW.W * scale, dh = VIEW.H * scale;
  const ox = (w - dw) / 2, oy = h - dh + VIEW.OY * scale * 0.4;
  tctx.save();
  tctx.globalAlpha = 0.95;
  tctx.drawImage(titleEarth, ox, oy, dw, dh);
  tctx.restore();

  // slow lamp sweeping the face
  const lx = w * (0.5 + 0.34 * Math.sin(t * 0.19));
  const ly = h * (0.62 + 0.1 * Math.sin(t * 0.13 + 1.4));
  tctx.save();
  tctx.globalCompositeOperation = 'soft-light';
  const gr = tctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.34);
  gr.addColorStop(0, 'rgba(255,214,150,0.95)');
  gr.addColorStop(1, 'rgba(255,180,110,0)');
  tctx.fillStyle = gr;
  tctx.fillRect(0, 0, w, h);
  tctx.restore();

  tctx.save();
  tctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 44; i++) {
    const px = (i * 137.5 + t * (8 + (i % 5) * 4)) % (w + 60) - 30;
    const py = (h * 0.35) + ((i * 91.7 - t * (6 + (i % 3) * 5)) % (h * 0.7));
    const d = Math.hypot(px - lx, py - ly);
    tctx.globalAlpha = 0.04 + Math.max(0, 1 - d / 340) * 0.3;
    tctx.fillStyle = '#ffe6bc';
    tctx.fillRect(px, py, 1.6, 1.6);
  }
  tctx.restore();
}

// ---------------------------------------------------------------------------
// Intro
// ---------------------------------------------------------------------------
let introTimers = [];
function playIntro(then) {
  const wrap = $('#introLines');
  wrap.innerHTML = INTRO_LINES.map((l) => `<p>${l}</p>`).join('');
  const ps = Array.from(wrap.children);
  introTimers.forEach(clearTimeout);
  introTimers = [];
  ps.forEach((p, i) => introTimers.push(setTimeout(() => p.classList.add('in'), 380 + i * 1450)));
  introTimers.push(setTimeout(() => $('#btnSkipIntro').classList.add('in'), 900));
  introTimers.push(setTimeout(then, 380 + ps.length * 1450 + 1400));
}
function stopIntro() { introTimers.forEach(clearTimeout); introTimers = []; }

// ---------------------------------------------------------------------------
// End screen
// ---------------------------------------------------------------------------
function showEnd() {
  const e = S.game.ended;
  if (!e) return;
  $('#endReason').textContent = e.reason === 'exhausted' ? 'The purse is empty' : 'You backfill the trench';
  $('#endGrade').textContent = e.grade.title;
  $('#endLine').textContent = e.grade.line;
  $('#endTotal').textContent = e.score.total;
  $('#endSaved').textContent = e.saved.length;
  $('#endBroken').textContent = e.broken.length;
  $('#endLost').textContent = e.lost.length;

  const li = (b, extra) => `<li><span>${b.name}</span><b>${extra}</b></li>`;
  $('#listSaved').innerHTML = e.saved.length
    ? e.saved.map((b) => li(b, `+${b.baseValue}`)).join('')
    : '<li><span class="muted">Nothing.</span></li>';
  $('#listBroken').innerHTML = e.broken.length
    ? e.broken.map((b) => li(b, `+${b.salvageValue}`)).join('')
    : '<li><span class="muted">Nothing.</span></li>';
  $('#listLost').innerHTML = e.lost.length
    ? e.lost.map((b) => li(b, '—')).join('')
    : '<li><span class="muted">Nothing came down.</span></li>';

  const untouched = e.untouched.length;
  $('#endFoot').textContent = untouched
    ? `${untouched} structure${untouched === 1 ? '' : 's'} in trench ${S.seed} you never found. They are still down there.`
    : `You found every last thing in trench ${S.seed}.`;
  show('endScreen');
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  tick(now);
}

let lastTick = 0;
function tick(now) {
  now = now || performance.now();
  if (!lastTick) lastTick = now;
  const dt = Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;
  S.t += dt;

  if ($('#titleScreen').classList.contains('active')) {
    drawTitle(S.t);
    return;
  }
  if (!$('#gameScreen').classList.contains('active')) return;
  if (!S.game) return;

  if (S.dirty) rebake();
  S.shake *= Math.pow(0.001, dt);

  draw(ctx, S.game, {
    t: S.t, dt, earth: S.earth, dug: S.dug, particles,
    hover: S.hover, selected: S.selected, lamp: S.lamp, shake: S.shake,
    hint: null,
  });
  drawStrataLabels(ctx);
}

// A hidden tab throttles rAF to nothing; the watchdog keeps state moving and
// re-renders when the panel is not compositing.
setInterval(() => {
  if (document.hidden) return;
  const now = performance.now();
  if (now - lastTick > 220) tick(now);
}, 250);

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
$('#btnBegin').addEventListener('click', () => {
  A.unlock(); A.startAmbience();
  newGame($('#seedInput').value.trim() || randomSeed());
  show('introScreen');
  playIntro(() => { stopIntro(); show('gameScreen'); });
});
$('#btnSkipIntro').addEventListener('click', () => { stopIntro(); show('gameScreen'); });
$('#btnReseed').addEventListener('click', () => { $('#seedInput').value = randomSeed(); A.sfx.click(); });
$('#btnEnd').addEventListener('click', () => { G.endRun(S.game, 'backfilled'); after({ ok: true }); });
$('#btnAgain').addEventListener('click', () => { newGame(randomSeed()); show('gameScreen'); });
$('#btnSameSeed').addEventListener('click', () => { newGame(S.seed); show('gameScreen'); });
$('#btnToTitle').addEventListener('click', () => { $('#seedInput').value = randomSeed(); show('titleScreen'); });

// ---------------------------------------------------------------------------
// Headless harness — MIDDEN.sim(n) for balance work
// ---------------------------------------------------------------------------
// A plausible-but-not-clairvoyant policy: keep a working float, break up the
// least promising find, restore the best one you can still afford, and sink a
// shaft rather than skimming the topsoil.
const RESERVE = 6;

function botStep(g) {
  const exposed = g.world.buildings.filter((b) => b.state === 'exposed');

  // 0. shore up anything standing that has just been undermined
  for (const b of g.world.buildings) {
    if (!b.undermined || b.state !== 'restored') continue;
    if (g.salvage < 3) break;
    const gap = G.footingCells(b).find(({ c, r }) => G.canProp(g, c, r).ok);
    if (gap) return G.prop(g, gap.c, gap.r);
  }

  // Rank what is out of the ground by how much it would be worth standing.
  const ranked = exposed
    .map((b) => ({ b, d: G.previewRestore(g, b).delta }))
    .sort((a, z) => z.d - a.d);
  const keeper = ranked[0] || null;

  // 1. restore the best find once it is affordable and a float still remains
  if (keeper && keeper.d >= 2 && g.salvage - keeper.b.restoreCost >= RESERVE) {
    return G.restore(g, keeper.b.id);
  }

  // 2. raise money for the thing we are saving for — breaking up the least
  //    promising find first, and never the keeper unless nothing else is left
  const needed = keeper ? keeper.b.restoreCost + RESERVE : 12;
  if (g.salvage < needed && ranked.length) {
    const spare = ranked.slice(1);
    if (spare.length) return G.salvage(g, spare[spare.length - 1].b.id);
    if (g.salvage < 5 || keeper.d < 2) return G.salvage(g, keeper.b.id);
  }

  // 3. probe ahead occasionally
  if (g.salvage > 18 && g.actions % 11 === 5) {
    const c = (g.actions * 7 + g.world.seed) % COLS;
    const res = G.sound(g, c);
    if (res.ok) return res;
  }

  // 4. dig — work outward from known masonry, cheap ground first
  let target = null, bestScore = -1e9;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const chk = G.canClear(g, c, r);
      if (!chk.ok) continue;
      const cell = cellAt(g.world, c, r);
      // Depth is where the buildings are. A policy that skims the topsoil
      // spends its whole purse on turf and finds nothing — sink a shaft.
      let sc = -chk.cost * 2.0 + r * 0.8;
      if (cell.bId !== null) {
        // finish the footprint you have already started, or you end the run
        // with a dozen buildings each one cell out of the ground
        const b = G.buildingById(g.world, cell.bId);
        sc += 14 + (b ? b.revealedCount * 9 : 0);
        // dig toward what is already standing — coherence only pays in clusters
        if (b) {
          for (const o of g.world.buildings) {
            if (o.state !== 'restored') continue;
            const near = Math.abs(o.c0 - b.c0) <= 2 && Math.abs(o.r0 - b.r0) <= 2;
            if (near) { sc += 7; break; }
          }
        }
      }
      if (cell.sounded && cell.bId !== null) sc += 5;
      for (const b of g.world.buildings) {
        if (r !== b.r0 + b.h || c < b.c0 || c >= b.c0 + b.w) continue;
        if (b.state === 'restored') sc -= 90;
        else if (b.state === 'exposed') sc -= 22;
      }
      if (sc > bestScore) { bestScore = sc; target = { c, r }; }
    }
  }
  if (target) return G.clearCell(g, target.c, target.r);
  if (exposed.length) return G.salvage(g, exposed[0].id);
  G.endRun(g, 'exhausted');
  return { ok: false, why: 'no moves' };
}

window.MIDDEN = {
  get state() { return S; },
  get game() { return S.game; },
  newGame,
  step: (n = 1) => { for (let i = 0; i < n; i++) { if (S.game.over) break; botStep(S.game); } S.dirty = true; renderReadouts(); renderPanel(); renderLog(); return summary(S.game); },
  // Headless: runs full games without touching the DOM.
  sim(runs = 21, seedPrefix = 'sim') {
    const out = [];
    for (let i = 0; i < runs; i++) {
      const g = G.createGame(`${seedPrefix}-${i}`);
      let guard = 0;
      while (!g.over && guard++ < 4000) { botStep(g); g.events.length = 0; }
      out.push(summary(g));
    }
    const avg = (k) => (out.reduce((s, x) => s + x[k], 0) / out.length).toFixed(1);
    return {
      runs: out.length,
      score: { avg: +avg('score'), min: Math.min(...out.map((x) => x.score)), max: Math.max(...out.map((x) => x.score)) },
      restored: +avg('restored'), salvaged: +avg('salvaged'), collapsed: +avg('collapsed'),
      actions: +avg('actions'), untouched: +avg('untouched'),
      endedExhausted: out.filter((x) => x.reason === 'exhausted').length,
      raw: out,
    };
  },
  coherence: () => G.coherence(S.game),
  // Force one frame. Needed when rAF is throttled (hidden tab, non-compositing
  // preview pane) and for capturing stills.
  render: () => { S.dirty = true; tick(performance.now()); return true; },
  G, VIEW, options,
};

function summary(g) {
  const sc = G.coherence(g);
  return {
    seed: g.world.seedStr,
    score: sc.total, base: sc.base, adj: sc.adj,
    restored: g.stats.restored, salvaged: g.stats.salvaged, collapsed: g.stats.collapsed,
    cleared: g.stats.cleared, actions: g.actions, salvage: g.salvage,
    untouched: g.world.buildings.filter((b) => b.state === 'buried').length,
    reason: g.ended ? g.ended.reason : 'running',
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
loadPrefs();
sizeTitle();
$('#seedInput').value = randomSeed();
newGame($('#seedInput').value);
titleEarth = bakeEarth(makeWorld('title-face'));
rebake();
show('titleScreen');
requestAnimationFrame(frame);

document.addEventListener('pointerdown', () => A.unlock(), { once: true });
