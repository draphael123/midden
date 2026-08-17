// MIDDEN — content tables: strata, building catalogue, affinities, copy.
// Everything here is data. No logic beyond lookups.

export const COLS = 16;
export const ROWS = 11;      // row 10 is bedrock
export const BEDROCK_ROW = 10;

// ---------------------------------------------------------------------------
// Strata. Rows are inclusive. Index 0 is turfline (no structures).
// ---------------------------------------------------------------------------
export const STRATA = [
  {
    key: 'turf',
    index: 0,
    name: 'The Turfline',
    sub: 'this season',
    blurb: 'Root-matted spoil. Nothing sleeps this shallow.',
    rows: [0, 1],
    palette: {
      base: '#5c5638', mid: '#6b6440', dark: '#403c27', light: '#7e7650',
      speck: '#8f8757', root: '#3b3524',
    },
    glow: null,
  },
  {
    key: 'near',
    index: 1,
    name: 'The Near Years',
    sub: 'your grandmother’s people',
    blurb: 'Brick you recognise. Doorsteps worn by feet you could name.',
    rows: [2, 4],
    palette: {
      base: '#7d5b3c', mid: '#8d6944', dark: '#5a4029', light: '#a07c53',
      speck: '#c09a6a', root: '#4a3320',
    },
    glow: null,
  },
  {
    key: 'reed',
    index: 2,
    name: 'The Reed-Folk',
    sub: 'before the vale was drained',
    blurb: 'Wattle, ash and river silt. They built low and they built wet.',
    rows: [5, 7],
    palette: {
      base: '#4e5744', mid: '#5b6650', dark: '#353d2f', light: '#6d7a5e',
      speck: '#8b9678', root: '#2c3327',
    },
    glow: null,
  },
  {
    key: 'under',
    index: 3,
    name: 'The Under-Builders',
    sub: 'no one’s grandmother',
    blurb: 'Pale stone, set true, in courses no mason here was taught.',
    rows: [8, 9],
    palette: {
      base: '#3a4550', mid: '#44505c', dark: '#252d36', light: '#55636f',
      speck: '#7fa4a6', root: '#1d242b',
    },
    glow: '#7fd6cf',
  },
];

export const BEDROCK_PALETTE = {
  base: '#23262b', mid: '#2b2f35', dark: '#15171a', light: '#373c44',
  speck: '#4a5058', root: '#101215',
};

export function strataForRow(row) {
  if (row >= BEDROCK_ROW) return null;
  for (const s of STRATA) if (row >= s.rows[0] && row <= s.rows[1]) return s;
  return STRATA[0];
}

// ---------------------------------------------------------------------------
// Tags. Coherence is scored between the tags of adjacent restored buildings.
// ---------------------------------------------------------------------------
export const TAGS = {
  DWELL:  { key: 'DWELL',  label: 'Dwelling', glyph: '⌂', color: '#e0a35c' },
  CRAFT:  { key: 'CRAFT',  label: 'Craft',    glyph: '⚒', color: '#c98a5a' },
  SACRED: { key: 'SACRED', label: 'Sacred',   glyph: '†', color: '#c9b26a' },
  CIVIC:  { key: 'CIVIC',  label: 'Civic',    glyph: '⚖', color: '#8fa8c4' },
  WATER:  { key: 'WATER',  label: 'Water',    glyph: '≈', color: '#6fb0c4' },
  DEAD:   { key: 'DEAD',   label: 'Dead',     glyph: '⚱', color: '#9b8ba8' },
};

// Symmetric affinity table. Key is the two tags sorted and joined.
const AFFINITY_RAW = {
  'DWELL|DWELL': 2,
  'CRAFT|DWELL': 1,
  'DWELL|WATER': 3,
  'DEAD|DWELL': -2,
  'CIVIC|DWELL': 2,
  'DWELL|SACRED': 1,
  'CRAFT|CRAFT': 1,
  'CRAFT|SACRED': -1,
  'CRAFT|WATER': 2,
  'CIVIC|CRAFT': 1,
  'CRAFT|DEAD': -1,
  'SACRED|SACRED': 2,
  'DEAD|SACRED': 3,
  'CIVIC|SACRED': 1,
  'SACRED|WATER': 1,
  'CIVIC|CIVIC': -1,
  'CIVIC|WATER': 1,
  'CIVIC|DEAD': -1,
  'WATER|WATER': 0,
  'DEAD|WATER': -2,
  'DEAD|DEAD': 2,
};

