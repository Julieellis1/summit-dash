// Season orchestration for the single-device prototype: decides *when* each bot
// "logs in" during a simulated day and drives the engine's scheduler hooks.
// In production this file disappears: real players act in real time and a cron
// job calls engine.advanceDay() at each member's stored-timezone midnight.

import { rngFloat, rngInt } from './rng.js';
import { botTurn } from './bots.js';
import { CONST } from './board.js';

export const HUMAN_HOUR = 9; // the human "opens the app" at 09:00 each simulated day

/** Plan today's bot sessions: [{pid, hour}] sorted by hour. Casual bots play ~70% of days. */
export function planDay(eng, botRng, excludeId = null) {
  const plan = [];
  for (const m of eng.all) {
    if (m.id === excludeId || !m.isBot || m.summitAt != null) continue;
    if (m.casual && rngFloat(botRng) >= 0.7) continue;
    plan.push({ pid: m.id, hour: 6 + rngFloat(botRng) * 17 });
  }
  return plan.sort((a, b) => a.hour - b.hour);
}

/** Run planned bot sessions whose hour lies in [from, to). Returns engine events. */
export function runBots(eng, plan, botRng, from, to) {
  const events = [];
  const dayStart = (eng.state.season.day - 1) * 24;
  for (const p of plan) {
    if (p.done || p.hour < from || p.hour >= to) continue;
    if (eng.state.season.over) break;
    p.done = true;
    const r = eng.advanceClockTo(dayStart + p.hour);
    events.push(...r.events);
    if (eng.state.season.over) break;
    events.push(...botTurn(eng, p.pid, botRng));
  }
  return events;
}

/** Engine-only full season (tests / fast-forward). humanId=null → everyone is a bot. */
export function simulateSeason(eng, botRng, { onDay } = {}) {
  let guard = 0;
  while (!eng.state.season.over && guard++ < 40) {
    const plan = planDay(eng, botRng);
    runBots(eng, plan, botRng, 0, 24);
    if (onDay) onDay(eng);
    if (!eng.state.season.over) eng.advanceDay();
  }
  return eng;
}

export { CONST, rngInt };
