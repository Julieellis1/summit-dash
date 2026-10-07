// Summit Dash — authoritative rules engine (spec v1.2).
//
// Pure & deterministic: no DOM, no Date.now(), no Math.random(). All state lives in a
// single JSON-serialisable object (`engine.state`) and all randomness comes from the
// seeded RNG stored inside that state. The UI and bots are *clients*: they call the
// request methods below (requestRoll, chooseFate, chooseFork, playCard, …) and only
// render the returned events. This module is designed to be dropped into a Firebase
// Cloud Function / Supabase Edge Function unchanged (see ARCHITECTURE.md).

import { BOARD, BOARD_LEN, T, CAMPS, FORK_TILE, FORK_WINDOW, RISKY_JUMP, CONST, TILE_INFO } from './board.js';
import { seedRng, rngInt, rngFloat, rngPick, rngShuffle, rngWeighted } from './rng.js';
import { FATE_CARDS, DECK, HARSH, SPECIAL_IDS, SPECIAL_CARDS } from './cards.js';

export const ENGINE_VERSION = '1.2.0-proto';
const H24 = 24;

const err = (code, message) => ({ ok: false, error: code, message, events: [] });

export class SummitEngine {
  /** Create a new season. players: [{id, name, isBot?, personality?, color?, casual?}] */
  static create({ seed = 1, players, squadId = 'squad-1', seasonId = 1, startDay = 1, rules = {} } = {}) {
    if (!players || players.length < 1) throw new Error('players required');
    const rng = seedRng(seed);
    const state = {
      version: ENGINE_VERSION,
      seed,
      rng,
      boardLen: BOARD_LEN,
      // finalSprint:false is a measurement-only switch for pacing tests (spec §2 reports per-player summit rates to day 12)
      rules: { finalSprint: true, ...rules },
      squad: { id: squadId, cosmetics: [] },
      season: {
        id: seasonId, day: startDay, clock: (startDay - 1) * H24, potCount: 0,
        potThreshold: CONST.POT_THRESHOLD_MIN, potCycle: {}, eruptions: [],
        firstSummitAt: null, firstSummitBy: null, sprintEndsAt: null,
        over: false, endReason: null, endedAt: null, results: null, recap: null,
        lastRefreshAt: {}, feedSeq: 0, rollSeq: 0,
      },
      order: players.map((p) => p.id),
      users: {},
      members: {},
      feed: [],
      rollLog: [],
    };
    for (const p of players) {
      state.users[p.id] = { timezone: p.timezone || 'Africa/Lagos', tzChangedAt: null };
      state.members[p.id] = {
        id: p.id, name: p.name, isBot: !!p.isBot, personality: p.personality || null,
        casual: !!p.casual, color: p.color || null,
        tile: 1, maxTile: 1, throws: 0, cards: [],
        immunityUntil: -1, ghostUntil: -1, incoming: [],
        dormant: false, dormantDays: 0, lastRollDay: startDay - 1, streak: 0,
        frostbitePending: false, frozenNext: 0,
        claimedRewards: [], routeChoice: null, shieldMode: 'auto',
        fateDeck: { order: rngShuffle(rng, DECK), idx: 0, lastStandReplaces: rngPick(rng, HARSH), harshNext: false },
        pending: null, armed: { double: false, second: false },
        summitAt: null, lastArriveAt: 0,
        stats: { rolls: [0, 0, 0, 0, 0, 0, 0], potFed: 0, betrayals: 0, targetedBy: 0, best: null, wasted: 0, shieldsUsed: 0, rankHistory: [] },
      };
    }
    const eng = new SummitEngine(state);
    eng._begin();
    eng._feed('season', null, null, `Season ${seasonId} begins. ${players.length} climbers at the trailhead. ROLL. RISK. SABOTAGE. SURVIVE.`, '🚩');
    for (const id of state.order) {
      const m = state.members[id];
      eng._refresh(m, true);
      eng._addCard(m, rngPick(state.rng, SPECIAL_IDS), 'season start');
    }
    eng._recordRanks();
    eng._end();
    return eng;
  }

  constructor(state) { this.state = state; this.ev = null; this.depth = 0; this.listeners = []; }
  static load(json) { return new SummitEngine(typeof json === 'string' ? JSON.parse(json) : json); }
  serialize() { return JSON.stringify(this.state); }
  /** Debug/test hook: fn(event) for every event emitted. */
  onEvent(fn) { this.listeners.push(fn); }

  // ───────────────────────────── helpers ─────────────────────────────
  get s() { return this.state; }
  get now() { return this.state.season.clock; }
  m(id) { return this.state.members[id]; }
  get all() { return this.state.order.map((id) => this.state.members[id]); }
  // Re-entrant event buffer: nested requests (e.g. auto-resolve during the day job) share one list.
  _begin() { if (this.depth++ === 0) this.ev = []; }
  _end(extra = {}) { const events = this.ev || []; if (--this.depth <= 0) { this.depth = 0; this.ev = null; } return { ok: true, events, ...extra }; }
  _emit(e) {
    const ev = { ...e, at: this.now };
    if (this.ev) this.ev.push(ev);
    for (const fn of this.listeners) fn(ev, this);
  }
  _tick(dt = 0.02) { this.s.season.clock = +(this.s.season.clock + dt).toFixed(4); }
  _feed(kind, a, b, text, icon = '•', extra = {}) {
    const s = this.s;
    const entry = { id: ++s.season.feedSeq, t: this.now, day: s.season.day, kind, a, b, text, icon, reactions: {}, ...extra };
    s.feed.push(entry);
    if (s.feed.length > 400) s.feed.splice(0, s.feed.length - 400);
    this._emit({ type: 'feed', entry });
    return entry;
  }
  _rollD6(m, why) {
    const v = rngInt(this.s.rng, 1, 6);
    const s = this.s;
    s.rollLog.push({ seq: ++s.season.rollSeq, t: this.now, day: s.season.day, pid: m.id, v, why });
    if (s.rollLog.length > 4000) s.rollLog.splice(0, s.rollLog.length - 4000);
    m.stats.rolls[v]++;
    return v;
  }
  floorOf(m) { let f = 1; for (const c of CAMPS) if (m.maxTile >= c) f = c; return f; }
  isActive(m) { return !m.dormant; }
  activeMembers() { return this.all.filter((m) => !m.dormant); }
  isImmune(m) { return this.now < m.immunityUntil; }
  incoming24(m) { return m.incoming.filter((t) => this.now - t < H24).length; }

