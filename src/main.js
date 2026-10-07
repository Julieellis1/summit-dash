// App controller: wires the authoritative engine ("server") to the 3D world, dice and DOM UI.
// The UI only *requests* actions and animates the events the engine returns.
import { SummitEngine } from './engine.js';
import { makeBotRng, botTurn, PERSONALITIES } from './bots.js';
import { planDay, runBots, HUMAN_HOUR } from './season.js';
import { CONST, BOARD_LEN, BOARD, T } from './board.js';
import { SPECIAL_CARDS, FATE_CARDS } from './cards.js';
import { Sfx } from './audio.js';
import * as UI from './ui.js';

const { $, toast } = UI;
const HUMAN = 'you';
const COLORS = ['#ff6b4a', '#4f8ef7', '#2ec4b6', '#f7b32b', '#c77dff', '#8ac926', '#ff8fab', '#00b4d8', '#e9c46a', '#f15bb5'];
const BOT_NAMES = ['Ada', 'Tunde', 'Kemi', 'Zara', 'Femi', 'Nia', 'Obi', 'Lola', 'Kofi'];
const PERS = ['greedy', 'saboteur', 'cautious'];
const RANKS = [[1000, 'Summit Master'], [600, 'Trailblazer'], [300, 'Challenger'], [100, 'Pathfinder'], [0, 'Wanderer']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Storage is optional (sandboxed iframes throw on access) — everything is wrapped.
const store = {
  get(k) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { window.localStorage.removeItem(k); } catch { /* ignore */ } },
};
const SAVE = 'summitdash.save.v1'; const PREFS = 'summitdash.prefs.v1'; const PROFILE = 'summitdash.profile.v1';

function detectQuality() {
  const mem = navigator.deviceMemory || 8; const cores = navigator.hardwareConcurrency || 8;
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (mem <= 3 || cores <= 3 || (mobile && (mem <= 4 || cores <= 4))) return 'low';
  return 'high';
}

class App {
  constructor() {
    this.prefs = { sound: true, quality: 'auto', motion: 'system', follow: true, tutorialDone: false, ...(store.get(PREFS) || {}) };
    this.profile = { lifetimeSP: 0, seasons: 0, rolls: [0, 0, 0, 0, 0, 0], ...(store.get(PROFILE) || {}) };
    const sysReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.reduced = this.prefs.motion === 'on' || (this.prefs.motion === 'system' && sysReduce);
    document.body.classList.toggle('reduce', this.prefs.motion === 'on');
    this.quality = this.prefs.quality === 'auto' ? detectQuality() : this.prefs.quality;
    this.sfx = new Sfx(); this.sfx.setMuted(!this.prefs.sound);
    this.busy = false; this.eng = null; this.mode = 'idle'; this.tab = 'squad'; this.fairMode = 'you';
    this.errors = [];
  }
  savePrefs() { store.set(PREFS, this.prefs); }

  async boot() {
    const [{ World }, { Dice }] = await Promise.all([import('./scene.js'), import('./dice.js')]);
    this.world = new World($('#gl'), { quality: this.quality, reducedMotion: this.reduced });
    this.dice = new Dice(this.world.renderer, { shadows: this.quality === 'high', reducedMotion: this.reduced });
    this.dice.onImpact = () => this.sfx.clack();
    this.world.afterRender = (dt) => this.dice.render(dt);
    this.world.onHop = (pid, t) => { if (pid === HUMAN) { this.sfx.hop(t); this.world.highlightTile(t); } };
    this._fps = { t: 0, n: 0, low: 0 };
    const loop = () => { requestAnimationFrame(loop); this.world.frame(); this._fpsTick(); };
    loop();
    this._wire();
    UI.renderRules();
    $('#loading').classList.add('fade'); setTimeout(() => $('#loading').remove(), 700);
    $('#btnMute').textContent = this.prefs.sound ? '🔊' : '🔇';
    this.showSetup();
  }
  _fpsTick() {
    const f = this._fps; const now = performance.now(); if (!f.last) f.last = now; f.n++;
    if (now - f.last > 3000) {
      const fps = (f.n * 1000) / (now - f.last); f.n = 0; f.last = now; this.fps = fps;
      if (this.quality === 'high' && fps < 26 && ++f.low >= 2 && !this._degraded) {
        this._degraded = true; this.world.renderer.setPixelRatio(1); this.world.sun.castShadow = false; this.world.renderer.shadowMap.enabled = false;
        toast('⚙️ Switched to performance mode for smoother play');
      }
    }
  }

