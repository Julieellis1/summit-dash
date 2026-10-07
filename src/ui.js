// DOM UI layer: HUD, panels, modals, cinematics. Reads engine *views*; never decides outcomes.
import { FATE_CARDS, SPECIAL_CARDS } from './cards.js';
import { TILE_INFO, T, zoneOf, CONST, CAMPS } from './board.js';

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HUMAN = 'you';

export function toast(text, cls = '', ms = 3000) {
  const t = document.createElement('div'); t.className = `toast ${cls}`; t.innerHTML = text;
  const box = $('#toasts'); box.appendChild(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => t.remove(), ms + 200);
}
export function rollNumber(v, sub = '') {
  const d = document.createElement('div'); d.className = 'rollnum'; d.innerHTML = `${v}${sub ? `<small>${sub}</small>` : ''}`;
  document.body.appendChild(d); setTimeout(() => d.remove(), 1200);
}

export function nameOf(view, id) { return view.members.find((m) => m.id === id)?.name ?? id; }
export function colorOf(view, id) { return view.members.find((m) => m.id === id)?.color ?? '#ccc'; }
const av = (m) => `<div class="av" style="background:${m.color}">${esc(m.name[0] || '?')}</div>`;

export function fmtFeed(entry, view) {
  let t = esc(entry.text);
  const nm = (id, cap) => {
    if (id === HUMAN) return `<span class="nm" style="color:#ffd166">${cap ? 'You' : 'you'}</span>`;
    return `<span class="nm" style="color:${colorOf(view, id)}">${esc(nameOf(view, id))}</span>`;
  };
  if (entry.a === HUMAN) {
    t = t.replace('{a}&#39;s', '<span class="nm" style="color:#ffd166">Your</span>')
      .replace('{a} has gone', '{a} have gone').replace('{a} is back', '{a} are back').replace('lose their next', 'lose your next');
  }
  return t.replace(/\{a\}&#39;s/g, () => `${nm(entry.a, true)}'s`).replace(/\{a\}/g, () => nm(entry.a, true)).replace(/\{b\}/g, () => nm(entry.b, false));
}
export const clockLabel = (h) => { const d = Math.floor(h / 24) + 1; const hh = Math.floor(h % 24); const mm = Math.floor((h % 1) * 60); return `D${d} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };

// ───────── HUD ─────────
export function renderHud(view, { busy }) {
  const me = view.me;
  $('#dayLabel').innerHTML = view.sprintEndsAt != null && !view.over
    ? `Day ${view.day} / ${view.maxDays} · <span class="sprint">Final sprint → ${clockLabel(view.sprintEndsAt)}</span>`
    : `Day ${view.day} / ${view.maxDays}`;
  const p = view.pot; const pct = Math.min(100, (100 * p.count) / p.threshold);
  $('#potNum').textContent = `${p.count} / ${p.threshold}`; $('#potFill').style.width = `${pct}%`;
  $('#pot').classList.toggle('hot', pct >= 75);
  // pips
  const pips = $('#throwPips'); let html = '';
  for (let i = 1; i <= CONST.HARD_CAP; i++) { if (i === CONST.SOFT_CAP + 1) html += '<span class="pip-sep"></span>'; html += `<span class="pip ${i <= me.throws ? 'on' : ''} ${i > CONST.SOFT_CAP ? 'bonus' : ''}"></span>`; }
  pips.innerHTML = html; pips.title = `${me.throws} throws banked (soft cap ${CONST.SOFT_CAP}, hard cap ${CONST.HARD_CAP})`;
  $('#rollCnt').textContent = me.throws;
  const can = !busy && !view.over && me.summitAt == null && me.throws > 0 && !view.pending;
  const rb = $('#rollBtn'); rb.disabled = !can; rb.classList.toggle('pulse', can);
  $('#armed').textContent = `${me.armed.double ? '⚡' : ''}${me.armed.second ? '🎲' : ''}`;
  let sub = '';
  if (me.summitAt != null) sub = '🏆 Summited — cheer on your squad';
  else if (me.frozenNext > 0) sub = `❄️ Next throw is frozen`;
  else if (me.frostbitePending) sub = `❄️ Frostbite pending — next throw gained is lost`;
  else if (me.throws === 0) sub = 'Out of throws — End Day to refresh';
  else if (me.throws >= 4) sub = `Bank ${me.throws}: refresh only tops up to ${CONST.SOFT_CAP}`;
  else sub = `${me.throws} throw${me.throws === 1 ? '' : 's'} left today`;
  $('#rollSub').textContent = sub;
  const eb = $('#endDayBtn'); eb.disabled = busy || view.over; eb.textContent = view.day >= view.maxDays ? 'Finish Season ▸' : 'End Day ▸';
  // status
  const z = zoneOf(me.tile);
  $('#status').innerHTML = `<div><span class="big">Tile ${me.tile}</span> <span class="zone">${z.name}</span></div>
    <div class="sub">${z.mood} · rank #${view.members.find((m) => m.id === HUMAN).rank} of ${view.members.length}</div>
    <div>${me.floor > 1 ? `<span class="chip">⛺ Floor ${me.floor}</span>` : '<span class="chip">⛺ No camp yet</span>'}
    ${me.routeChoice ? `<span class="chip">🔀 ${me.routeChoice === 'safe' ? 'Safe' : 'Risky'} route</span>` : ''}
    ${me.protected ? '<span class="chip" title="Bottom 25%: other players cannot take your throws">🔰 Protected</span>' : ''}
    ${me.immune ? `<span class="chip" title="Immune to player targeting">✨ Immune</span>` : ''}
    ${me.frozenNext > 0 || me.frostbitePending ? '<span class="chip ice">❄️ Frostbite</span>' : ''}</div>`;
}

export function renderHand(view, onCard, busy) {
  const me = view.me; const box = $('#hand'); let html = '';
  for (let i = 0; i < CONST.HAND_MAX; i++) {
    const c = me.cards[i];
    if (!c) { html += `<div class="hcard empty"><span class="e" style="opacity:.35">🂠</span><span class="nm">empty</span></div>`; continue; }
    const d = SPECIAL_CARDS[c];
    html += `<button class="hcard ${d.passive ? 'passive' : ''}" data-card="${c}" ${busy || view.over ? 'disabled' : ''} title="${esc(d.name + ' — ' + d.text)}"><span class="e">${d.icon}</span><span class="nm">${d.name}</span></button>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', () => onCard(b.dataset.card)));
}

export function renderSquad(view) {
  const rows = view.members.map((m) => {
    const badges = [];
    if (m.summitAt != null) badges.push('<span class="badge sum">🏆 Summit</span>');
    if (m.dormant) badges.push('<span class="badge dormant">💤 Dormant</span>');
    if (m.protected) badges.push('<span class="badge prot" title="Bottom 25% — cannot lose throws to players">🔰 Protected</span>');
    if (m.ghost) badges.push('<span class="badge imm">👻 Ghost</span>');
    else if (m.immuneHours > 0) badges.push(`<span class="badge imm" title="Immune to player targeting">✨ Immune ${Math.ceil(m.immuneHours)}h</span>`);
    if (m.frozen) badges.push('<span class="badge">❄️</span>');
    const pers = m.isBot ? ` · ${m.personality}` : '';
    return `<div class="lb-row ${m.id === HUMAN ? 'me' : ''}">
      <div class="rk">${m.rank}</div>${av(m)}
      <div class="lb-name"><b>${esc(m.name)}${m.id === HUMAN && m.name.toLowerCase() !== 'you' ? ' (you)' : ''}</b><small>⛺${m.floor}${pers}</small>
        <div class="bar"><i style="width:${(m.tile / 2).toFixed(1)}%"></i></div>${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}</div>
      <div class="lb-stats"><b>${m.tile}</b><br><span title="throws">🎲${m.throws}</span> <span title="cards">🃏${typeof m.cards === 'number' ? m.cards : m.cards.length}</span></div></div>`;
  }).join('');
  $('#pane-squad').innerHTML = rows + `<div class="legend">🔰 Protected = bottom ${view.protectedCount} active climbers (can't lose throws to rivals, get The Last Stand). ✨ Immune = targeted in the last 24h. 💤 Dormant = 2 days without rolling (untargetable, excluded from counts).</div>`;
}

const REACTS = ['😂', '🔥', '😱', '👏', '😈', '🫡'];
export function renderFeed(feed, view, onReact) {
  const items = feed.slice(-120).reverse().map((e) => {
    const mine = e.a === HUMAN || e.b === HUMAN;
    const r = Object.entries(e.reactions || {}).filter(([, l]) => l.length).map(([em, l]) => `<button data-id="${e.id}" data-em="${em}" class="${l.includes(HUMAN) ? 'on' : ''}">${em} ${l.length}</button>`).join('');
    return `<div class="feed-item ${mine ? 'mine' : ''}"><div class="ic">${e.icon}</div><div>${fmtFeed(e, view)}
      <div class="meta">${clockLabel(e.t)} <span class="reacts">${r}<button data-pick="${e.id}" title="React">+ 🙂</button></span></div></div></div>`;
  }).join('');
  const pane = $('#pane-feed'); pane.innerHTML = items;
  pane.querySelectorAll('[data-em]').forEach((b) => b.addEventListener('click', () => onReact(+b.dataset.id, b.dataset.em)));
  pane.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const p = document.createElement('span'); p.className = 'react-pick';
    p.innerHTML = REACTS.map((em) => `<button>${em}</button>`).join('');
    p.querySelectorAll('button').forEach((x) => x.addEventListener('click', () => onReact(+b.dataset.pick, x.textContent)));
    b.replaceWith(p);
  }));
}