  /** Ranking order (best first): tile → earlier summit → throws banked → fewest dormant days. */
  ranking(list = this.all) {
    return list.slice().sort((x, y) =>
      (y.tile - x.tile) ||
      ((x.summitAt ?? Infinity) - (y.summitAt ?? Infinity)) ||
      (y.throws - x.throws) ||
      (x.dormantDays - y.dormantDays) ||
      (this.s.order.indexOf(x.id) - this.s.order.indexOf(y.id)));
  }
  protectedCount() {
    const n = this.activeMembers().length;
    return n === 0 ? 0 : Math.max(1, Math.floor(0.25 * n + 0.5));
  }
  protectedSet() {
    const act = this.ranking(this.activeMembers());
    const k = this.protectedCount();
    return new Set(act.slice(act.length - k).map((m) => m.id));
  }
  isProtected(m) { return this.protectedSet().has(m.id); }
  potThreshold() {
    return Math.max(CONST.POT_THRESHOLD_MIN, CONST.POT_THRESHOLD_MULTIPLIER * this.activeMembers().length);
  }
  sprintOver() { const e = this.s.season.sprintEndsAt; return e != null && this.now >= e; }

  /** §7 valid target. opts.throwLoss → also skip protected & players with 0 throws. */
  validTarget(actor, t, opts = {}) {
    if (!t || t.id === actor.id) return false;
    if (t.dormant || actor.dormant) return false;
    if (t.summitAt != null) return false; // finished climbers are out of the race
    if (this.isImmune(t)) return false;
    if (this.incoming24(t) >= CONST.MAX_INCOMING_24H) return false;
    if (opts.throwLoss) {
      if (this.isProtected(t)) return false;
      if (t.throws < 1) return false;
    }
    return true;
  }
  /** Nearest valid player strictly ahead (ties at a tile → most recent arrival). */
  stealTarget(actor) {
    const c = this.all.filter((t) => t.tile > actor.tile && this.validTarget(actor, t, { throwLoss: true }));
    c.sort((a, b) => (a.tile - b.tile) || (b.lastArriveAt - a.lastArriveAt));
    return c[0] || null;
  }

  // ───────────────────────────── throws / pot ─────────────────────────────
  /** Bonus gain (hard cap 12). Handles frostbitePending. Returns throws actually added. */
  _gain(m, n, reason, { soft = false } = {}) {
    if (n <= 0) return 0;
    if (m.frostbitePending) {
      m.frostbitePending = false;
      n -= 1;
      this._emit({ type: 'frostbite-consume', pid: m.id, pending: true });
      this._feed('frostbite', m.id, null, `{a}'s frostbite claimed a fresh throw ❄️ (+1 to the Pot)`, '❄️');
      this._feedPot(m, 1, 1, 'frostbite');
    }
    const cap = soft ? CONST.SOFT_CAP : CONST.HARD_CAP;
    const before = m.throws;
    m.throws = Math.max(before, Math.min(cap, before + n));
    const got = m.throws - before;
    if (got || n) this._emit({ type: 'throws', pid: m.id, delta: got, lost: n - got, reason, throws: m.throws });
    return got;
  }
  /** Remove up to n throws (never below 0). toPot → feeds Storm Pot. Returns removed. */
  _lose(m, n, reason, { toPot = false, potMult = 1 } = {}) {
    const k = Math.max(0, Math.min(n, m.throws));
    m.throws -= k;
    this._emit({ type: 'throws', pid: m.id, delta: -k, reason, throws: m.throws });
    if (toPot && k > 0) this._feedPot(m, k, potMult, reason);
    return k;
  }
  _feedPot(m, n, mult, reason) {
    const s = this.s.season;
    s.potCount += n * mult;
    if (m) {
      s.potCycle[m.id] = (s.potCycle[m.id] || 0) + n;
      m.stats.potFed += n;
    }
    s.potThreshold = this.potThreshold();
    this._emit({ type: 'pot', delta: n * mult, by: m?.id, reason, count: s.potCount, threshold: s.potThreshold });
    this._checkEruption();
  }
  _checkEruption() {
    const s = this.s.season;
    s.potThreshold = this.potThreshold();
    if (s.potCount < s.potThreshold || s.over) return;
    s.potCount -= s.potThreshold; // overflow carries over
    this._erupt();
    s.potThreshold = this.potThreshold();
  }
  _erupt() {
    const s = this.s.season;
    const kind = rngWeighted(this.s.rng, CONST.ERUPTION_WEIGHTS);
    const rec = { kind, t: this.now, day: s.day, affected: [] };
    const racers = this.all.filter((m) => m.summitAt == null);
    if (kind === 'sunbreak') {
      this._feed('eruption', null, null, 'The Storm Pot erupted — ☀️ Sunbreak! Everyone +1 throw.', '☀️', { eruption: kind });
      this._emit({ type: 'eruption', kind });
      for (const m of racers) this._gain(m, 1, 'sunbreak');
    } else if (kind === 'whiteout') {
      this._feed('eruption', null, null, 'The Storm Pot erupted — 🌩️ Whiteout! Everyone slides back 2.', '🌩️', { eruption: kind });
      this._emit({ type: 'eruption', kind });
      for (const m of racers) {
        if (this._tryShield(m, 'Whiteout', false)) continue;
        this._moveBack(m, 2, { voluntary: false, kind: 'whiteout' });
      }
    } else {
      const entries = Object.entries(s.potCycle).filter(([, v]) => v > 0);
      let winner = null;
      if (entries.length) {
        const max = Math.max(...entries.map(([, v]) => v));
        const tied = entries.filter(([, v]) => v === max).map(([id]) => this.m(id)).filter((m) => m.summitAt == null);
        // tie-break: the tied contributor furthest behind wins
        winner = tied.length ? this.ranking(tied).slice(-1)[0] : null;
      }
      this._feed('eruption', winner?.id ?? null, null, winner ? `The Storm Pot erupted — 🌈 Windfall! {a} (top contributor) gets +3 throws.` : 'The Storm Pot erupted — 🌈 Windfall! (no eligible contributor)', '🌈', { eruption: kind });
      this._emit({ type: 'eruption', kind, winner: winner?.id ?? null });
      if (winner) this._gain(winner, 3, 'windfall');
      rec.winner = winner?.id ?? null;
    }
    s.eruptions.push(rec);
    s.potCycle = {};
  }

