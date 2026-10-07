// Engine-only rules test & pacing simulation. Run: node tests/rules.test.js [seasons]
import { SummitEngine } from '../src/engine.js';
import { BOARD, T, countTiles, CAMPS, CONST, BOARD_LEN } from '../src/board.js';
import { makeBotRng } from '../src/bots.js';
import { simulateSeason } from '../src/season.js';

let pass = 0; let fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
const NAMES = ['Ada', 'Tunde', 'Kemi', 'Zara', 'Femi', 'Nia', 'Obi', 'Lola', 'Kofi', 'Ife'];

function squad(n, { pers = ['greedy', 'saboteur', 'cautious'], casual = 3 } = {}) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: NAMES[i], isBot: true, personality: pers[i % pers.length], casual: i >= n - casual }));
}
const floorFor = (maxTile) => CAMPS.filter((c) => c <= maxTile).pop() || 1;

console.log('\n§3 Board layout');
const counts = countTiles();
const expect = { fate: 36, supply: 16, rockslide: 16, frostbite: 14, shortcut: 11, thief: 11, shrine: 8, safe: 81, camp: 4, fork: 1, start: 1, summit: 1 };
check('board has 200 tiles', BOARD.length - 1 === 200);
for (const [k, v] of Object.entries(expect)) check(`${k} count = ${v}`, counts[k] === v, `(got ${counts[k]})`);
check('camps at 40/80/120/160', CAMPS.every((c) => BOARD[c] === T.CAMP));
check('fork at 65', BOARD[65] === T.FORK);
check('tiles 2–7 hazard-free', [2, 3, 4, 5, 6, 7].every((i) => ![T.ROCKSLIDE, T.FROSTBITE, T.THIEF].includes(BOARD[i])));
check('spot-check tiles 8,23,47,101,193,200', BOARD[8] === T.SHORTCUT && BOARD[23] === T.FROSTBITE && BOARD[47] === T.THIEF && BOARD[101] === T.THIEF && BOARD[193] === T.SHORTCUT && BOARD[200] === T.SUMMIT);