  _wire() {
    $('#rollBtn').addEventListener('click', () => this.roll());
    $('#endDayBtn').addEventListener('click', () => this.endDay());
    $('#btnOverview').addEventListener('click', () => { this.overview = !this.overview; this.world.flyOverview(this.overview); $('#btnOverview').textContent = this.overview ? '🎯' : '🗺️'; });
    $('#btnMute').addEventListener('click', () => { this.prefs.sound = !this.prefs.sound; this.sfx.setMuted(!this.prefs.sound); $('#btnMute').textContent = this.prefs.sound ? '🔊' : '🔇'; this.savePrefs(); this.sfx.click(); });
    $('#btnSettings').addEventListener('click', () => this.showSettings());
    $('#btnPanel').addEventListener('click', () => $('#side').classList.toggle('open'));
    $('#grab').addEventListener('click', () => $('#side').classList.remove('open'));
    $('#btnFair').addEventListener('click', () => this.setTab('fair'));
    $('#pot').addEventListener('click', () => toast(`⛈️ Storm Pot: erupts at max(8, 2 × active climbers). ☀️ Sunbreak 40% · 🌩️ Whiteout 35% · 🌈 Windfall 25%`));
    $('#tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !$('#modal-root').children.length && this.mode !== 'idle') { e.preventDefault(); this.roll(); } });
    window.addEventListener('error', (e) => this._err(e.message));
    window.addEventListener('unhandledrejection', (e) => this._err(String(e.reason?.stack || e.reason)));
  }
  _err(msg) { this.errors.push(msg); console.error(msg); }
  setTab(tab) {
    this.tab = tab;
    $('#tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    for (const t of ['squad', 'feed', 'fair', 'rules']) $(`#pane-${t}`).classList.toggle('hidden', t !== tab);
    $('#side').classList.add('open');
    this.refresh();
  }

  // ───────── session lifecycle ─────────
  showSetup() {
    const saved = store.get(SAVE);
    const canContinue = saved && saved.eng && !saved.eng.season.over;
    let size = 8;
    const m = UI.modal(`<div class="hero"><div class="tag">ROLL · RISK · SABOTAGE · SURVIVE</div><h1>SUMMIT DASH</h1>
      <div class="small">Everyone starts equal. Nobody stays safe.</div></div>
      <p>Race your squad up a 200-tile mountain. 5 throws a day, Fate Cards that force dilemmas, a Storm Pot that erupts. First to the summit wins — then a 24h final sprint.</p>
      <label class="field">Your handle<input type="text" id="handle" maxlength="14" value="${UI.esc(this.prefs.handle || 'You')}" /></label>
      <div class="field">Squad size (you + bot rivals)<div class="seg" id="sizeSeg">${[5, 6, 7, 8, 9, 10].map((n) => `<button data-n="${n}" class="${n === size ? 'on' : ''}">${n}</button>`).join('')}</div>
        <span class="small" id="sizeNote"></span></div>
      <label class="field">Season seed (optional — same seed, same dice)<input type="text" id="seed" placeholder="random" /></label>
      <label class="check"><input type="checkbox" id="tut" ${this.prefs.tutorialDone ? '' : 'checked'} /> Play the 30-second tutorial first</label>
      <div class="btn-row"><button class="btn primary" id="go">Start season ▸</button>${canContinue ? `<button class="btn" id="cont">Continue · Day ${saved.eng.season.day}</button>` : ''}</div>
      <div class="small" style="margin-top:12px">Phase 0 prototype · bots: ${Object.values(PERSONALITIES).map((p) => p.label).join(' / ')} · no monetization, ever.</div>`);
    const note = () => { m.root.querySelector('#sizeNote').textContent = `${size - 1} bot rivals · ${Math.max(1, Math.floor(0.25 * size + 0.5))} protected · Pot erupts at ${Math.max(8, 2 * size)}`; };
    note();
    m.root.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => { size = +b.dataset.n; m.root.querySelectorAll('[data-n]').forEach((x) => x.classList.toggle('on', x === b)); note(); }));
    m.root.querySelector('#go').onclick = async () => {
      this.sfx.click();
      const handle = (m.root.querySelector('#handle').value || 'You').trim().slice(0, 14) || 'You';
      this.prefs.handle = handle; this.savePrefs();
      const seedTxt = m.root.querySelector('#seed').value.trim();
      const seed = seedTxt ? (/^\d+$/.test(seedTxt) ? +seedTxt : [...seedTxt].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)) : (Math.floor(Math.random() * 2 ** 31) >>> 0);
      const tut = m.root.querySelector('#tut').checked;
      m.close();
      if (tut) await this.tutorial(handle);
      await this.newSeason({ name: handle, size, seed });
    };
    const c = m.root.querySelector('#cont');
    if (c) c.onclick = () => { m.close(); this.resume(saved); };
  }

  _players(name, size) {
    const ps = [{ id: HUMAN, name, color: COLORS[0] }];
    for (let i = 1; i < size; i++) ps.push({ id: `b${i}`, name: BOT_NAMES[i - 1], isBot: true, personality: PERS[(i - 1) % 3], casual: i % 3 === 0, color: COLORS[i] });
    return ps;
  }
  _setupWorld() {
    for (const tk of this.world.tokens.values()) this.world.scene.remove(tk);
    this.world.tokens.clear();
    for (const m of this.eng.all) this.world.addToken(m.id, { color: m.color, name: m.id === HUMAN ? m.name : m.name, isHuman: m.id === HUMAN });
    for (const m of this.eng.all) this.world.placeToken(m.id, m.tile, true);
    this.world.setFocus(HUMAN); this.world.highlightTile(this.eng.m(HUMAN).tile); this.world.snapCamera();
    $('#hud').classList.remove('hidden');
  }
  async newSeason({ name, size, seed }) {
    this.eng = SummitEngine.create({ seed, players: this._players(name, size), seasonId: this.profile.seasons + 1 });
    this.botRng = makeBotRng(seed); this.seed = seed; this.mode = 'season';
    this._setupWorld();
    this.refresh();
    toast(`🚩 Season ${this.eng.state.season.id} · ${size} climbers · seed ${seed}`, 'good');
    await this.startDay();
  }
  resume(saved) {
    this.eng = SummitEngine.load(saved.eng); this.botRng = saved.botRng; this.plan = saved.plan; this.seed = saved.eng.seed; this.mode = 'season';
    this._setupWorld(); this.refresh(); toast(`Welcome back — Day ${this.eng.state.season.day}`, 'good');
    this.handlePending().then(() => this.refresh());
  }
  save() {
    if (this.mode !== 'season' || !this.eng) return;
    store.set(SAVE, { eng: this.eng.state, botRng: this.botRng, plan: this.plan });
  }

  // ───────── day loop ─────────
  async startDay() {
    const eng = this.eng; const s = eng.state.season;
    this.plan = planDay(eng, this.botRng, HUMAN);
    const morning = runBots(eng, this.plan, this.botRng, 0, HUMAN_HOUR);
    await this.animateBatch(morning, 'morning');
    const r = eng.advanceClockTo((s.day - 1) * 24 + HUMAN_HOUR);
    await this.playEvents(r.events);
    this.save(); this.refresh();
    if (eng.state.season.over) return this.finish();
    await this.handlePending();
    this.refresh();
  }
  async endDay(skipConfirm = false) {
    if (this.busy || !this.eng || this.eng.state.season.over) return;
    if (this.mode === 'tutorial') return;
    const me = this.eng.m(HUMAN);
    if (!skipConfirm && me.throws > 0 && me.summitAt == null) {
      const carry = Math.min(CONST.SOFT_CAP, me.throws + CONST.THROWS_PER_DAY);
      const waste = me.throws + CONST.THROWS_PER_DAY - carry;
      const ok = await UI.confirmBox('End the day?', `You still have <b>${me.throws}</b> throw${me.throws > 1 ? 's' : ''}. Tomorrow's refresh tops you up to ${carry}${waste > 0 ? ` — <b>${waste} throw${waste > 1 ? 's' : ''} would be wasted</b> (soft cap ${CONST.SOFT_CAP})` : ''}.`, 'End day', 'Keep climbing');
      if (!ok) return;
    }
    this.busy = true; this.refresh();
    try {
      const evening = runBots(this.eng, this.plan, this.botRng, HUMAN_HOUR, 24);
      await this.animateBatch(evening, 'evening');
      if (this.eng.state.season.over) { this.busy = false; return this.finish(); }
      const r = this.eng.advanceDay();
      await this.playEvents(r.events, { quiet: true });
      if (this.eng.state.season.over) { this.busy = false; return this.finish(); }
      const me2 = this.eng.m(HUMAN);
      toast(`🌅 Day ${this.eng.state.season.day} — throws refreshed: ${me2.throws} banked`, 'big good');
      this.sfx.good();
      await this.startDay();
    } finally { this.busy = false; this.refresh(); this.save(); }
  }

  // ───────── human actions ─────────
  async roll() {
    if (this.busy || !this.eng) return;
    const r = this.eng.requestRoll(HUMAN);
    if (!r.ok) { toast(r.message, 'bad'); return; }
    if (this.mode === 'tutorial') { document.querySelectorAll('.coach').forEach((c) => c.remove()); $('#rollBtn').classList.remove('spot'); }
    this.busy = true; this.refresh();
    try {
      await this.playEvents(r.events);
      await this.handlePending();
    } finally { this.busy = false; this.refresh(); this.save(); }
    if (this.mode === 'tutorial' && this._tutStep) this._tutStep();
    if (this.eng.state.season.over) this.finish();
  }
  async onCard(card) {
    if (this.busy) return;
    const d = SPECIAL_CARDS[card];
    if (d.passive) {
      const mode = this.eng.m(HUMAN).shieldMode;
      toast(`🛡️ Shields trigger automatically (${mode === 'auto' ? 'all blockable effects' : 'player effects only'} — change in ⚙️)`);
      return;
    }
    const ok = await UI.confirmBox(`${d.icon} ${d.name}`, d.text, 'Play card', 'Keep');
    if (!ok) return;
    const r = this.eng.playCard(HUMAN, card);
    if (!r.ok) { toast(r.message, 'bad'); return; }
    this.busy = true;
    try { this.sfx.whoosh(); await this.playEvents(r.events); await this.handlePending(); } finally { this.busy = false; this.refresh(); this.save(); }
  }
  async handlePending() {
    for (let i = 0; i < 6; i++) {
      const v = this.eng.view(HUMAN);
      if (!v.pending || v.over) return;
      let r;
      if (v.pending.type === 'fork') { const c = await UI.showFork(this.sfx); r = this.eng.chooseFork(HUMAN, c); }
      else { const d = await UI.showFate(v.pending, v, this.sfx); r = this.eng.chooseFate(HUMAN, d.option, d.target); }
      if (!r.ok) { toast(r.message, 'bad'); continue; }
      await this.playEvents(r.events);
    }
  }

  // ───────── event animation ─────────
  async playEvents(events, { quiet = false } = {}) {
    const eng = this.eng; const v0 = eng.view(HUMAN);
    const nm = (id) => (id === HUMAN ? 'You' : UI.esc(eng.m(id)?.name ?? '?'));
    for (const e of events) {
      const mine = e.pid === HUMAN;
      switch (e.type) {
        case 'feed': this._feedAdded(e.entry); break;
        case 'roll':
          if (mine) {
            $('#vignette').classList.add('dim'); this.sfx.whoosh();
            await this.dice.throw(e.rolls);
            this.sfx.clack();
            UI.rollNumber(e.move, e.doubled ? `⚡ ${e.value} × 2` : e.second ? `🎲 best of ${e.rolls.join(' & ')}` : '');
            await sleep(this.reduced ? 200 : 650); this.dice.clear(); $('#vignette').classList.remove('dim');
          }
          break;
        case 'subroll': if (mine) { $('#vignette').classList.add('dim'); await this.dice.throw([e.value]); toast(`🎲 ${e.why === 'gambler' ? "Gambler's Dice" : 'Shortcut'}: rolled ${e.value}`, e.value >= 4 ? 'good' : 'bad'); await sleep(700); this.dice.clear(); $('#vignette').classList.remove('dim'); } break;
        case 'duel':
          if (mine || e.target === HUMAN) {
            $('#vignette').classList.add('dim'); await this.dice.throw([e.a, e.b], { skin: ['ivory', 'rival'] });
            toast(`⚔️ Duel: ${nm(e.pid)} ${e.a} vs ${nm(e.target)} ${e.b}`, 'big'); await sleep(900); this.dice.clear(); $('#vignette').classList.remove('dim');
          }
          break;
        case 'move': {
          const tk = this.world.tokens.get(e.pid); if (!tk) break;
          const fwd = e.to > e.from;
          const mode = e.kind === 'roll' ? 'hop' : fwd && ['shortcut', 'fork', 'boost', 'card'].includes(e.kind) ? 'jump' : 'slide';
          const p = this.world.moveToken(e.pid, tk.userData.tile, e.to, mode);
          if (mine) await p;
          if (mine) { this.world.highlightTile(e.to); if (e.floored) toast(`⛺ Caught by Base Camp ${e.floor}!`, 'good'); }
          break;
        }
        case 'tile':
          if (!mine) break;
          switch (e.effect) {
            case 'rockslide': this.world.rockslide(e.tile); this.sfx.rumble(); toast(`🪨 Rockslide! Back ${e.amount}`, 'bad'); await sleep(500); break;
            case 'frostbite': this.world.frost(HUMAN); this.sfx.ice(); toast('❄️ Frostbite — your next throw will be consumed', 'bad'); break;
            case 'supply': this.world.burst(this.world.tilePos[e.tile], '#ffd166', 36, { up: 5 }); this.sfx.good(); toast('🎁 Supply Crate: +1 throw', 'good'); break;
            case 'looted': toast('🎁 Already looted this crate this season'); break;
            case 'shortcut': this.sfx.good(); toast(`🪢 Shortcut! +${e.amount} tiles`, 'good'); break;
            case 'shrine': this.world.burst(this.world.tilePos[e.tile], '#7fb2ff', 36, { up: 5 }); this.sfx.good(); toast('🛡️ Shield Shrine: +1 Shield card', 'good'); break;
            case 'thief-none': toast("🗡️ Thief's Ledge — nobody valid ahead to rob. Safe."); break;
            case 'fate': this.world.pulseTile(e.tile, '#b98cff'); break;
            case 'chain-limit': toast('⛓️ Chain limit reached — treated as Safe'); break;
            default: if (e.tileType === T.SAFE && e.printed !== T.SAFE) toast(`🛤️ Safe Route: ${BOARD[e.tile]} treated as Safe`);
          }
          break;
        case 'camp': if (mine) { this.world.confetti(this.world.tilePos[e.camp]); this.sfx.fanfare(); toast(`⛺ Base Camp ${e.camp}! +1 throw · new fall floor`, 'big good'); await sleep(400); } break;
        case 'pot': this._potBump(); break;
        case 'eruption': {
          this.sfx.rumble(); this.world.eruptionFX(e.kind);
          await UI.eruptionCinematic(e.kind, e.winner ? `${e.winner === HUMAN ? 'You get' : nm(e.winner) + ' gets'} +3 throws (top contributor)` : '', { reduced: this.reduced });
          if (e.kind === 'sunbreak') this.sfx.good();
          break;
        }
        case 'shield': this.world.shieldBubble(e.pid); if (mine) { toast(`🛡️ Your Shield blocked ${UI.esc(e.blocked)}!`, 'good'); this.sfx.good(); } break;
        case 'frozen': if (mine) { this.world.frost(HUMAN); this.sfx.ice(); toast('❄️ Your throw froze solid — it feeds the Storm Pot', 'bad'); await sleep(500); } break;
        case 'frostbite-consume': if (mine) { this.world.frost(HUMAN); toast('❄️ Frostbite claimed a fresh throw', 'bad'); } break;
        case 'summit':
          this.world.confetti(this.world.tilePos[BOARD_LEN]); this.world.confetti(this.world.tilePos[BOARD_LEN]);
          if (mine) { this.sfx.fanfare(); toast('🏆 YOU REACHED THE SUMMIT!', 'big good', 4000); await sleep(800); }
          else toast(`🏆 ${nm(e.pid)} reached the summit!`, 'big');
          break;
        case 'sprint': toast(`⏱️ Final sprint! Season ends ${UI.clockLabel(e.endsAt)}`, 'big', 4000); break;
        case 'card-gain': if (mine) toast(`${SPECIAL_CARDS[e.card].icon} +1 ${SPECIAL_CARDS[e.card].name} card (${UI.esc(e.source)})`, 'good'); break;
        case 'card-lost': if (mine) toast(`✋ Hand full (max ${CONST.HAND_MAX}) — ${SPECIAL_CARDS[e.card].name} lost`, 'bad'); break;
        case 'steal': if (e.target === HUMAN) { toast(`🗡️ ${nm(e.pid)} stole a throw from you!`, 'bad'); this.sfx.bad(); } else if (mine) { toast(`🗡️ You stole a throw from ${nm(e.target)}!`, 'good'); this.sfx.good(); } break;
        case 'fizzle': if (mine) toast('💨 Target no longer valid — card fizzled, no cost paid'); break;
        case 'fate-discard': if (mine) toast(`🔁 ${FATE_CARDS[e.card].title} had no valid targets — redrawn`); break;
        case 'refresh': if (mine && e.wasted > 0) toast(`⚠️ ${e.wasted} throw${e.wasted > 1 ? 's' : ''} wasted at refresh (soft cap ${CONST.SOFT_CAP})`, 'bad'); break;
        case 'throws': if (mine && e.lost > 0 && e.reason !== 'daily refresh') toast(`Hard cap ${CONST.HARD_CAP}: ${e.lost} throw lost`, 'bad'); break;
        default: break;
      }
      if (['throws', 'pot', 'card-gain', 'move'].includes(e.type)) this.refresh(true);
    }
    this.refresh();
  }
  _potBump() { const p = $('#pot'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
  _feedAdded(entry) {
    if (this.tab === 'feed') this._feedDirty = true;
    // bots react to juicy moments (cosmetic only; never affects outcomes)
    if (['steal', 'eruption', 'summit', 'camp'].includes(entry.kind) || /BETRAYED|Duel|Avalanche|Rockslide/.test(entry.text)) {
      const bots = this.eng.all.filter((m) => m.isBot && m.id !== entry.a);
      if (bots.length && Math.random() < 0.6) {
        const b = bots[Math.floor(Math.random() * bots.length)];
        const em = entry.kind === 'steal' || /BETRAYED/.test(entry.text) ? '😈' : entry.kind === 'summit' || entry.kind === 'camp' ? '👏' : entry.kind === 'eruption' ? '😱' : '😂';
        this.eng.react(b.id, entry.id, em);
      }
    }
  }

  /** Bot sessions: run concurrently on screen, with a digest of what hit you. */
  async animateBatch(events, when) {
    if (!events.length) return;
    const finals = new Map();
    for (const e of events) if (e.type === 'move') finals.set(e.pid, e.to);
    const hitMe = events.filter((e) => e.type === 'feed' && (e.entry.b === HUMAN || (e.entry.a === HUMAN && e.entry.kind !== 'roll') || e.entry.kind === 'eruption' || e.entry.kind === 'summit'));
    for (const e of events) if (e.type === 'feed') this._feedAdded(e.entry);
    const proms = [];
    for (const [pid, to] of finals) {
      const tk = this.world.tokens.get(pid); if (!tk) continue;
      const from = tk.userData.tile; if (from === to) continue;
      proms.push(this.world.moveToken(pid, from, to, 'slide', 0.55));
    }
    this.refresh(true);
    const erupts = events.filter((e) => e.type === 'eruption');
    await Promise.all(proms);
    for (const e of erupts) { this.world.eruptionFX(e.kind); this.sfx.rumble(); await UI.eruptionCinematic(e.kind, e.winner ? `${e.winner === HUMAN ? 'You get' : UI.esc(this.eng.m(e.winner).name) + ' gets'} +3 throws (top contributor)` : '', { reduced: this.reduced }); }
    for (const e of events) {
      if (e.type === 'summit') this.world.confetti(this.world.tilePos[BOARD_LEN]);
      if (e.type === 'shield' && e.pid === HUMAN) this.world.shieldBubble(HUMAN);
    }
    const v = this.eng.view(HUMAN);
    if (hitMe.length) {
      const lines = hitMe.slice(-6).map((e) => `<div class="feed-item mine"><div class="ic">${e.entry.icon}</div><div>${UI.fmtFeed(e.entry, v)}</div></div>`).join('');
      const m = UI.modal(`<h2>${when === 'morning' ? '☕ While you were away' : '🌙 Tonight on the mountain'}</h2><div>${lines}</div><div class="btn-row"><button class="btn primary" data-ok>Got it</button></div>`, { dismiss: true });
      await new Promise((res) => { m.root.querySelector('[data-ok]').onclick = () => { m.close(); res(); }; m.root.addEventListener('click', (ev) => { if (ev.target === m.root) res(); }); setTimeout(res, this._auto ? 0 : 60000); });
      m.close();
    }
    this.world.highlightTile(this.eng.m(HUMAN).tile);
  }

  // ───────── fast-forward (prototype control) ─────────
  async fastForward() {
    if (!this.eng || this.eng.state.season.over || this.mode !== 'season') return;
    this.busy = true; this._auto = true; this.refresh();
    const eng = this.eng; let guard = 0;
    while (!eng.state.season.over && guard++ < 40) {
      if (eng.m(HUMAN).pending) eng.autoResolve(HUMAN);
      if (!this.plan) this.plan = planDay(eng, this.botRng, HUMAN);
      const dayStart = (eng.state.season.day - 1) * 24;
      runBots(eng, this.plan, this.botRng, 0, HUMAN_HOUR);
      eng.advanceClockTo(dayStart + HUMAN_HOUR + 0.01);
      if (!eng.state.season.over) botTurn(eng, HUMAN, this.botRng);
      if (!eng.state.season.over) runBots(eng, this.plan, this.botRng, HUMAN_HOUR, 24);
      if (!eng.state.season.over) eng.advanceDay();
      this.plan = null;
      if (!eng.state.season.over) this.plan = planDay(eng, this.botRng, HUMAN);
    }
    for (const m of eng.all) this.world.placeToken(m.id, m.tile, true);
    this.world.highlightTile(eng.m(HUMAN).tile);
    this.busy = false; this._auto = false; this.refresh();
    this.finish();
  }

  finish() {
    if (this._finished === this.eng) return; this._finished = this.eng;
    const v = this.eng.view(HUMAN);
    if (this.mode === 'season') {
      const me = v.results.find((r) => r.id === HUMAN);
      this.profile.lifetimeSP += me.sp; this.profile.seasons += 1;
      const rr = this.eng.m(HUMAN).stats.rolls; for (let i = 0; i < 6; i++) this.profile.rolls[i] += rr[i + 1];
      store.set(PROFILE, this.profile); store.del(SAVE);
    }
    const rankName = RANKS.find(([min]) => this.profile.lifetimeSP >= min)[1];
    this.sfx.fanfare();
    this.world.confetti(this.world.tilePos[BOARD_LEN]);
    UI.showEnd(v, { lifetimeSP: this.profile.lifetimeSP, rankName }, () => { this.mode = 'idle'; $('#hud').classList.add('hidden'); this.showSetup(); }, () => { this.world.flyOverview(true); toast('Tap ⚙️ → New season when you are ready'); });
    this.refresh();
  }

  // ───────── tutorial: one roll, one Fate Card ─────────
  async tutorial(name) {
    // find a seed whose first engine roll from tile 1 lands on a Fate tile (6) — the engine still decides.
    let seed = 1;
    for (let s = 1; s < 5000; s++) {
      const e = SummitEngine.create({ seed: s, players: this._players(name, 4) });
      const r = e.requestRoll(HUMAN);
      if (r.ok && e.m(HUMAN).pending?.type === 'fate' && ['treasure', 'guardian', 'gambler', 'stormcall'].includes(e.m(HUMAN).pending.card)) { seed = s; break; }
    }
    this.eng = SummitEngine.create({ seed, players: this._players(name, 4) });
    this.mode = 'tutorial'; this.botRng = makeBotRng(seed);
    this._setupWorld(); this.refresh();
    const coach = (title, text, btn) => new Promise((res) => {
      document.querySelectorAll('.coach').forEach((c) => c.remove());
      const c = document.createElement('div'); c.className = 'coach';
      c.innerHTML = `<button class="skip">Skip tutorial</button><b>${title}</b><p>${text}</p>${btn ? `<div class="btn-row"><button class="btn primary">${btn}</button></div>` : ''}`;
      document.body.appendChild(c);
      c.querySelector('.skip').onclick = () => { c.remove(); res('skip'); };
      if (btn) c.querySelector('.btn').onclick = () => { c.remove(); res('next'); };
      this._coach = { c, res };
    });
    const r1 = await coach('Welcome to the mountain ⛰️', 'Race your squad to tile 200. You get <b>5 throws a day</b>. Every tile does something.', 'Show me');
    if (r1 === 'skip') return this._endTutorial();
    $('#rollBtn').classList.add('spot');
    const rolled = new Promise((res) => { this._tutStep = res; });
    const r2 = await Promise.race([coach('Tap ROLL 🎲', 'The dice are thrown on the server — your screen only shows the tumble.'), rolled.then(() => 'rolled')]);
    $('#rollBtn').classList.remove('spot'); this._tutStep = null;
    document.querySelectorAll('.coach').forEach((c) => c.remove());
    if (r2 === 'skip') return this._endTutorial();
    await coach('That was a Fate Card 🟣', 'Fate Cards force dilemmas: sacrifice throws, sabotage a rival, or retreat. ⛺ Base Camps catch involuntary falls, and lost throws feed the ⛈️ Storm Pot until it erupts.', "Let's climb");
    return this._endTutorial();
  }
  _endTutorial() {
    document.querySelectorAll('.coach').forEach((c) => c.remove());
    $('#rollBtn').classList.remove('spot');
    this.prefs.tutorialDone = true; this.savePrefs(); this.mode = 'idle'; this._tutStep = null;
  }

  // ───────── settings ─────────
  showSettings() {
    const me = this.eng?.m(HUMAN);
    const m = UI.modal(`<h2>⚙️ Settings</h2>
      <div class="field">Shield mode<div class="seg" id="shSeg"><button data-s="auto" class="${!me || me.shieldMode === 'auto' ? 'on' : ''}">Auto (all blockable)</button><button data-s="players" class="${me?.shieldMode === 'players' ? 'on' : ''}">Players only</button></div></div>
      <div class="field">Graphics quality (reloads)<div class="seg" id="qSeg">${['auto', 'high', 'low'].map((q) => `<button data-q="${q}" class="${this.prefs.quality === q ? 'on' : ''}">${q}${q === 'auto' ? ` (${detectQuality()})` : ''}</button>`).join('')}</div></div>
      <div class="field">Reduced motion (reloads)<div class="seg" id="mSeg">${['system', 'on', 'off'].map((q) => `<button data-m="${q}" class="${this.prefs.motion === q ? 'on' : ''}">${q}</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" id="snd" ${this.prefs.sound ? 'checked' : ''}/> Sound effects</label>
      <div class="btn-row">
        <button class="btn" id="ff" ${this.mode !== 'season' || this.eng?.state.season.over ? 'disabled' : ''}>⏩ Auto-play rest of season</button>
        <button class="btn" id="tut">🎓 Replay tutorial</button>
        <button class="btn" id="new">🔁 New season</button>
        <button class="btn primary" id="close">Done</button>
      </div>
      <p class="small">Seed ${this.seed ?? '—'} · ${this.quality} quality${this._degraded ? ' (auto-degraded)' : ''} · ${this.fps ? Math.round(this.fps) + ' fps' : ''} · storage ${store.set('summitdash.probe', 1) ? 'on' : 'off (session only)'}</p>`, { dismiss: true });
    const R = m.root;
    R.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { if (this.eng) this.eng.setShieldMode(HUMAN, b.dataset.s); R.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); this.save(); });
    R.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { this.prefs.quality = b.dataset.q; this.savePrefs(); this.save(); location.reload(); });
    R.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { this.prefs.motion = b.dataset.m; this.savePrefs(); this.save(); location.reload(); });
    R.querySelector('#snd').onchange = (e) => { this.prefs.sound = e.target.checked; this.sfx.setMuted(!this.prefs.sound); $('#btnMute').textContent = this.prefs.sound ? '🔊' : '🔇'; this.savePrefs(); };
    R.querySelector('#ff').onclick = () => { m.close(); this.fastForward(); };
    R.querySelector('#tut').onclick = async () => { m.close(); const keep = { eng: this.eng, mode: this.mode, botRng: this.botRng, plan: this.plan }; await this.tutorial(this.prefs.handle || 'You'); if (keep.eng && keep.mode === 'season') { Object.assign(this, keep); this._setupWorld(); this.refresh(); } else { $('#hud').classList.add('hidden'); this.showSetup(); } };
    R.querySelector('#new').onclick = async () => { m.close(); if (await UI.confirmBox('Start a new season?', 'The current season will be abandoned.', 'New season')) { store.del(SAVE); this.mode = 'idle'; $('#hud').classList.add('hidden'); this.showSetup(); } };
    R.querySelector('#close').onclick = () => m.close();
  }

  // ───────── render ─────────
  refresh(light = false) {
    if (!this.eng) return;
    const v = this.eng.view(HUMAN);
    UI.renderHud(v, { busy: this.busy });
    UI.renderHand(v, (c) => this.onCard(c), this.busy);
    if (light) return;
    if (this.tab === 'squad') UI.renderSquad(v);
    if (this.tab === 'feed') UI.renderFeed(this.eng.state.feed, v, (id, em) => { this.eng.react(HUMAN, id, em); this.save(); this.refresh(); });
    if (this.tab === 'fair') {
      UI.renderFairness(this.eng, this.profile.rolls, this.fairMode);
      $('#pane-fair').querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { this.fairMode = b.dataset.f; this.refresh(); });
    }
  }
}

const app = new App();
window.__SD = app; // test & debug hook
app.boot().catch((e) => { app._err(String(e?.stack || e)); const d = document.createElement('div'); d.id = 'errbox'; d.textContent = 'Failed to start: ' + e.message; document.body.appendChild(d); });