  /** Shield auto-consume. fromPlayer → effect inflicted by another player. */
  _tryShield(m, what, fromPlayer) {
    const i = m.cards.indexOf('shield');
    if (i < 0) return false;
    if (m.shieldMode === 'players' && !fromPlayer) return false;
    m.cards.splice(i, 1);
    m.stats.shieldsUsed++;
    this._emit({ type: 'shield', pid: m.id, blocked: what });
    this._feed('shield', m.id, null, `🛡️ {a}'s Shield blocked ${what}!`, '🛡️');
    return true;
  }
  _addCard(m, card, source) {
    if (m.cards.length >= CONST.HAND_MAX) {
      this._emit({ type: 'card-lost', pid: m.id, card, source });
      return false;
    }
    m.cards.push(card);
    this._emit({ type: 'card-gain', pid: m.id, card, source });
    return true;
  }
  _markTargeted(target, actor) {
    target.incoming.push(this.now);
    target.incoming = target.incoming.filter((t) => this.now - t < H24);
    target.immunityUntil = Math.max(target.immunityUntil, this.now + CONST.IMMUNITY_HOURS);
    target.stats.targetedBy++;
    actor.stats.betrayals++;
  }

  // ───────────────────────────── movement ─────────────────────────────
  /** Forward movement with reach-or-pass checks. Returns {from,to,fork,summit}. */
  _moveForward(m, n, kind) {
    const from = m.tile;
    const to = Math.min(BOARD_LEN, from + n);
    let fork = false;
    m.tile = to;
    m.lastArriveAt = this.now;
    this._emit({ type: 'move', pid: m.id, from, to, kind, involuntary: false });
    for (const c of CAMPS) {
      if (from < c && to >= c) {
        const key = `camp${c}`;
        if (!m.claimedRewards.includes(key)) {
          m.claimedRewards.push(key);
          this._emit({ type: 'camp', pid: m.id, camp: c });
          this._feed('camp', m.id, null, `{a} reached Base Camp ${c} ⛺ (+1 throw)`, '⛺');
          this._gain(m, 1, `camp ${c}`);
        }
      }
    }
    if (to > m.maxTile) m.maxTile = to;
    if (!m.claimedRewards.includes('fork') && from < FORK_TILE && to >= FORK_TILE) {
      m.claimedRewards.push('fork');
      fork = true;
    }
    let summit = false;
    if (to >= BOARD_LEN && m.summitAt == null) { summit = true; this._summit(m); }
    return { from, to, fork, summit };
  }
  _moveBack(m, n, { voluntary, kind }) {
    const from = m.tile;
    const floor = voluntary ? 1 : this.floorOf(m);
    const to = Math.max(floor, 1, from - n);
    m.tile = to;
    if (to !== from) m.lastArriveAt = this.now;
    this._emit({ type: 'move', pid: m.id, from, to, kind, involuntary: !voluntary, floor, floored: !voluntary && from - n < floor });
    return { from, to };
  }
  _summit(m) {
    const s = this.s.season;
    m.summitAt = this.now;
    m.tile = BOARD_LEN;
    m.pending = null;
    this._emit({ type: 'summit', pid: m.id, first: s.firstSummitAt == null });
    if (s.firstSummitAt == null) {
      s.firstSummitAt = this.now;
      s.firstSummitBy = m.id;
      s.sprintEndsAt = this.state.rules?.finalSprint === false ? null : this.now + CONST.SPRINT_HOURS;
      this._feed('summit', m.id, null, `🏆 {a} reached the SUMMIT! The 24h final sprint begins — everyone else, climb!`, '🏆');
      if (s.sprintEndsAt != null) this._emit({ type: 'sprint', endsAt: s.sprintEndsAt });
    } else {
      this._feed('summit', m.id, null, `🏆 {a} reached the summit!`, '🏆');
    }
  }
  /** After card movement (never resolves destination) — a Fork pass still prompts. */
  _afterCardMove(m, res) {
    if (res.fork && m.summitAt == null && !m.pending) {
      m.pending = { type: 'fork', landing: m.tile, depth: 1, resolve: false };
      this._emit({ type: 'pending', pid: m.id, pending: 'fork' });
    }
  }

  effectiveType(m, tile) {
    const t = BOARD[tile];
    if (tile >= FORK_WINDOW[0] && tile <= FORK_WINDOW[1]) {
      if (m.routeChoice === 'safe' && (t === T.ROCKSLIDE || t === T.FROSTBITE || t === T.THIEF)) return T.SAFE;
      if (m.routeChoice === 'risky' && t === T.SAFE) return T.FATE;
    }
    if (t === T.FORK && m.claimedRewards.includes('fork')) return T.SAFE;
    return t;
  }

