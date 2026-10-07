# Summit Dash — Prototype Architecture

Phase 0 browser prototype of spec v1.2. The main rule is **Law 2: server-authoritative**. All
outcomes (dice, tile effects, card results, eruptions) are computed in one pure module,
`src/engine.js`. The UI and the bots are clients: they call request methods and animate the
events they get back. Nothing in the render layer generates an outcome.

```
            ┌─────────────────────── "server" (portable) ───────────────────────┐
            │  board.js   tile layout §3 + tuning constants §2                 │
            │  rng.js     seeded sfc32, state is a JSON array                  │
            │  cards.js   Fate/Special card text + static hints                │
            │  engine.js  SummitEngine: rules, validation, events, feed, views │
            └──────────────▲───────────────────────────▲───────────────────────┘
                           │ requestRoll / chooseFate /│ advanceDay / advanceClockTo
                           │ chooseFork / playCard     │ (scheduler hooks)
   ┌───────────── clients ─┴──────────┐     ┌──────────┴──────── prototype-only ─────────┐
   │ main.js  App controller (human)  │     │ season.js  plans when bots "log in" each   │
   │ bots.js  bot rivals (same API)   │     │            simulated day; drives the clock │
   └──────┬───────────────────────────┘     └────────────────────────────────────────────┘
          │ events → animation
   ┌──────▼──────────── render ─────────────────────────────────────────────┐
   │ scene.js  Three.js world: low-poly mountain, 200-tile spiral, climbers,  │
   │           effects, follow camera, snow, fog                              │
   │ dice.js   cannon-es physics die. Lands on the value the engine decided  │
   │ ui.js     DOM HUD / panels / Fate card flip / cinematics / end screen    │
   │ audio.js  WebAudio synth                                                 │
   └──────────────────────────────────────────────────────────────────────────┘
```

## Modules

| File | Role | Depends on |
|---|---|---|
| `src/board.js` | Exact §3 layout (20 rows × 10 tiles, transcribed), camps, fork, zones, constants | – |
| `src/rng.js` | Seeded RNG (splitmix32 seed → sfc32). Serialisable | – |
| `src/cards.js` | 15 Fate Cards and 6 Special Cards: text, `hint`, `penalty`/`harm`/`risky` flags | – |
| `src/engine.js` | `SummitEngine`: every rule in §2–§11, validation, feed, roll log, `view(pid)` | board, rng, cards |
| `src/bots.js` | Bot decisions (greedy / saboteur / cautious). They only call the public API | engine API, rng |
| `src/season.js` | Prototype scheduler: bot login times, the 09:00 human slot, the full-season simulator | bots |
| `src/scene.js` | Three.js scene (render only) | three, OrbitControls |
| `src/dice.js` | Physics dice (render only) | three, cannon-es, RoundedBoxGeometry |
| `src/ui.js`, `src/main.js`, `src/audio.js`, `styles.css` | HUD, controller, sound | – |
| `tests/rules.test.js` | Engine-only tests and pacing simulation (`node tests/rules.test.js [seasons]`) | engine |

### Engine API (the future endpoints)

| Method | Future endpoint | Notes |
|---|---|---|
| `SummitEngine.create({seed, players})` | `createSeason` | Deals 5 throws and 1 random special card to each player, and shuffles each player's Fate deck |
| `requestRoll(pid)` | `POST /roll` | Checks throws > 0, takes 1 off, rolls d6 on the server, moves (reach-or-pass), resolves the tile (chain depth ≤ 2), writes the feed. Returns events |
| `chooseFork(pid, 'safe'\|'risky')` | `POST /fork` | Valid only while a fork is pending |
| `chooseFate(pid, option, target?)` | `POST /fate` | Re-checks options and targets when the choice resolves. A target that is no longer valid **fizzles at no cost** (§8) |
| `playCard(pid, card)` | `POST /card` | Double / Second Chance arm the next roll; Magnet, Boost and Ghost resolve immediately. Shield is passive |
| `setShieldMode`, `react` | `PATCH /member`, `POST /react` | |
| `advanceDay()` | scheduled job | Dormancy, refresh (+5 to soft cap 8, at least 20 h between refreshes), Pot re-check, day-12 end |
| `advanceClockTo(h)` | wall clock | Ends the season when the 24 h final sprint expires |
| `autoResolve(pid)` | timeout policy | Resolves a stale pending choice with the gentlest option that needs no target |
| `view(pid)` | Firestore read projection | Gives other players' hand **counts** only, never their cards |

Every call returns `{ ok, events[], error? }`. Events are typed (`roll`, `move`, `tile`, `camp`,
`pot`, `eruption`, `shield`, `steal`, `fate`, `summit`, `sprint`, `feed`, …). The client uses them
to animate and never derives state from them. `engine.onEvent(fn)` is a hook for tests and audit logging.

