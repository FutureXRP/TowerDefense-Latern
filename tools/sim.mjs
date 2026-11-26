#!/usr/bin/env node
// Lanternwatch balance simulator.
//
// Loads the CORE section straight out of index.html (it is DOM-free and exports
// through module.exports) and lets a simple bot play full runs on every map.
//
//   node tools/sim.mjs                 6 runs per level, bot uses powers
//   node tools/sim.mjs --runs 20       more runs
//   node tools/sim.mjs --no-powers     bot never uses powers
//   node tools/sim.mjs --waves         per-wave lives lost (finds difficulty spikes)
//   node tools/sim.mjs --seed 7        different (still reproducible) random stream
//   node tools/sim.mjs --tier hard     only one tier (easy, medium, hard)
//   node tools/sim.mjs --map willow    only one level, by id
//   node tools/sim.mjs --file path     simulate another copy of the game
//
// Math.random is replaced by a seeded generator, so the same code and the same
// seed always print the same numbers. Any difference between two outputs is a
// real difference in game logic, not luck.
//
// NOTE: this is a reconstruction. The simulator described in CLAUDE.md was not
// in the repo, so the bot here is new and its win rates are a fresh baseline,
// not the numbers the original balance targets were measured with.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const RUNS = +opt('runs', 6), SEED = +opt('seed', 1), USE_POWERS = !flag('no-powers'), SHOW_WAVES = flag('waves');
const FILE = resolve(opt('file', resolve(dirname(fileURLToPath(import.meta.url)), '..', 'index.html')));

function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function loadCore(file) {
  const html = readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const src = scripts.find(s => s.includes('END CORE'));
  if (!src) throw new Error('No CORE script found in ' + file);
  const module = { exports: {} };
  new Function('module', src)(module);
  return module.exports;
}

const C = loadCore(FILE);
const { COLS, ROWS, TIERS, MAPS, TOWERS } = C;
const DT = 1 / 60;

/* ---------- bot ---------- */

const BUILD_ORDER = ['quill', 'quill', 'kiln', 'chime', 'quill', 'coil', 'kiln', 'lantern', 'coil', 'quill', 'coil', 'kiln', 'chime', 'coil', 'lantern', 'quill', 'coil', 'kiln', 'coil', 'quill'];
const BOON_PRIORITY = ['sight', 'mark', 'fork', 'quills', 'ledger', 'interest', 'kiln', 'masons', 'rime', 'glow', 'ward', 'tallow'];

function roadSamples(G) {
  const out = [];
  for (let d = 0; d <= G.path.L; d += .25) { const p = G.path.at(d); if (p[0] >= 0 && p[0] <= COLS) out.push(p); }
  return out;
}
function coverage(samples, x, y, range) {
  let n = 0; for (const p of samples) if (Math.hypot(p[0] - x, p[1] - y) <= range) n++; return n;
}
function bestTile(G, bot, type) {
  const range = TOWERS[type].lv[0].range;
  let best = null, bv = -Infinity;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!C.canPlace(G, c, r)) continue;
    const x = c + .5, y = r + .5;
    let v;
    if (type === 'lantern') {
      v = 0;
      for (const t of G.towers) if (!TOWERS[t.type].support && !(t.s && t.s.buff) && Math.hypot(t.x - x, t.y - y) <= range) v += t.spent;
    } else {
      v = coverage(bot.samples, x, y, range);
      for (const t of G.towers) if (t.type === 'lantern' && Math.hypot(t.x - x, t.y - y) <= TOWERS.lantern.lv[t.lv].range) v *= 1.2;
    }
    v -= (c + r * COLS) * 1e-6; // stable tie-break
    if (v > bv) { bv = v; best = [c, r]; }
  }
  return bv > 0 ? best : null;
}

function spend(G, bot) {
  for (let guard = 0; guard < 40; guard++) {
    const want = Math.min(BUILD_ORDER.length, 3 + Math.floor(G.wave * .6));
    if (G.towers.length < want) {
      const type = BUILD_ORDER[G.towers.length];
      if (G.gold < C.buildCost(G, type)) return;
      const tile = bestTile(G, bot, type);
      if (tile && C.place(G, type, tile[0], tile[1])) { G.dirty = true; continue; }
    }
    // otherwise upgrade: cheapest available upgrade first, attackers before lanterns on a tie
    let pick = null, pc = Infinity;
    for (const t of G.towers) { const c = C.upCost(G, t); if (c != null && c < pc) { pc = c; pick = t; } }
    if (!pick || G.gold < pc) return;
    if (!C.upgrade(G, pick)) return;
  }
}

