// Summit Dash — board data & tuning constants (spec v1.2 §2, §3).
// Pure data. No DOM, no randomness. Shared by engine, UI and tests.

export const BOARD_SEED = 20260929; // seed the spec's layout was generated from (§3)
export const BOARD_LEN = 200;

// Tile type codes
export const T = Object.freeze({
  START: 'start', SAFE: 'safe', FATE: 'fate', SUPPLY: 'supply', ROCKSLIDE: 'rockslide',
  FROSTBITE: 'frostbite', SHORTCUT: 'shortcut', THIEF: 'thief', SHRINE: 'shrine',
  CAMP: 'camp', FORK: 'fork', SUMMIT: 'summit',
});

const CODE = { A: T.START, S: T.SAFE, F: T.FATE, C: T.SUPPLY, R: T.ROCKSLIDE, B: T.FROSTBITE,
  X: T.SHORTCUT, T: T.THIEF, H: T.SHRINE, K: T.CAMP, O: T.FORK, Z: T.SUMMIT };

// Transcribed tile-by-tile from spec §3 (v1.2 seeded layout). Each row = 10 tiles.
// A=Start S=Safe F=Fate C=Supply Crate R=Rockslide B=Frostbite X=Shortcut T=Thief's Ledge
// H=Shield Shrine K=Base Camp O=Route Fork Z=Summit
const ROWS = [
  // Foothills (1–40)
  'ASCSSFSXSS', //   1–10
  'CRHSCSSSSS', //  11–20
  'SSBFBXSSFC', //  21–30
  'SSSFSCSHFK', //  31–40
  // Ascent (41–80)
  'FSHSSCTFSF', //  41–50
  'RSSFFSSRXC', //  51–60
  'XSRSOFBSSS', //  61–70
  'SBFTCHBSSK', //  71–80
  // The Crux (81–120)
  'RSBSSFXRSB', //  81–90
  'BFSTSSSCRS', //  91–100
  'TFCFTFSSBC', // 101–110
  'BFFSFXRRSK', // 111–120
  // High Ridge (121–160)
  'TSRFXSFXFT', // 121–130
  'SRFSSSSXSH', // 131–140
  'BBHSSSSFSF', // 141–150
  'CSFCSCSRFK', // 151–160
  // Death Zone (161–200)
  'RBSFCFSFSS', // 161–170
  'XHSFCTSSTR', // 171–180
  'RRFSBSSSFF', // 181–190
  'FSXTTSSHSZ', // 191–200
];

/** BOARD[i] = tile type of tile i (1-indexed; BOARD[0] unused = null). */
export const BOARD = [null, ...ROWS.join('').split('').map((c) => CODE[c])];

export const CAMPS = [40, 80, 120, 160];
export const FORK_TILE = 65;
export const FORK_WINDOW = [66, 90];
export const RISKY_JUMP = 6;

export const ZONES = [
  { id: 'foothills', name: 'Foothills', from: 1, to: 40, mood: 'gentle' },
  { id: 'ascent', name: 'Ascent', from: 41, to: 80, mood: 'warming up' },
  { id: 'crux', name: 'The Crux', from: 81, to: 120, mood: 'hazard-dense' },
  { id: 'ridge', name: 'High Ridge', from: 121, to: 160, mood: 'exposed' },
  { id: 'death', name: 'Death Zone', from: 161, to: 200, mood: 'thin air' },
];
export const zoneOf = (tile) => ZONES.find((z) => tile >= z.from && tile <= z.to) || ZONES[0];

export const TILE_INFO = {
  [T.START]: { icon: '🚩', name: 'Start', color: '#f4f1ea', text: 'The trailhead.' },
  [T.SAFE]: { icon: '🟢', name: 'Safe', color: '#7fbf6a', text: 'Nothing happens — breathing room.' },
  [T.FATE]: { icon: '🟣', name: 'Fate Card', color: '#8b5cf6', text: 'Draw a Fate Card.' },
  [T.SUPPLY]: { icon: '🎁', name: 'Supply Crate', color: '#f5b941', text: '+1 throw (once per season per crate).' },
  [T.ROCKSLIDE]: { icon: '🪨', name: 'Rockslide', color: '#9a6b4f', text: 'Slide back 3–5 tiles (camp floor applies).' },
  [T.FROSTBITE]: { icon: '❄️', name: 'Frostbite', color: '#6cc6f0', text: 'Your next throw is consumed — it feeds the Pot.' },
  [T.SHORTCUT]: { icon: '🪢', name: 'Shortcut', color: '#2fb5a4', text: 'Jump forward 4–8 tiles.' },
  [T.THIEF]: { icon: '🗡️', name: "Thief's Ledge", color: '#e0565b', text: 'Steal 1 throw from the nearest valid player ahead.' },
  [T.SHRINE]: { icon: '🛡️', name: 'Shield Shrine', color: '#4f8ef7', text: 'Gain a Shield card.' },
  [T.CAMP]: { icon: '⛺', name: 'Base Camp', color: '#ff8a3d', text: 'Checkpoint. Fall floor. +1 throw first time.' },
  [T.FORK]: { icon: '🔀', name: 'Route Fork', color: '#ffd166', text: 'Choose Safe or Risky route.' },
  [T.SUMMIT]: { icon: '🏆', name: 'Summit', color: '#ffe08a', text: 'Finish!' },
};

export const CONST = Object.freeze({
  THROWS_PER_DAY: 5,
  SOFT_CAP: 8,
  HARD_CAP: 12,
  MAX_DAYS: 12,
  SPRINT_HOURS: 24,
  POT_THRESHOLD_MULTIPLIER: 2,
  POT_THRESHOLD_MIN: 8,
  IMMUNITY_HOURS: 24,
  MAX_INCOMING_24H: 2,
  HAND_MAX: 3,
  DORMANT_AFTER_DAYS: 2,
  CHAIN_MAX_DEPTH: 2,
  MIN_HOURS_BETWEEN_REFRESH: 20,
  ERUPTION_WEIGHTS: { sunbreak: 40, whiteout: 35, windfall: 25 },
});

export function countTiles(board = BOARD) {
  const c = {};
  for (let i = 1; i < board.length; i++) c[board[i]] = (c[board[i]] || 0) + 1;
  return c;
}