console.log('\nUnit rules');
{
  const e = SummitEngine.create({ seed: 7, players: squad(5) });
  const m = e.m('p0');
  check('start: 5 throws, 1 card, tile 1', m.throws === 5 && m.cards.length === 1 && m.tile === 1);
  // Rockslide floor
  m.tile = 123; m.maxTile = 123; e._begin(); e._resolveTile(m, 123, 1); e._end();
  check('Rockslide at 123 never drops below camp 120', m.tile >= 120, `(tile ${m.tile})`);
  // Frostbite at 0 throws → pending, next gain consumed into Pot
  m.cards = []; m.throws = 0; m.tile = 23; e._begin(); e._resolveTile(m, 23, 1); e._end();
  check('Frostbite at 0 throws sets frostbitePending', m.frostbitePending === true);
  const pot0 = e.state.season.potCount; e._begin(); e._gain(m, 1, 'test'); e._end();
  check('pending frostbite consumes next gained throw → Pot', m.throws === 0 && !m.frostbitePending && e.state.season.potCount === (pot0 + 1) % e.potThreshold() || e.state.season.eruptions.length > 0);
  // Frostbite with throws → next roll consumed
  m.throws = 3; m.frozenNext = 0; e._begin(); e._resolveTile(m, 25, 1); e._end();
  const t0 = m.tile; const r = e.requestRoll('p0');
  check('Frostbite: next throw consumed with no roll', r.frozen === true && m.tile === t0 && m.throws === 2);
  // Supply crate once
  m.throws = 2; e._begin(); e._resolveTile(m, 3, 1); e._resolveTile(m, 3, 1); e._end();
  check('Supply Crate +1 once per season per tile', m.throws === 3);
  // caps
  m.throws = 11; e._begin(); e._gain(m, 5, 'test'); e._end();
  check('hard cap 12', m.throws === 12);
  m.throws = 6; e._begin(); e._refresh(m, true); e._end();
  check('refresh soft cap 8 (6 → 8)', m.throws === 8);
  m.throws = 10; e._begin(); e._refresh(m, true); e._end();
  check('refresh never reduces a bank above 8', m.throws === 10);
  // Camp bonus once, reach-or-pass
  m.tile = 37; m.maxTile = 37; m.claimedRewards = []; m.throws = 2;
  e._begin(); e._moveForward(m, 5, 'roll'); e._end();
  check('passing camp 40 grants +1 and floor 40', m.throws === 3 && e.floorOf(m) === 40);
  m.tile = 38; e._begin(); e._moveForward(m, 5, 'roll'); e._end();
  check('re-passing camp gives floor, not bonus', m.throws === 3);
  // Fork reach-or-pass & route windows
  m.tile = 62; m.maxTile = 62; m.pending = null; m.throws = 5;
  e._begin(); const fr = e._moveForward(m, 5, 'roll'); e._end();
  check('passing 65 triggers Fork once', fr.fork === true);
  m.routeChoice = 'safe';
  check('Safe route: Rockslide 81 treated as Safe', e.effectiveType(m, 81) === T.SAFE && e.effectiveType(m, 72) === T.SAFE);
  check('Safe route: outside window unchanged (99 Rockslide)', e.effectiveType(m, 99) === T.ROCKSLIDE);
  m.routeChoice = 'risky';
  check('Risky route: Safe 68 becomes Fate; Rockslide 81 stays', e.effectiveType(m, 68) === T.FATE && e.effectiveType(m, 81) === T.ROCKSLIDE);
  // Pot threshold
  check('pot threshold max(8, 2×active): 5 players → 10', e.potThreshold() === 10);
}
{
  for (const [n, k] of [[5, 1], [6, 2], [8, 2], [10, 3]]) {
    const e = SummitEngine.create({ seed: 1, players: squad(n) });
    check(`protected set: ${n} players → ${k}`, e.protectedCount() === k);
  }
  const e = SummitEngine.create({ seed: 3, players: squad(8) });
  e.m('p1').dormant = true; e.m('p2').dormant = true; e.m('p3').dormant = true; e.m('p4').dormant = true;
  check('pot threshold floor 8 when 4 active', e.potThreshold() === 8);
}
{
  // Thief's Ledge with no valid target = Safe; protected players can't lose throws
  const e = SummitEngine.create({ seed: 11, players: squad(5) });
  const a = e.m('p0'); a.tile = 47;
  for (const o of e.all) if (o !== a) o.tile = 10;
  const before = a.throws; e._begin(); e._resolveTile(a, 47, 1); e._end();
  check("Thief's Ledge with nobody ahead is Safe", a.throws === before);
  const b = e.m('p1'); b.tile = 60; // p1 ahead, valid
  e._begin(); e._resolveTile(a, 47, 1); e._end();
  check("Thief's Ledge steals 1 from nearest valid ahead + 24h immunity", a.throws === before + 1 && e.isImmune(b));
  e._begin(); const t2 = e.stealTarget(a); e._end();
  check('immune target is skipped', t2 === null || t2.id !== 'p1');
}
{
  // Last Stand only for protected; card movement never resolves destination
  const e = SummitEngine.create({ seed: 21, players: squad(8) });
  const m = e.m('p0'); m.tile = 1; for (const o of e.all) if (o !== m) o.tile = 30;
  let saw = 0; for (let i = 0; i < 60; i++) { e._begin(); const c = e._nextCard(m); e._end(); if (c === 'laststand') saw++; }
  check('protected player can draw The Last Stand', saw > 0);
  const top = e.m('p1'); top.tile = 150; let sawTop = 0;
  for (let i = 0; i < 60; i++) { e._begin(); const c = e._nextCard(top); e._end(); if (c === 'laststand') sawTop++; }
  check('non-protected player never draws The Last Stand', sawTop === 0);
  const q = e.m('p2'); q.tile = 2; q.cards = ['boost']; q.pending = null; const thr = q.throws;
  e.playCard('p2', 'boost');
  check('Boost +6 lands on 8 (Shortcut) without resolving it', q.tile === 8 && q.throws === thr);
}
{
  // SP formula examples from §2
  const sp = (N, pos, tile) => ((N - pos + 1) * 10 + 120 * tile / BOARD_LEN) * (N / 10);
  check('SP: 10-player win = 220', Math.round(sp(10, 1, 200)) === 220);
  check('SP: 5-player win = 85', Math.round(sp(5, 1, 200)) === 85);
  // determinism
  const run = (seed) => { const e = SummitEngine.create({ seed, players: squad(8) }); simulateSeason(e, makeBotRng(seed)); return e.serialize(); };
  check('deterministic: same seed → identical season state', run(99) === run(99));
}