export function affinity(a, b) {
  const key = [a, b].sort().join('|');
  return AFFINITY_RAW[key] ?? 0;
}

export function affinityNote(a, b) {
  const v = affinity(a, b);
  const key = [a, b].sort().join('|');
  return AFFINITY_NOTES[key] || (v > 0 ? 'They sit well together.' : v < 0 ? 'They should not touch.' : 'Neither helps nor harms.');
}

const AFFINITY_NOTES = {
  'DWELL|DWELL': 'A row of houses is a street.',
  'DWELL|WATER': 'Every house wants a well within earshot.',
  'DEAD|DWELL': 'No one sleeps beside the dead by choice.',
  'CIVIC|DWELL': 'People gather where they are governed.',
  'CRAFT|WATER': 'Craft follows water. It always has.',
  'DEAD|SACRED': 'The dead were laid where prayer was loudest.',
  'CIVIC|CIVIC': 'Two seats of authority quarrel.',
  'DEAD|WATER': 'The dead sour a spring.',
  'CRAFT|SACRED': 'Hammering drowns out the liturgy.',
  'DEAD|DEAD': 'A burial ground wants to be whole.',
  'SACRED|SACRED': 'Faith compounds.',
};

// ---------------------------------------------------------------------------
// Building catalogue, keyed by stratum.
// w/h are footprint in cells. weight is generation frequency.
// ---------------------------------------------------------------------------
export const CATALOGUE = {
  near: [
    { key: 'cottage',   name: 'Cottage',            w: 2, h: 1, tags: ['DWELL'],           weight: 5, desc: 'Two rooms and a chimney breast. Somebody’s whole life.' },
    { key: 'bakehouse', name: 'Bakehouse',          w: 2, h: 1, tags: ['CRAFT', 'DWELL'],  weight: 2, desc: 'The oven brick is still scorched black at the mouth.' },
    { key: 'well',      name: 'The Well',           w: 1, h: 1, tags: ['WATER'],           weight: 3, desc: 'Rope-grooves worn a thumb deep into the coping stone.' },
    { key: 'chapel',    name: 'Chapel of Saint Ada',w: 2, h: 2, tags: ['SACRED'],          weight: 2, desc: 'A plaster saint with her face rubbed smooth by hands.' },
    { key: 'byre',      name: 'Byre',               w: 2, h: 1, tags: ['CRAFT'],           weight: 3, desc: 'Cattle stalls, the floor still sloped for drainage.' },
    { key: 'school',    name: 'Schoolhouse',        w: 2, h: 1, tags: ['CIVIC'],           weight: 2, desc: 'Slate fragments. One has a half-finished alphabet.' },
    { key: 'graverow',  name: 'Grave-row',          w: 2, h: 1, tags: ['DEAD'],            weight: 2, desc: 'Eleven stones in a line. Four of them are children.' },
    { key: 'cistern',   name: 'Cistern',            w: 1, h: 2, tags: ['WATER'],           weight: 2, desc: 'Lead-lined and still holding a hand’s depth of rain.' },
    { key: 'smithy',    name: 'Smithy',             w: 1, h: 1, tags: ['CRAFT'],           weight: 3, desc: 'Clinker, scale, and the ghost of an anvil footprint.' },
    { key: 'toll',      name: 'Toll House',         w: 1, h: 1, tags: ['CIVIC'],           weight: 2, desc: 'A ledger box, empty, its lock forced long ago.' },
  ],
  reed: [
    { key: 'longhouse', name: 'Longhouse',          w: 3, h: 1, tags: ['DWELL'],           weight: 4, desc: 'One roof, many hearths. They did not live apart.' },
    { key: 'kiln',      name: 'Reed Kiln',          w: 1, h: 2, tags: ['CRAFT'],           weight: 3, desc: 'Fired from below. The flue still smells of ash.' },
    { key: 'weir',      name: 'Weir-gate',          w: 2, h: 1, tags: ['WATER'],           weight: 3, desc: 'Oak posts, black and hard as iron from the wet.' },
    { key: 'bonehouse', name: 'Bone House',         w: 2, h: 1, tags: ['DEAD', 'SACRED'],  weight: 2, desc: 'Long bones stacked as neatly as firewood.' },
    { key: 'mootring',  name: 'Moot Ring',          w: 2, h: 2, tags: ['CIVIC'],           weight: 2, desc: 'A ring of seat-stones. Arguments were had here.' },
    { key: 'rack',      name: 'Drying Rack',        w: 2, h: 1, tags: ['CRAFT'],           weight: 3, desc: 'Fish, once. The frame has outlasted every fish.' },
    { key: 'sunkenhut', name: 'Sunken Hut',         w: 1, h: 1, tags: ['DWELL'],           weight: 4, desc: 'Dug down for warmth. A step, a floor, a hearth-ring.' },
    { key: 'springhs',  name: 'Spring House',       w: 1, h: 1, tags: ['WATER'],           weight: 3, desc: 'Built over the water so the water would stay.' },
    { key: 'post',      name: 'Ancestor Post',      w: 1, h: 1, tags: ['SACRED'],          weight: 3, desc: 'Carved with faces. All of them looking down.' },
  ],
  under: [
    { key: 'vault',     name: 'The Vault',          w: 2, h: 2, tags: ['SACRED'],          weight: 3, desc: 'The joints take no mortar. They do not need it.' },
    { key: 'conduit',   name: 'Conduit',            w: 3, h: 1, tags: ['WATER'],           weight: 3, desc: 'Still running. You can hear it before you reach it.' },
    { key: 'effigy',    name: 'Effigy Hall',        w: 2, h: 2, tags: ['SACRED', 'CIVIC'], weight: 2, desc: 'Figures in the round, all of them mid-stride, all facing out.' },
    { key: 'coldcell',  name: 'Cold Cell',          w: 1, h: 1, tags: ['DEAD'],            weight: 3, desc: 'Empty. Scrupulously, deliberately empty.' },
    { key: 'sink',      name: 'The Sink',           w: 1, h: 2, tags: ['WATER'],           weight: 3, desc: 'A shaft going down past where your lamp reaches.' },
    { key: 'pillar',    name: 'Pillar Court',       w: 2, h: 2, tags: ['CIVIC'],           weight: 2, desc: 'Nine pillars holding up nothing at all.' },
    { key: 'reliquary', name: 'Reliquary',          w: 1, h: 1, tags: ['SACRED', 'DEAD'],  weight: 2, desc: 'Sealed. You have decided not to wonder what is inside.' },
    { key: 'hollowway', name: 'Hollow Way',         w: 3, h: 1, tags: ['CIVIC'],           weight: 2, desc: 'A road, roofed over, going somewhere that is no longer there.' },
  ],
};