  /** Resolve a landed tile at chain depth `depth` (§8). */
  _resolveTile(m, tile, depth) {
    if (m.summitAt != null) return;
    if (depth > CONST.CHAIN_MAX_DEPTH) {
      this._emit({ type: 'tile', pid: m.id, tile, tileType: BOARD[tile], effect: 'chain-limit' });
      return;
    }
    const type = this.effectiveType(m, tile);
    const base = { type: 'tile', pid: m.id, tile, tileType: type, depth, printed: BOARD[tile] };
    switch (type) {
      case T.FATE: {
        this._emit({ ...base, effect: 'fate' });
        this._drawFate(m, false);
        return;
      }
      case T.SUPPLY: {
        const key = `crate${tile}`;
        if (m.claimedRewards.includes(key)) { this._emit({ ...base, effect: 'looted' }); return; }
        m.claimedRewards.push(key);
        this._emit({ ...base, effect: 'supply' });
        this._gain(m, 1, 'supply crate');
        this._feed('supply', m.id, null, `{a} cracked open a Supply Crate 🎁 (+1 throw)`, '🎁');
        return;
      }
      case T.ROCKSLIDE: {
        const n = rngInt(this.s.rng, 3, 5);
        this._emit({ ...base, effect: 'rockslide', amount: n });
        if (this._tryShield(m, 'a Rockslide', false)) return;
        const r = this._moveBack(m, n, { voluntary: false, kind: 'rockslide' });
        this._feed('rockslide', m.id, null, `🪨 Rockslide! {a} slid back ${r.from - r.to} tile${r.from - r.to === 1 ? '' : 's'}${r.from - n < this.floorOf(m) ? ' (caught by Base Camp ' + this.floorOf(m) + ')' : ''}`, '🪨');
        if (r.to !== r.from) this._resolveTile(m, r.to, depth + 1);
        return;
      }
      case T.FROSTBITE: {
        this._emit({ ...base, effect: 'frostbite' });
        if (this._tryShield(m, 'Frostbite', false)) return;
        if (m.throws === 0) m.frostbitePending = true; else m.frozenNext += 1;
        this._feed('frostbite', m.id, null, `❄️ {a} got frostbite — next throw is frozen`, '❄️');
        return;
      }
      case T.SHORTCUT: {
        const n = rngInt(this.s.rng, 4, 8);
        this._emit({ ...base, effect: 'shortcut', amount: n });
        const r = this._moveForward(m, n, 'shortcut');
        this._feed('shortcut', m.id, null, `🪢 {a} found a Shortcut and jumped ${r.to - r.from} tiles!`, '🪢');
        if (r.summit) return;
        if (r.fork) { m.pending = { type: 'fork', landing: r.to, depth: depth + 1, resolve: true }; this._emit({ type: 'pending', pid: m.id, pending: 'fork' }); return; }
        this._resolveTile(m, r.to, depth + 1);
        return;
      }
      case T.THIEF: {
        const target = this.stealTarget(m);
        if (!target) { this._emit({ ...base, effect: 'thief-none' }); return; }
        this._emit({ ...base, effect: 'thief', target: target.id });
        this._steal(m, target, "Thief's Ledge");
        return;
      }
      case T.SHRINE: {
        this._emit({ ...base, effect: 'shrine' });
        if (this._addCard(m, 'shield', 'Shield Shrine')) this._feed('shrine', m.id, null, `{a} prayed at a Shield Shrine 🛡️`, '🛡️');
        return;
      }
      default:
        this._emit({ ...base, effect: 'none' });
    }
  }
  _steal(m, target, via) {
    this._markTargeted(target, m);
    if (this._tryShield(target, `${m.name}'s steal`, true)) return false;
    const k = this._lose(target, 1, `stolen by ${m.name}`);
    if (k) this._gain(m, 1, `stole (${via})`);
    this._emit({ type: 'steal', pid: m.id, target: target.id, via });
    this._feed('steal', m.id, target.id, `🗡️ {a} stole a throw from {b}! (${via})`, '🗡️');
    return true;
  }

  // ───────────────────────────── Fate Cards ─────────────────────────────
  _nextCard(m) {
    const d = m.fateDeck;
    if (d.harshNext) { d.harshNext = false; return rngPick(this.s.rng, HARSH); }
    if (d.idx >= d.order.length) { d.order = rngShuffle(this.s.rng, DECK); d.idx = 0; }
    let card = d.order[d.idx++];
    if (card === d.lastStandReplaces && this.isProtected(m)) card = 'laststand';
    return card;
  }
  _drawFate(m, isRedraw) {
    const card = this._nextCard(m);
    const options = this.fateOptions(m, card);
    const targetBlocked = options.some((o) => o.target && !o.enabled && o.reason === 'No valid target');
    const remaining = options.filter((o) => o.enabled);
    if (!isRedraw && targetBlocked && remaining.length && remaining.every((o) => o.penalty)) {
      this._emit({ type: 'fate-discard', pid: m.id, card });
      this._feed('fate', m.id, null, `{a} drew ${FATE_CARDS[card].title} — no valid targets, redrawn`, '🟣');
      return this._drawFate(m, true);
    }
    m.pending = { type: 'fate', card, redrawn: isRedraw };
    this._emit({ type: 'fate', pid: m.id, card, redrawn: isRedraw });
    this._feed('fate', m.id, null, `{a} drew ${FATE_CARDS[card].art} ${FATE_CARDS[card].title}`, '🟣');
  }

  /** Option availability for a card, from member m's perspective (greyed-out rules, §4/§7). */
  fateOptions(m, card) {
    const def = FATE_CARDS[card];
    const others = this.all.filter((t) => t.id !== m.id);
    const out = [];
    for (const [id, o] of Object.entries(def.options)) {
      const opt = { id, text: o.text, enabled: true, reason: null, target: o.target || null, targets: [], penalty: !!o.penalty, harm: !!o.harm, risky: !!o.risky, hint: o.hint };
      const need = (n) => { if (m.throws < n) { opt.enabled = false; opt.reason = `Needs ${n} throw${n > 1 ? 's' : ''}`; } };
      const key = `${card}.${id}`;
      switch (key) {
        case 'avalanche.a': need(2); break;
        case 'avalanche.b': opt.targets = others.filter((t) => this.validTarget(m, t, { throwLoss: true })).map((t) => t.id); break;
        case 'alliance.a': need(1); opt.targets = others.filter((t) => this.validTarget(m, t)).map((t) => t.id); break;
        case 'betrayal.a': opt.targets = others.filter((t) => this.validTarget(m, t) && Math.abs(t.tile - m.tile) <= 10 && t.tile !== m.tile && m.tile >= this.floorOf(t)).map((t) => t.id); break;
        case 'tollkeeper.a': need(1); break;
        case 'tollkeeper.c': need(2); break;
        case 'bridge.a': need(1); break;
        case 'thief.a': { const t = this.stealTarget(m); opt.targets = t ? [t.id] : []; break; }
        case 'duel.a': opt.targets = others.filter((t) => this.validTarget(m, t) && Math.abs(t.tile - m.tile) <= 8).map((t) => t.id); break;
        case 'stormcall.a': need(2); break;
        case 'swap.a': opt.targets = others.filter((t) => this.validTarget(m, t) && t.throws !== m.throws && !(t.throws > m.throws && this.isProtected(t))).map((t) => t.id); break;
        default: break;
      }
      if (opt.target && opt.enabled && opt.targets.length === 0) { opt.enabled = false; opt.reason = 'No valid target'; }
      out.push(opt);
    }
    return out;
  }

  // ───────────────────────────── public requests (the "server API") ─────────────────────────────
  _guardActor(pid) {
    const s = this.s.season;
    if (s.over) return err('season_over', 'The season is over.');
    const m = this.m(pid);
    if (!m) return err('no_member', 'Unknown player.');
    if (this.sprintOver()) { this._begin(); this._endSeason('sprint'); this._end(); return err('season_over', 'The final sprint has ended.'); }
    return null;
  }