console.log('\nInvariant fuzz (engine-only full seasons)');
const SEASONS = +(process.argv[2] || 1000);
let violations = { floor: 0, throws: 0, tile: 0 }; let events = 0; let samples = [];
const stats = (pers) => {
  const first = []; const dailyFinish = []; let dailyN = 0; let dailySum = 0; let casualN = 0; let casualSum = 0; let erupt = 0; const eruptKinds = {};
  return { first, dailyFinish, add(e) {
    const s = e.state.season;
    if (s.firstSummitAt != null) first.push(Math.floor(s.firstSummitAt / 24) + 1);
    erupt += s.eruptions.length; for (const x of s.eruptions) eruptKinds[x.kind] = (eruptKinds[x.kind] || 0) + 1;
    for (const m of e.all) {
      const day = m.summitAt != null ? Math.floor(m.summitAt / 24) + 1 : null;
      if (m.casual) { casualN++; if (day != null) casualSum++; } else { dailyN++; if (day != null) dailySum++; dailyFinish.push(day ?? 99); }
    }
  }, report() {
    const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    return { seasons: first.length, firstSummitMedian: q(first, 0.5), p10: q(first, 0.1), p90: q(first, 0.9), medianDailyFinisher: q(dailyFinish, 0.5), dailySummitedPct: +(100 * dailySum / dailyN).toFixed(1), casualSummitedPct: +(100 * casualSum / casualN).toFixed(1), eruptionsPerSeason: +(erupt / first.length).toFixed(2), eruptKinds };
  } };
};

function runConfig(label, pers, n = SEASONS, rules = {}) {
  const st = stats();
  for (let i = 0; i < n; i++) {
    const seed = 1000 + i * 7919;
    const e = SummitEngine.create({ seed, players: squad(8, { pers }), rules });
    e.onEvent((ev, eng) => {
      events++;
      if (ev.type === 'move' && ev.involuntary) {
        const m = eng.m(ev.pid);
        if (ev.to < floorFor(m.maxTile)) { violations.floor++; if (samples.length < 5) samples.push(ev); }
      }
      if (ev.type === 'throws' || ev.type === 'refresh') {
        for (const m of eng.all) if (m.throws < 0 || m.throws > CONST.HARD_CAP || !Number.isInteger(m.throws)) violations.throws++;
      }
      if (ev.type === 'move' && (ev.to < 1 || ev.to > BOARD_LEN)) violations.tile++;
    });
    simulateSeason(e, makeBotRng(seed));
    st.add(e);
  }
  const r = st.report();
  console.log(`  [${label}]`, JSON.stringify(r));
  return r;
}
const t0 = Date.now();
const solo = runConfig('spec-comparable: 8 players (5 daily + 3 casual 70%), greedy choices, no player targeting', ['solo']);
const solo12 = runConfig('spec-comparable, measurement mode (no sprint cut-off: everyone climbs to day 12)', ['solo'], SEASONS, { finalSprint: false });
const mixed = runConfig('full prototype: 8 bots greedy/saboteur/cautious mix, targeting on', ['greedy', 'saboteur', 'cautious']);
console.log(`  (${events} events checked in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
check('no involuntary move ever went below the Base Camp floor', violations.floor === 0, JSON.stringify(samples));
check('throws always within 0..12 (integers)', violations.throws === 0, `(${violations.throws})`);
check('tiles always within 1..200', violations.tile === 0);
check('spec §2: median first summit ≈ day 8 (±1) in spec-comparable config', Math.abs(solo.firstSummitMedian - 8) <= 1, `(got ${solo.firstSummitMedian})`);
check('spec §2: median daily finisher ≈ day 10 (±1) when racing to day 12', Math.abs(solo12.medianDailyFinisher - 10) <= 1, `(got ${solo12.medianDailyFinisher})`);
check('every season ends (sprint or day 12)', solo.seasons === SEASONS && mixed.seasons <= SEASONS);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(JSON.stringify({ pacing: { specComparable: solo, specComparableNoSprintCutoff: solo12, mixed }, spec: { firstSummitMedian: 8, p10p90: '7–9', medianDailyFinisher: 10, dailySummitedBy12: 95, casualSummitedBy12: 60, eruptionsPerSeason8p: '~2' } }, null, 1));
process.exit(fail ? 1 : 0);
