# CLAUDE.md: Lanternwatch

Project context for Claude Code. Read this fully before changing anything. The phased plan for growing this into a full app is in `docs/ROADMAP.md`.

## What this is

**Lanternwatch** is an original browser tower defense game. Shadow creatures (the Gloom) march out of a fog portal along a road toward a hearth. The player builds and upgrades towers beside the road, picks permanent boons every 5 waves, and fires one-shot powers in emergencies. Survive 30 waves to win, then keep going in endless mode.

It started as a single-file prototype built in Claude chat. The whole game currently lives in `index.html` (about 1,360 lines, no build step, no dependencies besides two Google Fonts). It is fully playable and balance-tested.

**Original IP rule:** names, art and mechanics must stay our own. Do not copy names, characters, art, maps or signature mechanics from Bloons TD, Kingdom Rush, Plants vs. Zombies or any other existing game.

## Owner decisions (do not undo these)

These came from playtesting. Keep them unless the owner says otherwise.

1. **Auto targeting is the default.** The owner found per-tower target management mid-wave "too taxing". Every tower starts in `Auto` mode, which picks targets based on the tower's role and current stats (see `autoScore`). Manual modes (First, Last, Strong, Close) stay available but optional.
2. **Nothing overlays the board where the player builds.** An on-board Start Wave button was removed because it blocked placing and upgrading towers. Start Wave lives in the top bar (it glows while waiting) and in the side panel; Space also starts.
3. **Waves never auto-start unless the player ticks "Auto-start".**
4. **One-shot powers** (Carpet Bomb, Deep Freeze, Thunderhead, Overdrive) sit in a bar directly under the board so they are reachable mid-wave.
5. **Wide foe variety**: 13 enemy types, each forcing a different response, introduced gradually with a "New foe" intro card the first time each appears.
6. **Must work on phones and tablets as well as desktop.**

## Architecture of `index.html`

One `<script>` with two parts:

### 1. CORE (top of the script, between the `CORE (no DOM)` and `END CORE` comment banners)
Pure game logic. **No DOM access.** It runs in Node as-is (that is how `tools/sim.mjs` works). Keep it that way: never touch `document`/`window` in core.

- **Units:** everything is in *tile units*. The grid is `COLS=16 × ROWS=10`; a tile center is `(c+.5, r+.5)`. Rendering multiplies by the tile size `T` in pixels.
- **Time:** fixed step. The UI calls `step(G, 1/60)` repeatedly; game speed (1×/2×/3×) just runs more steps per frame. `G.time` is game time in seconds.
- **State:** one plain object `G` from `newGame(mapIndex)`:
  - `map, path, grid` (grid cell: 0 open, 1 road, 2 rock, 3 tower)
  - `towers[]`, `enemies[]`, `born[]` (spawned mid-step, merged at end of step), `shots[]`, `bombs[]`, `fx[]` (visual-effect records the UI draws)
  - `ev[]`: event queue (`{k:'kill'|'leak'|'wave'|'clear'|'boonOffer'|'win'|'lose'|'power'|'charge'|'summon'|...}`) that the UI drains each frame for sound, toasts, banners and modals
  - `gold, lives, wave, active, q` (spawn queue), `wt` (wave timer)
  - `boon` (array of 3 offered boon ids while a choice is pending), `boons` (id → stack count)
  - `pw` (power id → `{n: charges, cd: cooldown}`), `odU` (overdrive-until time)
  - `dirty`: set when towers/boons change; `step` then recomputes every tower's cached stats `t.s` via `tstats`
- **Key functions:**

| Function | Purpose |
|---|---|
| `buildPath(pts)` | Waypoints → polyline with `at(d)` returning `[x, y, angle]` at distance `d`, plus the set of road tiles |
| `newGame(mi)` | Fresh state for map `mi` |
| `waveDef(w)` / `buildWave(w)` | Wave composition (`[type, count, gap, delay]` groups) → sorted spawn queue |
| `hpMult(w)` | Enemy health scaling per wave |
| `place / upgrade / sell` | Player actions; all validate gold and tiles and return falsy on failure |
| `tstats(G, t)` | A tower's effective stats including Lantern buffs and boons |
| `mk(G, type, d)` | Create an enemy at road distance `d` |
| `hurt(G, e, dmg, pierce, src, kind)` | All damage goes through here (armor, fireproof, kill rewards, Broodmother splitting) |
| `autoScore / pick` | Targeting (Auto plus manual modes; skips hidden Shades; Kilns skip flyers and Imps) |
| `fire(G, t)` | One tower attack (bolt projectile, kiln shell, coil chain, chime pulse) |
| `step(G, dt)` | Advance the simulation one tick |
| `startWave`, `chooseBoon`, `rollBoons` | Wave and boon flow |
| `usePower(G, id, x, y)` | Returns `true` or a short reason string ("Aim at the road", "Still recharging", ...) |

The script ends with `if (typeof module !== 'undefined') module.exports = {...}`. Keep that export list current. The simulator depends on it.