  /** POST /roll — server-authoritative roll (spec §13 roll flow). */
  requestRoll(pid) {
    const g = this._guardActor(pid); if (g) return g;
    const m = this.m(pid);
    if (m.summitAt != null) return err('summited', 'You already summited.');
    if (m.pending) return err('pending', `Resolve your ${m.pending.type} first.`);
    if (m.throws <= 0) return err('no_throws', 'No throws left — they refresh at local midnight.');
    this._begin();
    this._tick();
    m.throws -= 1;
    this._emit({ type: 'throws', pid, delta: -1, reason: 'roll', throws: m.throws });
    this._markRolled(m);
    if (m.frozenNext > 0) {
      m.frozenNext -= 1;
      this._emit({ type: 'frozen', pid });
      this._feed('frostbite', pid, null, `❄️ {a}'s throw froze solid (+1 to the Pot)`, '❄️');
      this._feedPot(m, 1, 1, 'frostbite');
      return this._end({ frozen: true });
    }
    const rolls = [this._rollD6(m, 'move')];
    let value = rolls[0];
    let second = false; let doubled = false;
    if (m.armed.second) { m.armed.second = false; second = true; rolls.push(this._rollD6(m, 'second-chance')); value = Math.max(...rolls); }
    let move = value;
    if (m.armed.double) { m.armed.double = false; doubled = true; move = value * 2; }
    this._emit({ type: 'roll', pid, value, rolls, move, doubled, second });
    const startTile = m.tile;
    const res = this._moveForward(m, move, 'roll');
    if (!res.summit) {
      if (res.fork) {
        m.pending = { type: 'fork', landing: res.to, depth: 1, resolve: true };
        this._emit({ type: 'pending', pid, pending: 'fork' });
      } else {
        this._resolveTile(m, res.to, 1);
      }
    }
    const gained = m.tile - startTile;
    if (!m.pending) this._rollFeed(m, value, move, gained, doubled, second);
    else m._rollCtx = { value, move, startTile, doubled, second };
    this._trackBest(m, value, gained);
    return this._end({ value, move, rolls });
  }
  _rollFeed(m, value, move, gained, doubled, second) {
    const tag = doubled ? ' ⚡doubled' : second ? ' 🎲second chance' : '';
    let text;
    if (gained > move) text = `{a} rolled a ${value}${tag} and jumped ${gained} tiles!`;
    else if (gained === move) text = `{a} rolled a ${value}${tag} — up ${gained} to tile ${m.tile}`;
    else text = `{a} rolled a ${value}${tag} but ended ${gained >= 0 ? 'only ' + gained + ' up' : Math.abs(gained) + ' down'} at tile ${m.tile}`;
    this._feed('roll', m.id, null, text, '🎲', { value });
  }
  _trackBest(m, value, gained) {
    const b = m.stats.best;
    if (!b || gained > b.gained) m.stats.best = { gained, value, day: this.s.season.day };
  }
  _markRolled(m) {
    const day = this.s.season.day;
    if (m.dormant) {
      m.dormant = false;
      this._feed('wake', m.id, null, `{a} is back on the mountain 👋`, '👋');
    }
    if (m.lastRollDay !== day) {
      m.streak = m.lastRollDay === day - 1 ? m.streak + 1 : 1;
      m.lastRollDay = day;
      if (m.streak > 0 && m.streak % 3 === 0) {
        const c = rngPick(this.s.rng, SPECIAL_IDS);
        if (this._addCard(m, c, `${m.streak}-day streak`)) this._feed('streak', m.id, null, `🔥 {a} hit a ${m.streak}-day streak — bonus ${SPECIAL_CARDS[c].name} card`, '🔥');
      }
      if (m.streak === 7) {
        this._gain(m, 2, '7-day streak');
        this._feed('streak', m.id, null, `🔥 {a} hit a 7-day streak — +2 throws`, '🔥');
      }
    }
  }

  /** POST /fork — choose 'safe' | 'risky' at the Route Fork. */
  chooseFork(pid, choice) {
    const g = this._guardActor(pid); if (g) return g;
    const m = this.m(pid);
    if (!m.pending || m.pending.type !== 'fork') return err('no_fork', 'No fork choice pending.');
    if (choice !== 'safe' && choice !== 'risky') return err('bad_choice', 'Choose safe or risky.');
    this._begin(); this._tick(0.005);
    const p = m.pending; m.pending = null;
    m.routeChoice = choice;
    this._emit({ type: 'fork', pid, choice });
    this._feed('fork', pid, null, choice === 'safe' ? `🔀 {a} took the Safe Route` : `🔀 {a} took the Risky Route (+${RISKY_JUMP} jump)!`, '🔀');
    if (choice === 'safe') {
      if (p.resolve) this._resolveTile(m, p.landing, p.depth);
    } else {
      const r = this._moveForward(m, RISKY_JUMP, 'fork');
      if (!r.summit && p.resolve) this._resolveTile(m, r.to, p.depth);
    }
    this._finishRollFeed(m);
    return this._end();
  }
  _finishRollFeed(m) {
    if (!m.pending && m._rollCtx) {
      const c = m._rollCtx; delete m._rollCtx;
      const gained = m.tile - c.startTile;
      this._rollFeed(m, c.value, c.move, gained, c.doubled, c.second);
      this._trackBest(m, c.value, gained);
    }
  }

  /** POST /fate — resolve the pending Fate Card. */
  chooseFate(pid, optionId, targetId = null) {
    const g = this._guardActor(pid); if (g) return g;
    const m = this.m(pid);
    if (!m.pending || m.pending.type !== 'fate') return err('no_fate', 'No Fate Card pending.');
    const card = m.pending.card;
    const opts = this.fateOptions(m, card);
    const opt = opts.find((o) => o.id === optionId);
    if (!opt) return err('bad_option', 'Unknown option.');
    if (!opt.enabled) return err('option_disabled', opt.reason || 'Option unavailable.');
    let target = null;
    if (opt.target === 'pick') target = this.m(targetId);
    if (opt.target === 'auto') target = this.m(opt.targets[0]);
    this._begin(); this._tick(0.005);
    m.pending = null;
    if (opt.target && (!target || !opt.targets.includes(target.id))) {
      // §8: target became invalid between selection and resolution → fizzle, no cost.
      this._emit({ type: 'fizzle', pid, card, option: optionId });
      this._feed('fate', pid, null, `{a}'s ${FATE_CARDS[card].title} fizzled — target no longer valid`, '💨');
      this._finishRollFeed(m);
      return this._end({ fizzled: true });
    }
    this._emit({ type: 'fate-choice', pid, card, option: optionId, target: target?.id ?? null });
    this._applyFate(m, card, optionId, target);
    this._finishRollFeed(m);
    return this._end();
  }