// ---------------------------------------------------------------------------
// Condition. Rolled per building at generation.
// ---------------------------------------------------------------------------
export const CONDITIONS = {
  intact: { key: 'intact', label: 'Intact',   costMul: 1.00, yieldMul: 1.00, valueMul: 1.00, weight: 3, note: 'Sound enough to stand on its own.' },
  worn:   { key: 'worn',   label: 'Worn',     costMul: 1.35, yieldMul: 0.80, valueMul: 0.80, weight: 4, note: 'Slumped, but the bones are true.' },
  ruined: { key: 'ruined', label: 'Ruined',   costMul: 1.80, yieldMul: 0.55, valueMul: 0.55, weight: 3, note: 'More idea of a building than a building.' },
};

// ---------------------------------------------------------------------------
// Economy constants.
// ---------------------------------------------------------------------------
// Tuned so that a shaft pays for itself and *deeper pays better*: the older
// the stone, the more it is worth broken up AND standing. Without that the
// whole fantasy inverts and there is never a reason to go down.
export const ECONOMY = {
  startingSalvage: 40,
  digCost: (row) => 1 + Math.floor(row / 5),      // 1×5 then 2×5
  soundingCost: 2,
  soundingDepth: 5,
  propCost: 3,
  restoreCost: (b) => Math.round((b.cells.length * 5 + b.stratumIndex * 3) * CONDITIONS[b.condition].costMul),
  salvageYield: (b) => Math.round((b.cells.length * (3 + b.stratumIndex)) * CONDITIONS[b.condition].yieldMul),
  // Base value is deliberately modest: a building standing alone is worth
  // little. What it is standing *next to* is the game.
  baseValue: (b) => Math.round((b.cells.length + b.stratumIndex * 2) * CONDITIONS[b.condition].valueMul),
  crossStratumMultiplier: 2,
  // Loose worked stone, lead, sherds — scattered through every stratum, worth
  // more the older it is. Without this a shaft is pure outgoing and a player
  // who guesses wrong is simply stranded with an empty purse.
  spoilFindChance: 0.22,
  spoilFindValue: (stratumIndex) => 2 + stratumIndex,
};

