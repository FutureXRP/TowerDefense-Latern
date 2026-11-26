# Lanternwatch roadmap: from prototype to full app

Work through the phases in order. Each phase ends with the game fully playable and deployed. Read `CLAUDE.md` first: the owner decisions, gotchas and balance targets there apply to every phase.

---

## Phase 0: Ship the prototype (one session)

- [ ] Push this repo to GitHub as-is.
- [ ] Enable GitHub Pages: Settings → Pages → Deploy from branch → `main` / root. The game is live at `https://<user>.github.io/lanternwatch/`.
- [x] Add `og:title`, `og:description`, a favicon (a small lantern SVG) and a `<meta name="theme-color">`.

**Done when:** the Pages URL loads and plays on desktop and phone.

---

## Phase 1: Restructure into a real codebase (no gameplay changes)

Goal: same game, same feel, but organized so features can be added safely.

- [ ] Vite + TypeScript, no framework (Canvas 2D + light DOM). Suggested layout:
  ```
  src/
    core/        // pure logic, no DOM: data.ts (MAPS, TOWERS, FOES, BOONS, POWERS), path.ts, state.ts,
                 // waves.ts, combat.ts (hurt, pick, autoScore, fire), step.ts, powers.ts, rng.ts
    render/      // map.ts, towers.ts, foes.ts, fx.ts, ambient.ts (fireflies, night, portal)
    ui/          // hud.ts, shop.ts, panel.ts, powers.ts, modals.ts, banner.ts, input.ts
    audio/       // sfx.ts (the current WebAudio blips)
    main.ts
  tools/sim.ts   // port of tools/sim.mjs importing core directly
  tests/
  ```
- [ ] Strong types for game state (`GameState`, `Tower`, `Enemy`, `Shot`, `Fx`, `GameEvent` as a discriminated union).
- [ ] **Seeded RNG** (e.g. mulberry32) for all core randomness. `newGame(map, seed)` must give identical runs for identical inputs.
- [ ] Vitest unit tests for core: path math, damage/armor/fireproof, targeting rules (Auto skips hidden Shades; Kilns skip flyers and Imps), boon effects, power effects, wave composition.
- [ ] Determinism test: same seed and same scripted actions give the same final state hash.
- [ ] Balance sim as a test: fail CI if Easy/Medium/Hard drift outside the targets in `CLAUDE.md`.
- [ ] Playwright smoke test at 1300×820, 700×760 and 390×844: pick a map, build, upgrade, sell, start a wave from the top bar (single click must work), use every power, no console errors.
- [ ] GitHub Actions: lint, typecheck, test, build, deploy to Pages.
- [ ] Remove the `arguments[10]` hack in `drawFoe` (pass an options object).

**Done when:** the deployed build is indistinguishable from the prototype, and all tests pass in CI.

---

## Phase 2: Persistence, settings and progression

- [ ] **Save and resume** a run (serialize `GameState` to localStorage between waves; "Continue" on the menu).
- [ ] **Settings screen:** master/SFX volume, default game speed, screen shake on/off, reduced motion, colorblind-safe health bars and range colors, show/hide tips.
- [ ] **Star ratings per map:** 1 star = win, 2 = 10+ lives left, 3 = no lives lost. Stars shown on map cards.
- [ ] **Unlocks:** stars unlock later maps and a "Heroic" modifier (+25% enemy HP, fewer starting lives).
- [ ] **Stats page:** runs, wins, best endless wave per map, total foes defeated, favorite tower.
- [ ] **Pause menu** with Resume / Restart / Settings / Quit to maps.

---

## Phase 3: Depth

- [ ] **Tower specializations at level 4.** Each tower branches into one of two forms (owner's favorite idea). Starting proposal:
  - Quill Spire → **Longshot** (huge range, big single hits, prioritizes bosses) or **Volley** (fires 3 bolts at once)
  - Ember Kiln → **Inferno** (leaves burning ground that damages over time) or **Siege Kiln** (slower, huge splash, shreds armor)
  - Frost Chime → **Glacier Bell** (brief freeze every 4th pulse) or **Shatter Bell** (chilled foes take +25% damage from all towers)
  - Storm Coil → **Tempest** (12 jumps, weaker per jump) or **Arc Lance** (single massive bolt that stuns)
  - Watch Lantern → **Beacon** (bigger radius, reveals hidden Shades so aimed shots can hit them) or **Treasury Lamp** (+1 gold per kill in its glow)
- [ ] **Three new maps:** two entrances that merge; a crossing road (towers cover both passes); a map where flyers take their own straight-line route.
- [ ] **Daily Challenge:** one fixed seed, map and starting boons per day; local best score. (Optional online leaderboard in Phase 5.)
- [ ] **Early-call bonus:** starting the next wave before the current one ends grants bonus gold.
- [ ] **Tutorial:** waves 1–3 of Willow Bend with gentle callouts (place a tower, start the wave, upgrade, use a power). Skippable, shown once.

---

## Phase 4: Presentation

- [ ] **Music:** an ambient night loop for normal waves and a tense layer for boss waves, with crossfade. (Generated or licensed; ElevenLabs is an option for SFX and music.)
- [ ] **Richer sound effects:** replace the WebAudio blips with real sound files, with variation and pitch randomization.
- [ ] **Art upgrade:** hand-painted sprites or a consistent vector style for towers (3 visual tiers each), foes (with walk cycles) and map tiles. Keep the current procedural drawing as a fallback until every sprite exists.
- [ ] **Title screen** with animated lanterns and fog; illustrated map cards.
- [ ] **Juice pass 2:** coins that fly to the gold counter, hit sparks per damage type, a boss entrance cinematic (a 1-second camera zoom), victory fireworks.
- [ ] **Accessibility:** full keyboard play, screen-reader labels on all controls, respect `prefers-reduced-motion`.

---

## Phase 5: App packaging and online

- [ ] **PWA:** manifest, icons, service worker for offline play, "Install" prompt.
- [ ] **Landscape-first mobile layout:** board fills the screen, build menu as a bottom drawer, drag-to-build on touch.
- [ ] Optional: wrap with Capacitor for the App Store and Google Play.
- [ ] Optional: **online leaderboards** for Daily Challenge and endless mode (Supabase), with server-side validation by replaying the seeded run.

---

## First prompt to give Claude Code

> Read CLAUDE.md and docs/ROADMAP.md. Do Phase 0 now: add the favicon, social meta tags and theme color to index.html, and confirm the page works when served statically. Then plan Phase 1 in detail (file-by-file), and wait for my go-ahead before restructuring. Run `node tools/sim.mjs` before and after any change, and show me both outputs.