  _applyFate(m, card, o, t) {
    const V = { voluntary: true, kind: 'card' };
    const back = (n, vol = true) => this._moveBack(m, n, vol ? V : { voluntary: false, kind: 'card' });
    const fwd = (who, n) => { const r = this._moveForward(who, n, 'card'); this._afterCardMove(who, r); return r; };
    const name = FATE_CARDS[card].title;
    const say = (text, icon = '🟣', b = null) => this._feed('fate', m.id, b, text, icon);
    switch (`${card}.${o}`) {
      case 'avalanche.a': this._lose(m, 2, 'Avalanche', { toPot: true }); say(`{a} fed 2 throws to the Storm Pot (Avalanche)`, '⛈️'); break;
      case 'avalanche.b':
        this._markTargeted(t, m);
        if (!this._tryShield(t, `${m.name}'s Avalanche`, true)) { this._lose(t, 1, `Avalanche by ${m.name}`, { toPot: true }); say(`🏔️ {a} triggered an Avalanche on {b} — they lose a throw!`, '🏔️', t.id); }
        back(2); break;
      case 'avalanche.c': back(4); say(`{a} retreated 4 tiles from the Avalanche`); break;
      case 'gambler.a': {
        const v = this._rollD6(m, 'gambler');
        this._emit({ type: 'subroll', pid: m.id, value: v, why: 'gambler' });
        if (v >= 4) { this._gain(m, 2, "Gambler's Dice"); say(`🎲 {a} won the Gambler's wager (${v}) — +2 throws`); }
        else { this._lose(m, 2, "Gambler's Dice", { toPot: true }); say(`🎲 {a} lost the Gambler's wager (${v}) — −2 throws to the Pot`); }
        break;
      }
      case 'gambler.b': case 'alliance.b': case 'shortcut.b': say(`{a} played it safe (${name})`); break;
      case 'alliance.a':
        this._lose(m, 1, `gift to ${t.name}`); this._gain(t, 1, `gift from ${m.name}`);
        say(`🤝 {a} formed an Alliance with {b} — both +3 tiles`, '🤝', t.id);
        fwd(m, 3); if (t.summitAt == null) fwd(t, 3); break;
      case 'betrayal.a': {
        this._markTargeted(t, m);
        if (this._tryShield(t, `${m.name}'s Betrayal`, true)) break;
        const a = m.tile; const b = t.tile;
        this._emit({ type: 'swap', pid: m.id, target: t.id, from: a, to: b });
        say(`🐍 {a} BETRAYED {b} and swapped places!`, '🐍', t.id);
        // Each side moves to the other's tile; forward movers get reach-or-pass checks.
        if (b > a) fwd(m, b - a); else this._moveBack(m, a - b, V);
        if (a > b) { fwd(t, a - b); } else this._moveBack(t, b - a, { voluntary: false, kind: 'swap' });
        break;
      }
      case 'betrayal.b': back(2); say(`{a} refused to betray anyone and fell back 2`); break;
      case 'tollkeeper.a': this._lose(m, 1, 'Tollkeeper', { toPot: true }); say(`{a} paid the Tollkeeper 1 throw`, '🪙'); break;
      case 'tollkeeper.b': back(5); say(`{a} refused the toll and went back 5`, '🪙'); break;
      case 'tollkeeper.c': this._lose(m, 2, 'Tollkeeper', { toPot: true }); this._addCard(m, 'shield', 'Tollkeeper'); say(`{a} paid 2 throws and bought a Shield from the Tollkeeper`, '🪙'); break;
      case 'bridge.a': this._lose(m, 1, 'Collapsing Bridge', { toPot: true }); say(`{a} paid 1 throw to cross the Collapsing Bridge`, '🌉'); break;
      case 'bridge.b': back(4); say(`🌉 The bridge collapsed — {a} fell back 4`, '🌉'); break;
      case 'frozenpass.a': if (m.throws === 0) m.frostbitePending = true; else m.frozenNext += 1; say(`🧊 {a} will lose their next throw to the Frozen Pass`, '🧊'); break;
      case 'frozenpass.b': back(3); say(`🧊 {a} backed off the Frozen Pass (−3)`, '🧊'); break;
      case 'thief.a': this._steal(m, t, 'The Thief'); back(1); break;
      case 'thief.b': back(2); say(`{a} let the Thief go and fell back 2`); break;
      case 'treasure.a': this._gain(m, 2, 'Treasure Chest'); back(4); say(`🧰 {a} hauled a heavy Treasure Chest (+2 throws, −4 tiles)`, '🧰'); break;
      case 'treasure.b': this._gain(m, 1, 'Treasure Chest'); say(`🧰 {a} pocketed a coin from the Treasure Chest (+1 throw)`, '🧰'); break;
      case 'duel.a': {
        this._markTargeted(t, m);
        const va = this._rollD6(m, 'duel'); const vb = this._rollD6(t, 'duel');
        this._emit({ type: 'duel', pid: m.id, target: t.id, a: va, b: vb });
        if (va === vb) { say(`⚔️ {a} dueled {b} — ${va} vs ${vb}, a draw!`, '⚔️', t.id); break; }
        const [w, l] = va > vb ? [m, t] : [t, m];
        say(`⚔️ {a} dueled {b} — ${va} vs ${vb}! ${w.name} +5, ${l.name} −3`, '⚔️', t.id);
        if (w.summitAt == null) fwd(w, 5);
        if (l === t) { if (!this._tryShield(t, 'a duel loss', true)) this._moveBack(t, 3, { voluntary: false, kind: 'duel' }); }
        else this._moveBack(m, 3, { voluntary: false, kind: 'duel' });
        break;
      }
      case 'duel.b': back(1); say(`{a} declined the Duel (−1)`); break;
      case 'shortcut.a': {
        const r = this._moveForward(m, 8, 'card');
        if (r.summit) { say(`🧗 {a} dashed up the gully straight to the summit!`, '🧗'); break; }
        const v = this._rollD6(m, 'shortcut-card');
        this._emit({ type: 'subroll', pid: m.id, value: v, why: 'shortcut' });
        if (v <= 3) { const b = this._moveBack(m, 14, { voluntary: false, kind: 'tumble' }); say(`🧗 {a} dashed +8 then tumbled (rolled ${v}) — net ${b.to - r.from >= 0 ? '+' : ''}${b.to - r.from}`, '🧗'); }
        else say(`🧗 {a} dashed +8 up the gully and held on (rolled ${v})!`, '🧗');
        this._afterCardMove(m, r);
        break;
      }
      case 'stormcall.a': this._lose(m, 2, 'Storm Call', { toPot: true, potMult: 2 }); say(`🌩️ {a} called the storm — 2 throws count double in the Pot!`, '🌩️'); break;
      case 'stormcall.b': this._gain(m, 1, 'Storm Call'); say(`{a} kept a throw from the Storm Call (+1)`); break;
      case 'swap.a': {
        this._markTargeted(t, m);
        const targetLoses = t.throws > m.throws;
        if (targetLoses && this._tryShield(t, `${m.name}'s Swap`, true)) break;
        const a = m.throws; const b = t.throws;
        m.throws = Math.min(a, b); t.throws = Math.min(a, b);
        if (b > a) this._gain(m, b - a, `swap with ${t.name}`); else this._emit({ type: 'throws', pid: m.id, delta: b - a, reason: 'swap', throws: m.throws });
        if (a > b) this._gain(t, a - b, `swap with ${m.name}`); else this._emit({ type: 'throws', pid: t.id, delta: a - b, reason: 'swap', throws: t.throws });
        say(`🔄 {a} swapped throw counts with {b} (${a} ↔ ${b})`, '🔄', t.id);
        break;
      }
      case 'swap.b': back(3); say(`{a} declined the Swap (−3)`); break;
      case 'guardian.a': this._addCard(m, 'shield', 'Guardian'); say(`🦅 {a} gained the Guardian's Shield`, '🦅'); break;
      case 'guardian.b': this._gain(m, 1, 'Guardian'); say(`🦅 {a} took +1 throw from the Guardian`, '🦅'); break;
      case 'laststand.a': this._gain(m, 2, 'Last Stand'); say(`🔥 {a} made a Last Stand — +2 throws`, '🔥'); break;
      case 'laststand.b': fwd(m, 6); m.fateDeck.harshNext = true; say(`🔥 {a} made a Last Stand — +6 tiles!`, '🔥'); break;
      default: throw new Error(`unhandled fate ${card}.${o}`);
    }
  }

