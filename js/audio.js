// MIDDEN — procedural audio. No asset files; everything is synthesised.

let ctx = null;
let master = null, sfxBus = null, ambBus = null;
let noiseBuf = null;
let ambientNodes = null;
let started = false;

export const settings = {
  master: 0.8,
  sfx: 0.9,
  ambience: 0.55,
  muted: false,
};

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = settings.muted ? 0 : settings.master;
  master.connect(ctx.destination);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = settings.sfx;
  sfxBus.connect(master);

  ambBus = ctx.createGain();
  ambBus.gain.value = 0;               // faded in when ambience starts
  ambBus.connect(master);

  // 2s of white noise, reused everywhere
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  return ctx;
}

export function unlock() {
  ensure();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function applySettings() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, 0.05);
  sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.05);
  if (ambientNodes) ambBus.gain.setTargetAtTime(settings.ambience, t, 0.4);
}

// --- primitives -------------------------------------------------------------
function noise(dur, { gain = 0.3, type = 'lowpass', freq = 1200, q = 0.7, sweepTo = null, delay = 0 } = {}) {
  if (!ensure()) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
  if (sweepTo !== null) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(sfxBus);
  src.start(t); src.stop(t + dur + 0.05);
}

function tone(freq, dur, { gain = 0.2, type = 'sine', delay = 0, glideTo = null, detune = 0 } = {}) {
  if (!ensure()) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type; osc.frequency.setValueAtTime(freq, t); osc.detune.value = detune;
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(sfxBus);
  osc.start(t); osc.stop(t + dur + 0.05);
}

// --- named sounds -----------------------------------------------------------
export const sfx = {
  dig() {
    noise(0.16, { gain: 0.28, freq: 900, sweepTo: 260, q: 1.1 });
    tone(70 + Math.random() * 20, 0.14, { gain: 0.18, type: 'triangle', glideTo: 42 });
  },
  digStone() {
    noise(0.09, { gain: 0.22, type: 'bandpass', freq: 2600, q: 2.2 });
    noise(0.2, { gain: 0.2, freq: 700, sweepTo: 220 });
    tone(180, 0.1, { gain: 0.12, type: 'square', glideTo: 110 });
  },
  find() {
    tone(880, 0.22, { gain: 0.14, type: 'sine' });
    tone(1320, 0.3, { gain: 0.08, type: 'sine', delay: 0.05 });
  },
  reveal() {
    tone(523.25, 0.5, { gain: 0.1, type: 'sine' });
    tone(659.25, 0.55, { gain: 0.08, type: 'sine', delay: 0.06 });
    tone(783.99, 0.7, { gain: 0.06, type: 'sine', delay: 0.12 });
  },
  restore() {
    [261.63, 329.63, 392.0, 523.25].forEach((f, i) => tone(f, 1.1 - i * 0.12, { gain: 0.11, type: 'triangle', delay: i * 0.07 }));
    noise(0.6, { gain: 0.05, freq: 500 });
  },
  salvage() {
    noise(0.5, { gain: 0.3, freq: 1400, sweepTo: 180, q: 0.8 });
    tone(120, 0.35, { gain: 0.14, type: 'sawtooth', glideTo: 55 });
    noise(0.18, { gain: 0.16, type: 'bandpass', freq: 2000, q: 1.4, delay: 0.22 });
  },
  sounding() {
    tone(1650, 0.1, { gain: 0.1, type: 'square' });
    tone(1240, 0.16, { gain: 0.07, type: 'square', delay: 0.11 });
    tone(930, 0.3, { gain: 0.05, type: 'sine', delay: 0.24 });
  },
  prop() {
    tone(150, 0.1, { gain: 0.16, type: 'square', glideTo: 90 });
    noise(0.12, { gain: 0.14, freq: 800, sweepTo: 300 });
    tone(150, 0.09, { gain: 0.12, type: 'square', glideTo: 90, delay: 0.13 });
  },
  groan() {
    tone(58, 1.6, { gain: 0.16, type: 'sawtooth', glideTo: 44 });
    noise(1.4, { gain: 0.1, freq: 320, sweepTo: 120, q: 1.6 });
    tone(87, 1.3, { gain: 0.07, type: 'triangle', glideTo: 66, delay: 0.2 });
  },
  collapse() {
    noise(1.9, { gain: 0.45, freq: 2200, sweepTo: 90, q: 0.6 });
    tone(90, 1.2, { gain: 0.3, type: 'sawtooth', glideTo: 28 });
    tone(46, 2.0, { gain: 0.22, type: 'sine', glideTo: 20, delay: 0.05 });
    for (let i = 0; i < 7; i++) {
      noise(0.12, { gain: 0.14, type: 'bandpass', freq: 400 + Math.random() * 2200, q: 2, delay: 0.1 + Math.random() * 1.2 });
    }
  },
  deny() {
    tone(160, 0.1, { gain: 0.1, type: 'square', glideTo: 120 });
  },
  tick() { tone(1200, 0.03, { gain: 0.035, type: 'square' }); },
  click() {
    tone(640, 0.05, { gain: 0.08, type: 'triangle' });
    noise(0.05, { gain: 0.05, type: 'highpass', freq: 2200 });
  },
  end() {
    [196.0, 233.08, 293.66].forEach((f, i) => tone(f, 2.4 - i * 0.2, { gain: 0.1, type: 'sine', delay: i * 0.18 }));
  },
};

// --- ambience ---------------------------------------------------------------
// A wind bed, a slow rain hiss, and occasional far-off drips from the trench.
export function startAmbience() {
  if (!ensure() || started) return;
  started = true;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;

  const wind = ctx.createBiquadFilter();
  wind.type = 'bandpass'; wind.frequency.value = 340; wind.Q.value = 0.55;

  const windGain = ctx.createGain();
  windGain.gain.value = 0.5;

  // slow LFO on the wind's cutoff so it breathes
  const lfo = ctx.createOscillator();
  lfo.type = 'sine'; lfo.frequency.value = 0.045;
  const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 190;
  lfo.connect(lfoAmt).connect(wind.frequency);

  const lfo2 = ctx.createOscillator();
  lfo2.type = 'sine'; lfo2.frequency.value = 0.017;
  const lfo2Amt = ctx.createGain(); lfo2Amt.gain.value = 0.28;
  lfo2.connect(lfo2Amt).connect(windGain.gain);

  const sub = ctx.createOscillator();
  sub.type = 'sine'; sub.frequency.value = 41;
  const subGain = ctx.createGain(); subGain.gain.value = 0.05;

  src.connect(wind).connect(windGain).connect(ambBus);
  sub.connect(subGain).connect(ambBus);

  src.start(); lfo.start(); lfo2.start(); sub.start();
  ambientNodes = { src, lfo, lfo2, sub };
  ambBus.gain.setTargetAtTime(settings.ambience, ctx.currentTime, 2.5);

  scheduleDrip();
}

function scheduleDrip() {
  if (!ctx) return;
  const wait = 4000 + Math.random() * 11000;
  setTimeout(() => {
    if (!ctx || settings.muted) { scheduleDrip(); return; }
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = 900 + Math.random() * 700;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045 * settings.ambience, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(g).connect(ambBus);
    osc.start(t); osc.stop(t + 0.35);
    scheduleDrip();
  }, wait);
}