### How the "server decides, physics shows" dice work
1. `requestRoll` returns `value` (and `rolls[]` for Second Chance).
2. `dice.js` simulates a throw offline in cannon-es, records each frame, and reads which local face ends up on top.
3. It applies a cube-symmetry quaternion `fix = setFromUnitVectors(normal(value), topFace)`, so the visual mesh is `bodyQuat × fix`. The tumble is real physics, and the face showing at rest is the engine's value. Physics never feeds back into rules.

## Data model (spec §13 → engine state)

The whole season is one JSON document (`engine.state`). It splits cleanly into §13's collections:

| §13 collection | Prototype location | Fields |
|---|---|---|
| `users` | `state.users[uid]` | `timezone`, `tzChangedAt` |
| `squads` | `state.squad` | `id`, `cosmetics[]` |
| `seasons` | `state.season` | `id, day, clock, potCount, potThreshold, potCycle{uid:n}, eruptions[], firstSummitAt, sprintEndsAt, over, endReason, results[], recap, lastRefreshAt{uid}` + **server-only** `state.rng`, `state.seed` |
| `members` (per season) | `state.members[uid]` | `tile, maxTile, throws, cards[], immunityUntil, incoming[] (→ targetCount24h), dormant, dormantDays, frostbitePending, frozenNext, claimedRewards[] ("camp40", "crate11", "fork"), routeChoice, shieldMode, pending, armed{double,second}, summitAt, lastArriveAt, lastRollDay, streak, ghostUntil, stats{…}` |
| `fateDeck` (per member draw state) | `state.members[uid].fateDeck` | `order[], idx, lastStandReplaces, harshNext` |
| `feed[]` | `state.feed` | `{id, t, day, kind, a, b, text, icon, reactions{emoji:[uid]}}` (templated: `{a}`/`{b}` are filled in per viewer) |
| roll audit log | `state.rollLog` | `{seq, t, day, pid, v, why}`. Every d6 is logged ("log all rolls") |

`targetCount24h` from §13 is derived as `incoming.filter(t > now − 24h).length`, so it is a true
rolling window rather than a counter that has to be reset.

## Port path (Firebase Cloud Functions or Supabase)

`engine.js`, `board.js`, `rng.js` and `cards.js` use no DOM, no `Date.now()` and no `Math.random()`,
and have no npm dependencies. Copy them into `functions/src/` unchanged.

**Firebase (Firestore + Functions v2)**
```js
export const roll = onCall(async (req) => {
  const uid = req.auth.uid; const { seasonId } = req.data;
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`seasons/${seasonId}/private/state`);       // server-only doc (rng!)
    const eng = SummitEngine.load((await tx.get(ref)).data());
    eng.advanceClockTo(hoursSinceSeasonStart(Date.now()));          // wall clock → engine clock
    const res = eng.requestRoll(uid);
    if (!res.ok) throw new HttpsError('failed-precondition', res.message);
    tx.set(ref, eng.state);
    for (const m of eng.all) tx.set(db.doc(`seasons/${seasonId}/members/${m.id}`), publicMember(eng, m)); // view projection
    for (const e of res.events.filter((e) => e.type === 'feed')) tx.set(db.doc(`seasons/${seasonId}/feed/${e.entry.id}`), e.entry);
    return { events: res.events };                                 // client only renders
  });
});
```
- **Security rules:** clients may read `members/*` (public projection) and `feed/*` and write nothing. `private/state` holds the RNG state and is unreadable.
- **Rate limit:** enforce ≥ N ms between `roll` calls per uid, in the transaction or with App Check plus a counter.
- **Scheduler:** an hourly Cloud Scheduler job finds members whose stored-tz local midnight just passed and runs their refresh. The prototype calls `advanceDay()` once for the whole squad because everyone shares one simulated clock. Splitting `_refresh(m)` per member is the one structural change the port needs; the 20 h minimum guard is already in place.
- **Push (FCM):** map events to the §11 triggers: `refresh` → throws refreshed; `steal` / `swap` / `duel` with `target` → you were targeted; a rank change between before and after → you were passed; `eruption`; `sprint`. Quiet hours are applied in the sender.
- **RNG:** keep the seeded sfc32 with a secret per-season seed (good for replays and audits), or swap `rngInt` for `crypto.randomInt` inside `_rollD6` only. The roll log keeps either option auditable.

**Supabase:** use the same module in an Edge Function (Deno). Run it inside a `select … for update` transaction on a `seasons.state jsonb` row, with RLS that exposes only views (`members_public`, `feed`).

**Flutter client:** reimplement only the renderer and UI. The event stream contract stays the same.