  /** POST /card — play a special card from hand. */
  playCard(pid, card) {
    const g = this._guardActor(pid); if (g) return g;
    const m = this.m(pid);
    if (m.summitAt != null) return err('summited', 'You already summited.');
    if (!m.cards.includes(card)) return err('no_card', 'Card not in hand.');
    if (m.pending) return err('pending', `Resolve your ${m.pending.type} first.`);
    if (card === 'shield') return err('passive', 'Shields trigger automatically.');
    if (card === 'double' && m.armed.double) return err('armed', 'Double Move already armed.');
    if (card === 'second' && m.armed.second) return err('armed', 'Second Chance already armed.');
    if (card === 'magnet' && !this.stealTarget(m)) return err('no_target', 'No valid target ahead.');
    this._begin(); this._tick(0.005);
    m.cards.splice(m.cards.indexOf(card), 1);
    this._emit({ type: 'card-play', pid, card });
    const say = (t, i, b = null) => this._feed('card', pid, b, t, i);
    switch (card) {
      case 'double': m.armed.double = true; say(`⚡ {a} armed a Double Move`, '⚡'); break;
      case 'second': m.armed.second = true; say(`🎲 {a} armed a Second Chance`, '🎲'); break;
      case 'magnet': { const t = this.stealTarget(m); this._steal(m, t, 'Magnet'); break; }
      case 'boost': { const r = this._moveForward(m, 6, 'boost'); say(`🚀 {a} boosted +6 tiles!`, '🚀'); this._afterCardMove(m, r); break; }
      case 'ghost': m.ghostUntil = this.now + H24; m.immunityUntil = Math.max(m.immunityUntil, this.now + H24); say(`👻 {a} went Ghost — untouchable for 24h`, '👻'); break;
      default: break;
    }
    return this._end();
  }

  setShieldMode(pid, mode) {
    const m = this.m(pid);
    if (!m || !['auto', 'players'].includes(mode)) return err('bad', 'Invalid');
    m.shieldMode = mode; return { ok: true, events: [] };
  }
  react(pid, feedId, emoji) {
    const e = this.s.feed.find((f) => f.id === feedId);
    if (!e) return err('no_feed', 'Unknown feed entry');
    const list = (e.reactions[emoji] = e.reactions[emoji] || []);
    const i = list.indexOf(pid);
    if (i >= 0) list.splice(i, 1); else list.push(pid);
    return { ok: true, events: [] };
  }

  /** Server timeout policy: resolve a stale pending choice with the gentlest option. */
  autoResolve(pid) {
    const m = this.m(pid);
    if (!m?.pending) return { ok: true, events: [] };
    if (m.pending.type === 'fork') return this.chooseFork(pid, 'safe');
    const opts = this.fateOptions(m, m.pending.card).filter((o) => o.enabled && !o.target);
    const score = (o) => (o.hint.throws || 0) * 3.5 + (o.hint.tiles || 0) - (o.risky ? 1 : 0);
    opts.sort((a, b) => score(b) - score(a));
    return this.chooseFate(pid, (opts[0] || this.fateOptions(m, m.pending.card).find((o) => o.enabled)).id);
  }

  // ───────────────────────────── time / days (scheduler) ─────────────────────────────
  /** Simulation clock. In production this is wall-clock time; here the prototype advances it. */
  advanceClockTo(hours) {
    if (this.s.season.over) return { ok: true, events: [] };
    this._begin();
    if (hours > this.now) this.s.season.clock = hours;
    if (this.sprintOver()) this._endSeason('sprint');
    return this._end();
  }