### 2. UI (the IIFE guarded by `typeof document !== 'undefined'`)
Canvas rendering plus DOM panels.

- `drawMap` pre-renders the static map to an offscreen canvas (`renderMap`) on resize/new game.
- `drawTower(c, type, lv, ang, x, y, s, time, buffed, kick)` and `drawFoe(c, type, x, y, s, time, wob, ang, slowed, hit, enraged)` draw everything procedurally with Canvas 2D; there are no image assets. `drawTower` works in tile units (origin at the tile centre) and every level must change the silhouette, not just a colour: taller or wider, with new parts (pennant, chimney, frost, prongs, second lamp). `drawFoe` works in unit space (origin at the foe's centre, 1 unit = its body radius): walkers are mirrored to face their heading, Skitters and Mites are top-down and rotate. Each foe must keep its own silhouette, readable at 23 px tiles. `FICON` sets how each foe is framed in the 28 px icons.
- `render()` draws one frame: map, darkening "night" overlay that deepens with waves, fireflies, portal swirl, lantern glows, ranges, towers (with build pop and recoil), enemies (spawn fade, ice blocks, health bars), shots, fx, aim preview, red leak vignette.
- `syncUI()` updates the DOM panels about 10×/second.
- Input: pointer events on the canvas. Mouse builds on one click; touch needs two taps on the same tile (first tap previews). Keys: `1–5` build, `Q W E R` powers, `Space` start wave, `U` upgrade, `P` pause, `F` speed, `Esc` cancel.
- Modals: map select menu, boon choice, win/lose.
- Sound: tiny WebAudio blips (`snd`), throttled per sound key. There are no audio files.
- Best wave per map is stored in `localStorage` under `lw.best.<mapId>`, wrapped in try/catch.

## Hard-won gotchas

- **Never rewrite a button's text unless it changed.** `syncUI` runs every 100 ms. Rewriting `textContent` on a button between mouse-down and mouse-up made some browsers swallow the click: the owner had to click Start 3–5 times. Always use the `setT(el, value)` helper, which writes only on change. Any new per-tick UI update must do the same.
- **Start Wave fires on `pointerdown`** (with `click` as fallback). `startWave` is a no-op while a wave is running, so double-firing is safe. Do NOT do this for Upgrade or Sell: a double fire would upgrade or sell twice.
- **Small screens:** the layout switches at `max-width: 820px`. The board shrinks to about 23 px tiles on a phone, so overlays on the board must stay small. Toasts move to the bottom of the board on mobile (`.board #toast` needs that extra specificity because the base `#toast` rule comes later in the stylesheet).
- **Narrow windows:** an earlier bug hid the only Start button below the fold. Any essential control must be visible without scrolling at desktop, at 700 px wide, and on a 390 px phone.
- **Kilns can't hit flyers or Cinder Imps.** Kiln bursts and Carpet Bomb hit hidden Shades; aimed shots don't. Bolts already in flight miss a Shade that turns hidden.
- **Damage that should scale with the wave** (Carpet Bomb, Thunderhead) uses `hpMult(wave) * map.hpx` or a percentage of max health, so powers stay relevant late.
- **Randomness** currently uses `Math.random` (boon offers, foe wobble, sparkle jitter). Switch core randomness to a seeded RNG before adding replays, daily challenges or deterministic tests (see roadmap).

## Game design reference (current numbers)

### Maps
| id | Name | Difficulty | Lives | Gold | Enemy HP × |
|---|---|---|---|---|---|
| willow | Willow Bend | Easy | 25 | 240 | 0.85 |
| ford | Crooked Ford | Medium | 20 | 220 | 1.00 |
| narrows | The Narrows | Hard | 15 | 200 | 1.15 |

### Towers (levels 1 / 2 / 3; cost is the price of that level)
| Tower | Role | Lv1 | Lv2 | Lv3 |
|---|---|---|---|---|
| Quill Spire | Fast single target, hits air | 50g, 6 dmg, 2.6 rng, 1.6/s | 65g, 10, 2.9, 1.85/s | 120g, 17, 3.2, 2.3/s |
| Ember Kiln | Splash (ground only, not Imps) | 90g, 16 dmg, splash 0.9, 0.5/s | 125g, 28, 1.05, 0.55/s | 210g, 48, 1.25, 0.62/s |
| Frost Chime | Pulse: damage + slow to all in range | 70g, 2 dmg, 40% slow 1.5s | 90g, 4, 50% 1.7s | 150g, 8, 60% 2s |
| Storm Coil | Chain lightning, ignores armor | 120g, 12 dmg, 3 jumps | 145g, 18, 4 jumps | 240g, 28, 6 jumps |
| Watch Lantern | Support aura (best lantern applies, no stacking) | 100g, +20% dmg, r 1.6 | 120g, +30% dmg, +10% range, r 1.9 | 180g, +45% dmg, +15% range, +15% speed, r 2.3 |

Sell refund is 70% of everything spent on the tower. Armor subtracts flat damage per hit, but a hit always does at least 25% of its damage.

### Foes (base values; health × `hpMult(wave)` × map HP ×)
| Type | Name | HP | Speed | Gold | Lives | Special |
|---|---|---|---|---|---|---|
| gloom | Gloomling | 22 | 1.1 | 4 | 1 | none |
| skitter | Skitter | 12 | 2.0 | 3 | 1 | fast |
| hulk | Hulk | 80 | 0.65 | 10 | 2 | armor 4 |
| moth | Dusk Moth | 24 | 1.35 | 6 | 1 | flies |
| brood | Broodmother | 60 | 0.85 | 8 | 2 | splits into 3 Skitters |
| shade | Shade | 30 | 1.2 | 6 | 1 | hidden 1.2s of every 4.7s (untargetable by aimed shots) |
| mender | Mender | 45 | 0.9 | 9 | 1 | heals foes within 1.6 by 4% max HP/s (bosses 1%) |
| imp | Cinder Imp | 26 | 1.5 | 5 | 1 | fireproof (immune to Kiln, 25% from Carpet Bomb) |
| mite | Mite | 6 | 1.6 | 1 | 1 | comes in swarms of 25–40 |
| rager | Rampager | 90 | 0.75 | 11 | 2 | armor 1, double speed below 50% HP |
| gargoyle | Gargoyle | 60 | 1.0 | 12 | 2 | flies + armor 4 |
| dread | Dreadwarden (boss) | 300 | 0.5 | 120 | 8 | armor 5, slows at half strength |
| queen | Hollow Queen (boss) | 320 | 0.45 | 140 | 8 | armor 3, summons 3 Gloomlings every 5s |

### Waves
- Waves 1–9 and 11–19 are hand-authored, introducing one new mechanic at a time. Waves 10, 20 and 30 are boss waves: Dreadwarden at 10, Hollow Queen at 20, both together at 30. Other waves after 20 follow themed templates by `w % 5`: swarm, armored, air, tricky, mixed.
- `hpMult(w) = 1.145^(w-1)` up to wave 20, then grows ×1.11 per wave. Past wave 30 it adds +6% per wave on top.

### Economy
- Kill gold = base × (1 + 0.03 × (wave − 1)) × (1 + 0.25 × Bounty Ledger stacks)
- Wave clear bonus = 18 + 3 × wave (+ Strongbox interest: 8% of banked gold, capped at 60 per stack)
- Boon choice after every 5th wave (1 of 3, stackable): Tallow Cache, Keeper's Ward, Barbed Quills, Bellows, Deep Rime, Forked Sky, Brighter Wicks, Bounty Ledger, Strongbox, Guild Masons, Spyglass, Armor Breaker.

### Powers
| Power | Effect | Cooldown | Buy price when out of charges |
|---|---|---|---|
| Carpet Bomb (Q) | 9 bombs along 9 tiles of road around the aim point; each deals 30 × hpMult in splash 1.15 | 25s | 80 + 6 × wave |
| Deep Freeze (W) | Every foe frozen 3s (bosses 1.5s) | 30s | 60 + 6 × wave |
| Thunderhead (E) | Hits the 8 healthiest foes for 50% max HP (bosses 18%) | 35s | 100 + 6 × wave |
| Overdrive (R) | All towers attack 2× for 8s | 40s | 90 + 6 × wave |

The player starts with 1 charge of each and gets 1 random free charge every 3 waves.

## Testing

- **Balance:** `node tools/sim.mjs` (options: `--runs N`, `--no-powers`, `--waves`). Run it after ANY change to towers, foes, waves, economy, powers or targeting, and include the before/after output in your summary. Targets:
  - Easy: the bot wins essentially every run
  - Medium: the bot wins most runs (about 4–6 of 6)
  - Hard: the bot wins some runs (about 1–3 of 6)
  - No single wave should take a big bite of lives when every other wave is clean. Use `--waves` to find spikes.
- **Manual check before every commit:** open `index.html` in a browser at desktop width, at about 700 px wide, and at phone width (390 × 844). Start a run, build each tower, upgrade, sell, start a wave from the top bar, and use each power, including aiming Carpet Bomb. The console must stay free of errors.
- Recommended next step: add a Playwright smoke test covering the manual check (see roadmap).

## Conventions

- Ship first, then iterate. Keep the game playable after every commit.
- **Merge finished work straight to `main` without asking** (owner instruction). Once a change passes the sim and the browser check, open a PR and merge it; `main` deploys to GitHub Pages automatically.
- Prefer complete file replacements over scattered patches when rewriting a module.
- One batch commit per working session, with a clear summary of what changed and the sim results.
- Deterministic code for all game math. When randomness matters for replays or tests, use a seeded RNG.
- Keep core logic DOM-free and testable. Rendering and UI must never mutate game rules.
- Every new enemy, tower or power needs: core logic, Auto targeting consideration, procedural art, an intro text (`FOE_TIP` for foes), sim balance check, and mobile visual check.
