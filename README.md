# Summit Dash: Phase 0 Prototype (spec v1.2)

A playable browser prototype: **1 human and 4–9 bot rivals** race up a stylized, warm-lit low-poly
mountain. The 200-tile board is the exact seeded layout from §3. The dice are real cannon-es physics,
but every outcome comes from the rules engine (Law 2). There is no monetization of any kind.

## Run it
```bash
cd summit-dash
python3 -m http.server 8000      # any static server works; ES modules need http(s), not file://
open http://localhost:8000/
```
- **Single-file preview:** `preview/index.html` has all of the game's own JS and CSS inlined. Three.js and cannon-es load from the pinned jsDelivr importmap. It runs inside `<iframe sandbox="allow-scripts">` without `allow-same-origin`. There, localStorage is blocked, so the season simply isn't saved.
- **Rules tests and pacing sim:** `node tests/rules.test.js [seasons=1000]` (Node ≥ 18, no dependencies).
- **Rebuild the preview:** `npm i -D esbuild && node tools/build-preview.mjs`
- **Browser smoke test:** `pip install playwright`, then `python3 tools/browser_test.py http://localhost:8765/index.html [desktop|mobile|both]` and `python3 tools/preview_test.py <wrapper-url>`. Both use system Chromium at `/usr/bin/chromium` with SwiftShader WebGL.

## How to play
- **ROLL** (or Space) spends a throw. The engine rolls, the die tumbles and lands on that value, and your climber hops tile by tile.
- **Fate Cards** flip in 3D. Options with no valid target are greyed out with the reason shown. If a card is left with only pure penalties because targets are missing, it is redrawn once.
- **Route Fork** (65): choose a Safe or Risky route. **Base Camps** (40/80/120/160) are fall floors and give +1 throw the first time you reach or pass them.
- **Hand** (max 3): tap a card to play it. 🛡️ Shield is passive and auto-blocks. Change Shield mode (Auto / Players only) in ⚙️.
- **End Day ▸** stands in for real days passing. Bots play their sessions, the clock moves to the next day, throws refresh (+5 up to 8), and the morning bots act. Anything that hit you shows up in a "While you were away" digest.
- **Storm Pot** meter (top bar): when it fills you get an eruption cinematic (☀️ Sunbreak / 🌩️ Whiteout / 🌈 Windfall).
- **Side panel** (👥 on mobile): Squad leaderboard with 💤 dormant / 🔰 protected / ✨ immune / 👻 ghost / 🏆 badges, the live Feed with emoji reactions, Fairness (your histogram against the ±2σ band, plus Squad and Lifetime views), and Rules.
- **⚙️ → Auto-play rest of season** fast-forwards to the season end screen: ranking, Season Points, lifetime rank, and a recap card.
- **🗺️** toggles a slow-orbit overview of the whole mountain.

Setup lets you pick squad size (5–10 total, default 8), your handle, an optional seed (same seed gives the same season), and the 30-second tutorial (one roll, one Fate Card).

## Bots
They use the same engine API as the human. Each has a personality:
- **Greedy**: highest expected throws or tiles; takes the Risky route.
- **Saboteur**: prefers options that target rivals, and uses Magnet right away.
- **Cautious**: avoids variance, takes the Safe route, values Shields.

About a third of bots are **casual** and play on roughly 70% of days, so you will see dormancy.

## Files
```
index.html  styles.css  package.json
src/board.js  rng.js  cards.js  engine.js   ← portable rules core (no DOM, no Math.random, no Date)
src/bots.js  season.js                      ← clients + prototype scheduler
src/scene.js  dice.js  ui.js  audio.js  main.js ← render / UI
tests/rules.test.js  tests/last-run.txt
tools/build-preview.mjs  browser_test.py  preview_test.py
preview/index.html   shots/*.png   ARCHITECTURE.md
```

## Interpretations & deviations from the spec
These are the places where the spec was silent or ambiguous. Each one is a single switch in `engine.js` or `cards.js`.
1. **Simulated time.** One shared clock: you play at 09:00 each simulated day, and bots log in at random hours between 06:00 and 23:00. Per-member timezone refresh is a port item (see ARCHITECTURE.md). The 20 h minimum between refreshes is enforced.
2. **Frostbite** with throws in hand sets `frozenNext`: your next roll request uses up the throw without rolling and feeds the Pot. With 0 throws it sets `frostbitePending`, and the next throw gained from any source (including the daily refresh) is consumed.
3. **Second Chance** is *armed* before a roll. The server then rolls twice and keeps the better result, and both dice are shown. A true after-the-fact reroll would mean undoing a tile that had already resolved.
4. **"Harsh set"** isn't defined in the spec. It is taken as Avalanche, Tollkeeper, Collapsing Bridge, Frozen Pass and Thief (every option costs you). For protected players, The Last Stand replaces one of these (picked per member at season start) in their deck.
5. **Fate deck:** each member has a shuffled 14-card deck that reshuffles when exhausted (§13 "fateDeck per member draw state").
6. **Pay-to-choose options** (pay 1 or 2 throws, feed 2) are greyed out when you don't have enough throws.
7. **Targets:** summited players can't be targeted. Steal and throw-loss targets need at least 1 throw. The Swap card skips protected targets only when they would lose throws. Alliance (a gift) needs a valid target but doesn't trigger immunity.
8. **Shield:** also blocks the victim side of Avalanche (b), since that is a throw loss inflicted by a player. It does not block your own duel loss as the challenger, or the Shortcut-card tumble (both are self-chosen).
9. **Streaks:** +1 random card at each multiple of 3 consecutive rolling days, and +2 throws on day 7 of a streak.
10. **Card movement that passes the Fork** (Boost, Alliance, Duel, swaps) still prompts the fork choice, but the destination never resolves. Risky then just jumps +6.
11. **Storm Call (a)** adds 4 to the Pot count (double) but credits 2 throws toward Windfall contributions.
12. **Recap metrics:** Comeback = biggest improvement from worst daily rank (day ≥ 2) to final rank. Betrayals = harmful targeted actions you started. Luckiest roll = biggest net tile gain from a single roll, chains included.
13. **Push notifications** are shown as in-app toasts and banners. The "≥4 unspent throws" warning appears under the ROLL button and in the End Day confirm.
14. Bot emoji reactions use `Math.random`. They are cosmetic only and never reach the engine's RNG or outcomes.

## Known issues / limits
- WebGL needs a GPU or SwiftShader. In headless SwiftShader it runs at about 5 fps; on real hardware it is smooth. If measured fps stays under 26 on High, the app drops to performance mode (pixel ratio 1, no shadows).
- Fonts (Outfit) and the 3D libraries load from CDNs, so the first load needs a network connection.
- Emoji tile icons depend on the platform's emoji font.
- Multiplayer, auth, real push notifications and cosmetics are out of scope for Phase 0.