  /** Daily refresh job: end the current day and start the next (or end the season at day 12). */
  advanceDay() {
    const s = this.s.season;
    if (s.over) return err('season_over', 'Season over.');
    this._begin();
    for (const m of this.all) if (m.pending) this.autoResolve(m.id);
    this._recordRanks();
    if (s.day >= CONST.MAX_DAYS) { this.s.season.clock = s.day * H24; this._endSeason('day12'); return this._end(); }
    const nextStart = s.day * H24;
    if (s.sprintEndsAt != null && nextStart >= s.sprintEndsAt) { this.s.season.clock = s.sprintEndsAt; this._endSeason('sprint'); return this._end(); }
    s.day += 1;
    s.clock = Math.max(s.clock, nextStart);
    this._emit({ type: 'day', day: s.day });
    for (const m of this.all) {
      if (m.summitAt != null) continue;
      if (!m.dormant && m.lastRollDay <= s.day - 1 - CONST.DORMANT_AFTER_DAYS) {
        m.dormant = true;
        this._feed('dormant', m.id, null, `💤 {a} has gone dormant (2 days without rolling)`, '💤');
      }
      if (m.dormant) m.dormantDays += 1;
      this._refresh(m, false);
    }
    this._feed('day', null, null, `Day ${s.day} — throws refreshed (+${CONST.THROWS_PER_DAY}, soft cap ${CONST.SOFT_CAP}).`, '🌅');
    this._checkEruption(); // threshold may have dropped as players went dormant
    return this._end();
  }
  _refresh(m, initial) {
    const s = this.s.season;
    const last = s.lastRefreshAt[m.id];
    if (!initial && last != null && this.now - last < CONST.MIN_HOURS_BETWEEN_REFRESH) return; // anti double-dip
    s.lastRefreshAt[m.id] = this.now;
    const target = Math.min(CONST.SOFT_CAP, m.throws + CONST.THROWS_PER_DAY);
    const add = Math.max(0, target - m.throws);
    const wasted = CONST.THROWS_PER_DAY - add;
    if (wasted > 0 && !initial) m.stats.wasted += wasted;
    if (add > 0) this._gain(m, add, 'daily refresh', { soft: true });
    this._emit({ type: 'refresh', pid: m.id, added: add, wasted, throws: m.throws });
  }
  _recordRanks() {
    const r = this.ranking();
    r.forEach((m, i) => { m.stats.rankHistory.push({ day: this.s.season.day, rank: i + 1, tile: m.tile }); });
  }

  // ───────────────────────────── season end ─────────────────────────────
  _endSeason(reason) {
    const s = this.s.season;
    if (s.over) return;
    s.over = true; s.endReason = reason; s.endedAt = this.now;
    for (const m of this.all) { m.frostbitePending = false; m.frozenNext = 0; m.pending = null; }
    const ranked = this.ranking();
    const active = ranked.filter((m) => !m.dormant);
    const N = active.length;
    const results = ranked.map((m, i) => {
      const climb = (120 * m.tile) / BOARD_LEN;
      const pos = m.dormant ? null : active.indexOf(m) + 1;
      const sp = m.dormant ? climb * (N / 10) : ((N - pos + 1) * 10 + climb) * (N / 10);
      return { id: m.id, name: m.name, rank: i + 1, activePos: pos, tile: m.tile, summitAt: m.summitAt, throws: m.throws, dormant: m.dormant, dormantDays: m.dormantDays, sp: Math.round(sp * 10) / 10 };
    });
    s.results = results;
    s.recap = this._recap(ranked);
    this._feed('end', null, null, `🏁 Season over (${reason === 'sprint' ? 'final sprint ended' : 'day 12 cap'}). ${ranked[0].name} wins!`, '🏁');
    this._emit({ type: 'season-end', reason, results, recap: s.recap });
  }
  _recap(ranked) {
    const finalRank = new Map(ranked.map((m, i) => [m.id, i + 1]));
    let comeback = null;
    for (const m of ranked) {
      const worst = Math.max(...m.stats.rankHistory.filter((h) => h.day >= 2).map((h) => h.rank), finalRank.get(m.id));
      const gain = worst - finalRank.get(m.id);
      if (gain > 0 && (!comeback || gain > comeback.places)) comeback = { id: m.id, places: gain, from: worst, to: finalRank.get(m.id) };
    }
    const maxBy = (f) => ranked.reduce((best, m) => (f(m) > (best ? f(best) : 0) ? m : best), null);
    const bet = maxBy((m) => m.stats.betrayals);
    const lucky = maxBy((m) => m.stats.best?.gained ?? 0);
    const pot = maxBy((m) => m.stats.potFed);
    return {
      comeback,
      betrayals: bet ? { id: bet.id, count: bet.stats.betrayals } : null,
      luckiest: lucky ? { id: lucky.id, ...lucky.stats.best } : null,
      potTop: pot ? { id: pot.id, count: pot.stats.potFed } : null,
      eruptions: this.s.season.eruptions.length,
    };
  }

  // ───────────────────────────── read model ─────────────────────────────
  /** Sanitised snapshot for a client. */
  view(pid) {
    const s = this.s;
    const prot = this.protectedSet();
    const ranked = this.ranking();
    const me = this.m(pid);
    const members = ranked.map((m, i) => ({
      id: m.id, name: m.name, rank: i + 1, tile: m.tile, throws: m.throws, cards: m.id === pid ? m.cards.slice() : m.cards.length,
      dormant: m.dormant, protected: prot.has(m.id), immuneHours: Math.max(0, +(m.immunityUntil - this.now).toFixed(1)),
      ghost: this.now < m.ghostUntil, summitAt: m.summitAt, isBot: m.isBot, color: m.color, personality: m.personality,
      floor: this.floorOf(m), routeChoice: m.routeChoice, frozen: m.frozenNext > 0 || m.frostbitePending,
    }));
    let pending = null;
    if (me?.pending) {
      pending = { ...me.pending };
      if (pending.type === 'fate') pending.options = this.fateOptions(me, pending.card);
    }
    return {
      day: s.season.day, maxDays: CONST.MAX_DAYS, clock: this.now, pot: { count: s.season.potCount, threshold: this.potThreshold() },
      sprintEndsAt: s.season.sprintEndsAt, endReason: s.season.endReason, firstSummitBy: s.season.firstSummitBy, over: s.season.over,
      results: s.season.results, recap: s.season.recap, members, protectedCount: this.protectedCount(),
      // never expose the deck order / RNG-derived state to clients
      me: me && (({ fateDeck, _rollCtx, ...pub }) => ({ ...pub, floor: this.floorOf(me), protected: prot.has(me.id), immune: this.isImmune(me) }))(me),
      pending,
    };
  }
}

export { BOARD, T, TILE_INFO, CAMPS, FORK_TILE, CONST };