// ---------------------------------------------------------------------------
// Copy.
// ---------------------------------------------------------------------------
export const INTRO_LINES = [
  'The vale flooded in your grandmother’s time, and the mud took the village whole.',
  'The Antiquary’s Board will pay for what you can bring back up — but not for the digging.',
  'Everything you raise, you pay for by pulling something else apart.',
  'Earth holds itself. Walls do not.',
  'Cut the ground out from under what you have saved, and you will hear it come down.',
];

export const HOWTO_SECTIONS = [
  {
    title: 'Reading the face',
    body: 'You cannot see through soil. But the open face of the trench leaks: a hairline of masonry, a stain where the ground settled. Any buried cell touching an open cell shows a trace. A sounding drives a thin shaft and returns silhouettes — shape and depth, never identity.',
  },
  {
    title: 'The closed purse',
    body: 'Salvage is the only currency and there is no source of it but the dig itself. Clearing earth costs salvage. Restoring costs salvage. The only way to earn it is to break something up. You will not save everything. You are not meant to.',
  },
  {
    title: 'Working the trench',
    body: 'You can only clear ground that touches ground you have already opened. A building you have brushed out is a room — you can work through it. A building you have <em>restored</em> is whole again, and seals the ground beneath it against your own spade. That is the one protection restoring buys you. Skim the topsoil and you will spend the whole purse on turf; sink a shaft.',
  },
  {
    title: 'Load',
    body: 'Earth is cohesive; it holds its own weight. Masonry does not. A building stands only while every cell directly beneath it is solid — earth, bedrock, a prop, or another building. Open that ground and the building is undermined. It groans for one action, then it falls, and what falls leaves a void that undermines whatever sat on top of it.',
  },
  {
    title: 'Coherence',
    body: 'A restored building is scored by the company it keeps. Houses want a well; the dead want a chapel; two seats of government quarrel. Buildings touching across a stratum boundary — your grandmother’s chapel resting on an Under-Builder vault — score double, for good or for ill.',
  },
];

// Calibrated against 25 headless runs of an unclustered policy (median 25,
// p75 34). Deliberate cluster play should clear 45 comfortably.
export const EPILOGUE_GRADES = [
  { min: 70, title: 'The Board is astonished', line: 'They will send a draughtsman. They will put your trench in a book.' },
  { min: 45, title: 'A creditable dig',        line: 'Enough stands to walk between. That is more than most manage.' },
  { min: 25, title: 'A partial recovery',      line: 'Fragments, honestly won. The vale gives up nothing easily.' },
  { min: 10, title: 'Little to show',          line: 'You are returning less than the Board hoped, and you know it.' },
  { min: -999, title: 'The trench defeated you', line: 'You have made a hole in a field. The mud will have it back by spring.' },
];