export function renderFairness(eng, lifetime, mode = 'you') {
  const me = eng.m(HUMAN);
  const sets = {
    you: { label: 'Your rolls this season', counts: me.stats.rolls.slice(1) },
    squad: { label: 'Whole squad this season', counts: [1, 2, 3, 4, 5, 6].map((f) => eng.all.reduce((s, m) => s + m.stats.rolls[f], 0)) },
    life: { label: 'Your lifetime rolls', counts: [1, 2, 3, 4, 5, 6].map((f, i) => (lifetime?.[i] || 0) + me.stats.rolls[f]) },
  };
  const s = sets[mode]; const n = s.counts.reduce((a, b) => a + b, 0);
  const exp = n / 6; const sd = Math.sqrt(n * (1 / 6) * (5 / 6)); const lo = Math.max(0, exp - 2 * sd), hi = exp + 2 * sd;
  const maxY = Math.max(4, hi * 1.1, ...s.counts);
  const W = 300, H = 170, pad = 24, bw = 30; const y = (v) => H - pad - (v / maxY) * (H - pad - 10);
  let svg = `<svg class="fair-svg" viewBox="0 0 ${W} ${H}">`;
  svg += `<rect x="${pad}" y="${y(hi)}" width="${W - pad - 6}" height="${Math.max(1, y(lo) - y(hi))}" fill="rgba(126,224,138,0.18)" rx="4"/>`;
  svg += `<line x1="${pad}" x2="${W - 6}" y1="${y(exp)}" y2="${y(exp)}" stroke="rgba(126,224,138,0.9)" stroke-dasharray="4 4"/>`;
  s.counts.forEach((c, i) => {
    const x = pad + 10 + i * ((W - pad - 20) / 6);
    const inBand = c >= lo - 1e-9 && c <= hi + 1e-9;
    svg += `<rect x="${x}" y="${y(c)}" width="${bw}" height="${H - pad - y(c)}" rx="6" fill="${inBand ? 'url(#g1)' : '#ff7a7a'}"/>`;
    svg += `<text x="${x + bw / 2}" y="${y(c) - 4}" text-anchor="middle" font-size="11" fill="#fff" font-weight="700">${c}</text>`;
    svg += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="rgba(255,255,255,.75)">${i + 1}</text>`;
  });
  svg += `<defs><linearGradient id="g1" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffd07a"/><stop offset="1" stop-color="#ff7a3d"/></linearGradient></defs></svg>`;
  const outside = s.counts.filter((c) => c < lo || c > hi).length;
  const verdict = n < 12 ? 'Too few rolls to say anything yet — small samples swing wildly.'
    : outside === 0 ? `All six faces sit inside the expected variation band. That is what fair dice look like at ${n} rolls.`
      : `${outside} face${outside > 1 ? 's' : ''} outside the ±2σ band — with six faces, that happens by chance roughly a quarter of the time at any sample size.`;
  $('#pane-fair').innerHTML = `<div class="seg" id="fairSeg">${Object.entries({ you: 'You', squad: 'Squad', life: 'Lifetime' }).map(([k, v]) => `<button data-f="${k}" class="${k === mode ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div style="margin:10px 2px 2px;font-weight:700">${s.label} · ${n} rolls</div>${svg}
    <div class="fair-note">Dashed line = expected ${exp.toFixed(1)} per face. Green band = normal variation (±2σ: ${lo.toFixed(1)}–${hi.toFixed(1)}). With roughly 50 rolls a season, a face showing up 4 times or 13 times is normal.</div>
    <div class="fair-note"><b style="color:var(--text)">${verdict}</b></div>
    <div class="fair-note">🔒 All dice are identical. Every roll is generated by the game server (here: the rules engine, never the UI) and logged with a timestamp. Cosmetic dice never change results. This tab is private to you.</div>`;
}

export function renderRules() {
  const tiles = [T.SAFE, T.FATE, T.SUPPLY, T.ROCKSLIDE, T.FROSTBITE, T.SHORTCUT, T.THIEF, T.SHRINE, T.CAMP, T.FORK, T.SUMMIT].map((k) => `<div class="feed-item"><div class="ic">${TILE_INFO[k].icon}</div><div><b>${TILE_INFO[k].name}</b> — ${TILE_INFO[k].text}</div></div>`).join('');
  const specials = Object.values(SPECIAL_CARDS).map((c) => `<div class="feed-item"><div class="ic">${c.icon}</div><div><b>${c.name}</b> — ${c.text}</div></div>`).join('');
  $('#pane-rules').innerHTML = `<div class="fair-note" style="color:var(--text)"><b>Race to tile 200.</b> 5 throws a day (bank up to 8; bonuses up to 12). Base Camps at ${CAMPS.join(' / ')} are floors: nothing involuntary drops you below your last camp. Voluntary retreats (Fate choices) bypass floors. First summit starts a 24h final sprint; the season also ends after day 12.</div>
  <div class="fair-note">Storm Pot: sacrificed & penalty throws feed it. At max(8, 2 × active climbers) it erupts: ☀️ Sunbreak 40% · 🌩️ Whiteout 35% · 🌈 Windfall 25%.</div>${tiles}<div style="height:8px"></div>${specials}
  <div class="fair-note">Free to play, forever. Nothing that affects outcomes can ever be bought.</div>`;
}

// ───────── modals ─────────
export function modal(inner, { cls = 'sheet', dismiss = false } = {}) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="${cls}">${inner}</div>`;
  $('#modal-root').appendChild(back);
  const close = () => back.remove();
  if (dismiss) back.addEventListener('click', (e) => { if (e.target === back) close(); });
  return { root: back, close };
}
export function confirmBox(title, text, ok = 'OK', cancel = 'Cancel') {
  return new Promise((res) => {
    const m = modal(`<h2>${title}</h2><p>${text}</p><div class="btn-row"><button class="btn primary" data-ok>${ok}</button><button class="btn" data-no>${cancel}</button></div>`);
    m.root.querySelector('[data-ok]').onclick = () => { m.close(); res(true); };
    m.root.querySelector('[data-no]').onclick = () => { m.close(); res(false); };
  });
}

export function showFate(pending, view, sfx) {
  const def = FATE_CARDS[pending.card];
  return new Promise((resolve) => {
    const opts = pending.options.map((o) => {
      const tags = [o.harm ? '🎯 targets a rival' : '', o.risky ? '🎲 risky' : '', o.target === 'auto' ? '→ nearest valid player ahead' : ''].filter(Boolean).join(' · ');
      return `<button class="opt" data-opt="${o.id}" ${o.enabled ? '' : 'disabled'}><span class="L">${o.id.toUpperCase()}</span><span>${esc(o.text)}${tags ? `<span class="tags">${tags}</span>` : ''}${o.enabled ? '' : `<span class="why">${esc(o.reason)}</span>`}</span></button>`;
    }).join('');
    const m = modal(`<div class="card-stage"><div class="card3d" id="c3d">
      <div class="face front"><div class="card-art"><span class="num">FATE ${def.n} / 15</span>${def.art}</div>
        <div class="card-title">${def.title}</div><div class="card-flavor">${esc(def.flavor)}${pending.redrawn ? ' · (redrawn)' : ''}</div>
        <div id="opts">${opts}</div><div id="tgts"></div></div>
      <div class="face back"><div class="sig">🟣</div><div class="sig2">FATE CARD</div></div></div></div>`, { cls: '' });
    sfx?.whoosh();
    requestAnimationFrame(() => setTimeout(() => m.root.querySelector('#c3d').classList.add('flipped'), 60));
    m.root.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
      sfx?.click();
      const o = pending.options.find((x) => x.id === b.dataset.opt);
      if (o.target !== 'pick') { m.close(); resolve({ option: o.id, target: null }); return; }
      const box = m.root.querySelector('#tgts');
      box.innerHTML = `<div class="small" style="margin-top:12px">Choose a target for ${o.id.toUpperCase()}:</div><div class="targets">${o.targets.map((id) => {
        const t = view.members.find((x) => x.id === id);
        return `<button class="tgt" data-t="${id}">${av(t)}<span><b>${esc(t.name)}</b><small>tile ${t.tile} · 🎲${t.throws}</small></span></button>`;
      }).join('')}</div>`;
      box.querySelectorAll('[data-t]').forEach((tb) => tb.addEventListener('click', () => { m.close(); resolve({ option: o.id, target: tb.dataset.t }); }));
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
  });
}

export function showFork(sfx) {
  return new Promise((resolve) => {
    sfx?.whoosh();
    const m = modal(`<h2>🔀 The Route Fork</h2><p>You've reached tile 65. Pick your line through tiles 66–90 — this choice is once per season.</p>
      <div class="fork-grid">
        <button class="fork-card safe" data-c="safe"><div class="e">🛤️</div><b>Safe Route</b><span>Your landing tile resolves normally. In 66–90, Rockslides, Frostbite and Thief's Ledges are treated as Safe.</span></button>
        <button class="fork-card risky" data-c="risky"><div class="e">🧗</div><b>Risky Route</b><span>Jump +6 now (the destination resolves instead). In 66–90, every Safe tile becomes a Fate Card draw.</span></button>
      </div>`);
    m.root.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { m.close(); resolve(b.dataset.c); }));
  });
}

