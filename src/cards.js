// Fate Cards (spec §4) and Special Cards (spec §6) — display data only.
// The rules for each option live in engine.js; `hint` is static metadata
// (expected throws / tiles) that bots and UI may use. It never decides outcomes.

export const FATE_CARDS = {
  avalanche: {
    n: 1, title: 'The Avalanche', art: '🏔️', flavor: 'The slope groans. Something has to give.',
    options: {
      a: { text: 'Feed 2 throws to the Storm Pot.', hint: { throws: -2 }, penalty: true },
      b: { text: 'A rival of your choice loses 1 throw (it feeds the Pot) — and you move back 2.', hint: { tiles: -2 }, target: 'pick', harm: true },
      c: { text: 'Move back 4.', hint: { tiles: -4 }, penalty: true },
    },
  },
  gambler: {
    n: 2, title: "The Gambler's Dice", art: '🎲', flavor: 'A stranger in a tent offers a wager.',
    options: {
      a: { text: 'Roll: 4–6 → +2 throws · 1–3 → −2 throws (lost throws feed the Pot).', hint: { throws: 0 }, risky: true },
      b: { text: 'Play safe — nothing happens.', hint: {} },
    },
  },
  alliance: {
    n: 3, title: 'The Alliance', art: '🤝', flavor: 'Two ropes are stronger than one.',
    options: {
      a: { text: 'Give 1 throw to another player — you both move +3 tiles.', hint: { throws: -1, tiles: 3 }, target: 'pick' },
      b: { text: 'Decline.', hint: {} },
    },
  },
  betrayal: {
    n: 4, title: 'The Betrayal', art: '🐍', flavor: 'A quiet word, a swapped rope.',
    options: {
      a: { text: 'Swap positions with a player within 10 tiles.', hint: { tiles: 0 }, target: 'pick', harm: true },
      b: { text: 'Move back 2.', hint: { tiles: -2 }, penalty: true },
    },
  },
  tollkeeper: {
    n: 5, title: 'The Tollkeeper', art: '🪙', flavor: '"Nobody climbs my pass for free."',
    options: {
      a: { text: 'Pay 1 throw (feeds the Pot) and stay.', hint: { throws: -1 }, penalty: true, cost: 1 },
      b: { text: 'Move back 5.', hint: { tiles: -5 }, penalty: true },
      c: { text: 'Pay 2 throws (feeds the Pot) and gain a Shield card.', hint: { throws: -2, card: 1 }, cost: 2 },
    },
  },
  bridge: {
    n: 6, title: 'The Collapsing Bridge', art: '🌉', flavor: 'The planks crack under your boots.',
    options: {
      a: { text: 'Spend 1 throw (feeds the Pot) to cross safely.', hint: { throws: -1 }, penalty: true, cost: 1 },
      b: { text: 'Fall back 4.', hint: { tiles: -4 }, penalty: true },
    },
  },
  frozenpass: {
    n: 7, title: 'The Frozen Pass', art: '🧊', flavor: 'Ice seals the path ahead.',
    options: {
      a: { text: 'Lose your next throw (it feeds the Pot when consumed).', hint: { throws: -1 }, penalty: true },
      b: { text: 'Move back 3 now and keep your throws.', hint: { tiles: -3 }, penalty: true },
    },
  },
  thief: {
    n: 8, title: 'The Thief', art: '🦹', flavor: 'An unattended pack. A quick hand.',
    options: {
      a: { text: 'Steal 1 throw from the nearest player ahead — the getaway costs you: move back 1.', hint: { throws: 1, tiles: -1 }, target: 'auto', harm: true },
      b: { text: 'Move back 2.', hint: { tiles: -2 }, penalty: true },
    },
  },
  treasure: {
    n: 9, title: 'The Treasure Chest', art: '🧰', flavor: 'Gold glints under the snow.',
    options: {
      a: { text: '+2 throws, but the chest is heavy: move back 4.', hint: { throws: 2, tiles: -4 } },
      b: { text: '+1 throw.', hint: { throws: 1 } },
    },
  },
  duel: {
    n: 10, title: 'The Duel', art: '⚔️', flavor: 'Only one rope fits this ledge.',
    options: {
      a: { text: 'Challenge a player within 8 tiles: both roll — winner +5 tiles, loser −3. Tie = nothing.', hint: { tiles: 1 }, target: 'pick', harm: true, risky: true },
      b: { text: 'Decline and move back 1.', hint: { tiles: -1 }, penalty: true },
    },
  },
  shortcut: {
    n: 11, title: 'The Shortcut', art: '🧗', flavor: 'A gully straight up. Loose rock.',
    options: {
      a: { text: 'Dash +8 tiles, then roll: 1–3 → tumble back 14.', hint: { tiles: 1 }, risky: true },
      b: { text: 'Stay put safely.', hint: {} },
    },
  },
  stormcall: {
    n: 12, title: 'The Storm Call', art: '🌩️', flavor: 'The sky answers those who call it.',
    options: {
      a: { text: 'Feed 2 throws to the Pot (counts double toward eruption).', hint: { throws: -2 }, cost: 2 },
      b: { text: '+1 throw for yourself.', hint: { throws: 1 } },
    },
  },
  swap: {
    n: 13, title: 'The Swap', art: '🔄', flavor: 'Your pack for theirs. No questions.',
    options: {
      a: { text: 'Exchange throw counts with any one player.', hint: { throws: 0 }, target: 'pick', harm: true },
      b: { text: 'Move back 3.', hint: { tiles: -3 }, penalty: true },
    },
  },
  guardian: {
    n: 14, title: 'The Guardian', art: '🦅', flavor: 'An eagle circles overhead, watching.',
    options: {
      a: { text: 'Gain a Shield card.', hint: { card: 1 } },
      b: { text: '+1 throw.', hint: { throws: 1 } },
    },
  },
  laststand: {
    n: 15, title: 'The Last Stand', art: '🔥', flavor: 'For those the mountain tried to bury.',
    protectedOnly: true,
    options: {
      a: { text: '+2 throws.', hint: { throws: 2 } },
      b: { text: '+6 tiles — but your next Fate draw comes from the harsh set.', hint: { tiles: 6 } },
    },
  },
};

/** The 14 cards in the regular deck (Last Stand is substituted in for the protected set). */
export const DECK = Object.keys(FATE_CARDS).filter((k) => !FATE_CARDS[k].protectedOnly);
/** "Harsh" cards: every option costs you something (design interpretation, see README). */
export const HARSH = ['avalanche', 'tollkeeper', 'bridge', 'frozenpass', 'thief'];

export const SPECIAL_CARDS = {
  shield: { icon: '🛡️', name: 'Shield', text: 'Auto-blocks the first blockable effect that hits you (Rockslide, Frostbite, steals, swaps, duel losses, Whiteout).', passive: true },
  double: { icon: '⚡', name: 'Double Move', text: 'Your next roll is doubled.' },
  magnet: { icon: '🧲', name: 'Magnet', text: 'Steal 1 throw from the nearest valid player ahead.' },
  boost: { icon: '🚀', name: 'Boost', text: 'Move +6 tiles now (destination does not resolve).' },
  ghost: { icon: '👻', name: 'Ghost', text: 'Immune to player-targeting for 24h.' },
  second: { icon: '🎲', name: 'Second Chance', text: 'Arms your next roll: the server rolls twice and keeps the better result.' },
};
export const SPECIAL_IDS = Object.keys(SPECIAL_CARDS);
