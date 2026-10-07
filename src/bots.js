// Bot rivals — these are *clients*. They only call the public engine API
// (requestRoll / chooseFate / chooseFork / playCard) exactly like the human UI does.
// Their own decision randomness uses a separate seeded stream so it never touches
// the authoritative game RNG.

import { seedRng, rngFloat, rngPick } from './rng.js';

export const PERSONALITIES = {
  greedy: { label: 'Greedy', blurb: 'Grabs throws and tiles, takes the Risky Route.' },
  saboteur: { label: 'Saboteur', blurb: 'Loves steals, swaps and betrayals.' },
  cautious: { label: 'Cautious', blurb: 'Avoids risk, hoards Shields, Safe Route.' },
};

const TILE_PER_THROW = 3.5;

function scoreOption(eng, me, card, o, personality) {
  let v = (o.hint.throws || 0) * TILE_PER_THROW + (o.hint.tiles || 0) + (o.hint.card ? 2 : 0);
  if (card === 'gambler' && o.id === 'a') v = 0; // EV 0, variance
  if (card === 'shortcut' && o.id === 'a') v = 1;
  if (card === 'duel' && o.id === 'a') v = 1;
  if (card === 'swap' && o.id === 'a') {
    const best = Math.max(...o.targets.map((id) => eng.m(id).throws));
    v = (best - me.throws) * TILE_PER_THROW;
  }
  if (card === 'betrayal' && o.id === 'a') {
    const best = Math.max(...o.targets.map((id) => eng.m(id).tile));
    v = best - me.tile;
  }
  if (card === 'stormcall' && o.id === 'a') v = -7 + (eng.state.season.potCount + 4 >= eng.potThreshold() ? 4 : 0);
  if (personality === 'saboteur' && o.harm) v += 4;
  if (personality === 'cautious') { if (o.risky) v -= 3; if (o.harm) v -= 1; if (o.hint.card) v += 2; }
  if (personality === 'greedy' && o.risky) v += 0.5;
  if (personality === 'solo' && o.harm) v -= 100; // test-only: greedy but never targets anyone (spec §2 sim setup)
  return v;
}

function pickTarget(eng, me, card, o, personality, rng) {
  const ts = o.targets.map((id) => eng.m(id));
  if (!ts.length) return null;
  if (card === 'swap') return ts.sort((a, b) => b.throws - a.throws)[0].id;
  if (card === 'betrayal') return ts.sort((a, b) => b.tile - a.tile)[0].id;
  if (card === 'duel') return ts.sort((a, b) => a.tile - b.tile)[0].id; // pick someone behind (smaller loss of face)
  if (card === 'alliance') return ts.sort((a, b) => b.tile - a.tile)[ts.length - 1].id;
  if (card === 'avalanche') { // hit the leader
    return eng.ranking(ts)[0].id;
  }
  return rngPick(rng, ts).id;
}

export function decideFate(eng, pid, rng) {
  const me = eng.m(pid);
  const card = me.pending.card;
  const opts = eng.fateOptions(me, card).filter((o) => o.enabled);
  const pers = me.personality || 'greedy';
  let best = null; let bestV = -Infinity;
  for (const o of opts) {
    const v = scoreOption(eng, me, card, o, pers) + rngFloat(rng) * 0.3;
    if (v > bestV) { bestV = v; best = o; }
  }
  const target = best.target === 'pick' ? pickTarget(eng, me, card, best, pers, rng) : null;
  return { option: best.id, target };
}

export function decideFork(eng, pid) {
  const p = eng.m(pid).personality;
  return p === 'cautious' ? 'safe' : 'risky';
}

/** Run one bot "session": resolve pendings, maybe play cards, roll until out of throws. */
export function botTurn(eng, pid, rngState, { maxRolls = 20 } = {}) {
  const events = [];
  const push = (r) => { if (r && r.events) events.push(...r.events); return r; };
  const me = () => eng.m(pid);
  let guard = 0;
  const resolvePending = () => {
    let k = 0;
    while (me().pending && k++ < 6 && !eng.state.season.over) {
      const p = me().pending;
      if (p.type === 'fork') push(eng.chooseFork(pid, decideFork(eng, pid)));
      else { const d = decideFate(eng, pid, rngState); push(eng.chooseFate(pid, d.option, d.target)); }
    }
  };
  resolvePending();
  while (!eng.state.season.over && me().throws > 0 && me().summitAt == null && guard++ < maxRolls) {
    const m = me();
    const pers = m.personality || 'greedy';
    // special cards
    for (const c of m.cards.slice()) {
      if (c === 'boost' && (pers !== 'cautious' || rngFloat(rngState) < 0.5)) push(eng.playCard(pid, 'boost'));
      else if (c === 'magnet' && pers !== 'solo' && eng.stealTarget(m)) push(eng.playCard(pid, 'magnet'));
      else if (c === 'double' && !m.armed.double && rngFloat(rngState) < 0.6) push(eng.playCard(pid, 'double'));
      else if (c === 'second' && !m.armed.second && rngFloat(rngState) < 0.5) push(eng.playCard(pid, 'second'));
      else if (c === 'ghost' && eng.ranking()[0].id === pid && !eng.isImmune(m)) push(eng.playCard(pid, 'ghost'));
      resolvePending();
    }
    if (me().throws <= 0 || me().summitAt != null) break;
    const r = push(eng.requestRoll(pid));
    if (!r.ok) break;
    resolvePending();
  }
  resolvePending();
  return events;
}

export function makeBotRng(seed) { return seedRng((seed ^ 0x5bd1e995) >>> 0); }