function usePowers(G, bot) {
  const live = G.enemies.filter(e => !e.dead && e.x >= 0);
  if (!live.length) return;
  const L = G.path.L;
  const lead = live.reduce((a, e) => Math.max(a, e.d), 0) / L;
  const boss = live.some(e => e.f.boss);
  const danger = lead > .8, panic = lead > .9;
  const ok = id => { const p = G.pw[id]; return p.cd <= 0 && (p.n > 0 || (panic && G.gold >= C.powerCost(G, id) + 100)); };
  if ((boss || danger) && ok('overdrive')) C.usePower(G, 'overdrive');
  if (danger && ok('freeze')) C.usePower(G, 'freeze');
  if ((boss || (danger && live.length >= 4)) && ok('thunder')) C.usePower(G, 'thunder');
  if (danger && ok('barrage')) {
    let bd = 0, bn = -1;
    for (const e of live) { let n = 0; for (const o of live) if (Math.abs(o.d - e.d) <= 4) n++; if (n > bn) { bn = n; bd = e.d; } }
    const p = G.path.at(bd);
    C.usePower(G, 'barrage', p[0], p[1]);
  }
}

function playRun(mi, seed) {
  Math.random = mulberry32(seed);
  const G = C.newGame(mi), bot = { samples: null };
  bot.samples = roadSamples(G);
  const lost = new Array(G.map.waves + 1).fill(0);
  while (!G.over && !G.won) {
    if (G.boon) C.chooseBoon(G, BOON_PRIORITY.find(id => G.boon.includes(id)));
    spend(G, bot);
    const before = G.lives;
    if (!C.startWave(G)) break;
    const w = G.wave;
    let ticks = 0;
    while (G.active && !G.over) {
      C.step(G, DT); G.ev.length = 0; G.fx.length = 0;
      if (++ticks % 30 === 0) { if (USE_POWERS) usePowers(G, bot); spend(G, bot); }
      if (ticks > 60 * 900) throw new Error(`wave ${w} on ${G.map.id} did not finish in 15 minutes of game time`);
    }
    lost[w] = before - G.lives;
    if (w >= G.map.waves && !G.over) break;
  }
  return { won: G.won, wave: G.wave, lives: G.lives, lost, kills: G.kills, towers: G.towers.length };
}

/* ---------- report ---------- */

const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
// The three original maps keep the seeds they always had, so their rows stay comparable across versions.
const LEGACY = { willow: 0, ford: 1, narrows: 2 };
const seedFor = (m, mi, i) => SEED * 1000 + (m.id in LEGACY ? LEGACY[m.id] : 3 + mi) * 100 + i;
const ONLY = opt('map', null), TIER = opt('tier', null);

console.log(`Lanternwatch sim | ${RUNS} runs per level | seed ${SEED} | powers ${USE_POWERS ? 'on' : 'off'}`);
const results = [];
TIERS.forEach((t, ti) => {
  if (TIER && TIER !== t.id) return;
  const rows = [];
  MAPS.forEach((m, mi) => {
    if (m.tier !== ti || (ONLY && ONLY !== m.id)) return;
    const rs = []; for (let i = 0; i < RUNS; i++) rs.push(playRun(mi, seedFor(m, mi, i)));
    rows.push([m, rs]); results.push([m, rs]);
  });
  if (!rows.length) return;
  console.log(`\n${t.name.toUpperCase()}`);
  console.log(`${pad('#', 3)}${pad('level', 17)}${lpad('waves', 6)}${lpad('hp x', 7)}${lpad('road', 6)}${lpad('wins', 7)}${lpad('avg lives', 11)}${lpad('min lives', 11)}   waves reached`);
  for (const [m, rs] of rows) {
    const wins = rs.filter(r => r.won).length, L = C.newGame(MAPS.indexOf(m)).path.L;
    console.log(`${pad(m.n + 1, 3)}${pad(m.name, 17)}${lpad(m.waves, 6)}${lpad(m.hpx, 7)}${lpad(Math.round(L), 6)}${lpad(wins + '/' + RUNS, 7)}${lpad(avg(rs.map(r => r.lives)).toFixed(1) + '/' + m.lives, 11)}${lpad(Math.min(...rs.map(r => r.lives)), 11)}   ${rs.map(r => r.wave).join(' ')}`);
  }
});

if (SHOW_WAVES) {
  console.log('\nAverage lives lost per wave (only waves where something leaked)');
  for (const [m, rs] of results) {
    const cells = [];
    for (let w = 1; w <= m.waves; w++) { const a = rs.filter(r => r.wave >= w).map(r => r.lost[w]); const v = a.length ? avg(a) : 0; if (v > 0) cells.push(`w${w}: ${v.toFixed(1)}`); }
    if (cells.length) console.log(`${pad(m.name, 17)}${cells.join('  ')}`);
  }
}