export async function eruptionCinematic(kind, text, { reduced } = {}) {
  const box = $('#eruption');
  const meta = { sunbreak: ['☀️', 'SUNBREAK', 'Everyone +1 throw'], whiteout: ['🌩️', 'WHITEOUT', 'Everyone slides back 2 (camp floors hold)'], windfall: ['🌈', 'WINDFALL', text || 'Top Pot contributor +3 throws'] }[kind];
  box.className = kind;
  box.innerHTML = `<div class="storm-bolt"></div><div class="flash"></div><div class="title"><small>THE STORM POT ERUPTED</small><span class="e">${meta[0]}</span><h1>${meta[1]}</h1><p>${esc(meta[2])}</p></div>`;
  await sleep(reduced ? 1400 : 3000);
  box.className = 'hidden'; box.innerHTML = '';
}

export function showEnd(view, { lifetimeSP, rankName, spEarned }, onNew, onView) {
  const r = view.results; const rc = view.recap;
  const byId = (id) => view.members.find((m) => m.id === id);
  const pod = [r[1], r[0], r[2]].map((x, i) => x ? `<div class="pod ${i === 1 ? 'p1' : ''}"><div class="medal">${['🥈', '🥇', '🥉'][i]}</div>${av(byId(x.id))}<b>${esc(x.name)}</b><div class="small">tile ${x.tile}${x.summitAt != null ? ' · 🏆' : ''}</div></div>` : '<div></div>').join('');
  const rows = r.map((x) => `<tr class="${x.id === HUMAN ? 'me' : ''}"><td>${x.rank}</td><td>${esc(x.name)}${x.dormant ? ' 💤' : ''}${x.summitAt != null ? ' 🏆' : ''}</td><td class="n">${x.tile}</td><td class="n">${x.throws}</td><td class="n"><b>${x.sp}</b></td></tr>`).join('');
  const nm = (o) => (o ? esc(byId(o.id)?.name ?? '—') : '—');
  const cell = (k, v, d) => `<div class="recap-cell"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  const me = r.find((x) => x.id === HUMAN);
  const m = modal(`<div class="hero"><div class="tag">SEASON COMPLETE · ${view.endReason === 'sprint' ? 'FINAL SPRINT ENDED' : 'DAY 12 CAP'}</div><h1>${me.rank === 1 ? 'YOU WIN!' : `YOU FINISHED #${me.rank}`}</h1>
    <div class="small">+${me.sp} Season Points · lifetime ${Math.round(lifetimeSP)} SP · rank <b style="color:var(--amber)">${rankName}</b></div></div>
    <div class="podium">${pod}</div>
    <table class="results"><thead><tr><th>#</th><th>Climber</th><th class="n">Tile</th><th class="n">Banked</th><th class="n">SP</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="recap"><h3>⛰️ SEASON RECAP · SUMMIT DASH</h3><div class="recap-grid">
      ${cell('Biggest comeback', nm(rc.comeback), rc.comeback ? `climbed from #${rc.comeback.from} to #${rc.comeback.to}` : 'no comebacks this time')}
      ${cell('Most betrayals', nm(rc.betrayals), rc.betrayals && rc.betrayals.count ? `${rc.betrayals.count} targeted moves` : 'a peaceful squad')}
      ${cell('Luckiest roll', nm(rc.luckiest), rc.luckiest ? `rolled ${rc.luckiest.value} → +${rc.luckiest.gained} tiles on day ${rc.luckiest.day}` : '—')}
      ${cell('Top Pot contributor', nm(rc.potTop), rc.potTop ? `fed ${rc.potTop.count} throws · ${rc.eruptions} eruption${rc.eruptions === 1 ? '' : 's'}` : '—')}
    </div><div class="small" style="margin-top:10px;color:#fff;opacity:.85">Handles only · sharing outside the squad is opt-in</div></div>
    <div class="btn-row"><button class="btn primary" data-new>New season ▸</button><button class="btn" data-view>View mountain</button></div>`, { cls: 'sheet end' });
  m.root.querySelector('[data-new]').onclick = () => { m.close(); onNew(); };
  m.root.querySelector('[data-view]').onclick = () => { m.close(); onView(); };
  return m;
}
