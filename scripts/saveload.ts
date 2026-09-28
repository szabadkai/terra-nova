// Headless check of saving and loading. Two AIs play; every few minutes the game is saved, restored
// (directly and through a save file) and compared with the original, then both carry on side by side
// to show the restored economy keeps working. With `sea`, it saves whenever settlers are waiting for,
// or sailing on, a ship instead; with `chain`, one copy is reloaded every `every` minutes for the whole game
// next to an uninterrupted one, and every reload must re-save identically. Usage: npx tsx scripts/saveload.ts [seed] [minutes] [every] [sea|chain]
import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
import { GOODS } from '../src/game/defs';
import { decodeSave, encodeSave, restore, snapshot, type SaveData } from '../src/game/save';
import { callOut, orderMove } from '../src/game/orders';

const seed = Number(process.argv[2] ?? 11), minutes = Number(process.argv[3] ?? 40), every = Number(process.argv[4] ?? 10);
const sea = process.argv[5] === 'sea';
let lastSave = -99;
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
g.ai.push(new AIController(g, 0, 1));
let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) { fails++; console.log('  FAIL', what); } };
const run = (x: Game, sec: number) => { for (let i = 0; i < sec; i++) { x.update(1); x.events.length = 0; } };

function stats(x: Game) {
  return x.players.map((p) => {
    const pop = x.population(p.id);
    const st = x.totalStock(p.id);
    let goods = 0, produced = 0;
    for (const gd of GOODS) { goods += st[gd]; produced += p.produced[gd]; }
    return { pop: pop.total, soldiers: pop.soldiers, buildings: x.countBuildings(p.id, undefined, false), sites: x.countBuildings(p.id) - x.countBuildings(p.id, undefined, false), goods, produced, land: landOf(x, p.id) };
  });
}
function landOf(x: Game, p: number) { let n = 0; for (let i = 0; i < x.world.N; i++) if (x.world.owner[i] === p) n++; return n; }
const fmt = (s: ReturnType<typeof stats>) => s.map((p, i) => `P${i} pop ${p.pop} sol ${p.soldiers} bld ${p.buildings}+${p.sites} goods ${p.goods} made ${p.produced} land ${p.land}`).join(' | ');

/** Everything a save keeps, minus what loading deliberately resets (plans and their reservations). */
function persistent(d: SaveData) {
  const c = structuredClone(d);
  for (const s of c.settlers as unknown as Record<string, unknown>[]) {
    for (const k of ['next', 't', 'pathI', 'anim', 'animT', 'task', 'idle', 'x', 'z', 'node', 'target', 'carrying', 'home', 'sstate', 'stepDur', 'hidden', 'inside', 'voyage', 'voyageFrom']) delete s[k];
  }
  for (const b of c.buildings as unknown as Record<string, unknown>[]) for (const k of ['incoming', 'outgoing', 'workerIncoming', 'soldiersIncoming', 'used', 'status', 'stock']) delete b[k];
  for (const t of c.trees as unknown as Record<string, unknown>[]) delete t.reserved;
  for (const t of c.stones as unknown as Record<string, unknown>[]) delete t.reserved;
  for (const t of c.fields as unknown as Record<string, unknown>[]) delete t.reserved;
  for (const t of c.animals as unknown as Record<string, unknown>[]) delete t.reserved;
  c.trees = c.trees.filter((t) => t.state !== 'falling');
  delete (c.world.arrays as Record<string, unknown>).tree;
  delete c.ui;
  delete c.scalars.treesVersion; // bumped by removing a tree that was being felled
  return JSON.stringify(c, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as Uint8Array).join(',') : v));
}

// soldiers standing guard keep their posts across a save, and so do soldiers still marching to them
{
  const q = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
  q.ai.length = 0;
  const hq = q.buildings.get(q.players[0].hq)!;
  const men = callOut(q, 0, hq, 2).map((s) => s.id);
  run(q, 20);
  let spot = -1;
  q.world.forRadius(hq.cx, hq.cz, 12, (i, x, y) => { if (spot < 0 && q.world.owner[i] === 0 && q.world.walkable(i) && Math.hypot(x - hq.cx, y - hq.cz) > 9) spot = i; });
  orderMove(q, 0, men, q.world.nx(spot), q.world.ny(spot));
  run(q, 2); // on the march
  const r = restore(snapshot(q));
  run(q, 40); run(r, 40);
  const posts = (x: Game) => men.map((id) => { const s = x.settlers.get(id)!; return `${s.sstate}@${s.order}${s.node === s.order ? '' : '!'}`; }).join(' ');
  check(posts(r) === posts(q), `guards keep their posts: ${posts(r)} vs ${posts(q)}`);
}

const t0 = Date.now();
let saves = 0;
const json = (d: SaveData) => JSON.stringify(d, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as Uint8Array).join(',') : v));

if (process.argv[5] === 'chain') {
  let h = restore(snapshot(g));
  for (let m = every; m <= minutes; m += every) {
    run(g, m * 60 - Math.round(g.time));
    run(h, m * 60 - Math.round(h.time));
    const d = snapshot(h);
    h = restore(d);
    saves++;
    check(json(snapshot(h)) === json(snapshot(restore(snapshot(h)))), `re-saving a loaded game changes it (${m}m)`);
    if (m % 10 === 0 || g.over || h.over) {
      console.log(`[${m}m] uninterrupted`, fmt(stats(g)), g.over ? `· over, winner P${g.winner}` : '');
      console.log(`[${m}m] reloaded    `, fmt(stats(h)), h.over ? `· over, winner P${h.winner}` : '');
    }
    if (g.over && h.over) break;
  }
  // AI wars are chaotic: a single extra random draw early on changes the outcome about as often as
  // reloading does, so a different ending is reported, not failed
  console.log(`outcome: uninterrupted ${g.over ? `P${g.winner} at ${Math.round(g.time / 60)}m` : 'open'}, reloaded ${h.over ? `P${h.winner} at ${Math.round(h.time / 60)}m` : 'open'}`);
  console.log(`${saves} reloads, ${fails} failures, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(fails ? 1 : 0);
}
const AHEAD = 8; // minutes a restored copy plays on before it is compared with the original
const pending = new Map<number, ReturnType<typeof stats>>();
for (let m = 1; m <= minutes + AHEAD; m++) {
  run(g, m * 60 - Math.round(g.time));
  const later = pending.get(m);
  if (later) {
    const a = stats(g);
    console.log(`[${m}m] original`, fmt(a));
    console.log(`[${m}m] restored`, fmt(later));
    // the restored game loses a few seconds of work per settler, never its economy
    later.forEach((p, i) => check(p.produced >= a[i].produced * 0.85 && p.buildings >= a[i].buildings * 0.85 && p.pop >= a[i].pop * 0.85, `restored P${i} fell behind`));
  }
  const voyaging = [...g.settlers.values()].filter((s) => s.voyage && !s.dead);
  if (sea ? !voyaging.length || m - lastSave < every : m % every) continue;
  if (m > minutes) continue;
  lastSave = m;
  if (sea) console.log(`[${m}m] at sea: ${voyaging.filter((s) => s.aboard).length} aboard, ${voyaging.filter((s) => !s.aboard).length} waiting, ${g.expeditions.length} expeditions, ${[...g.ships.values()].map((s) => s.state).join(' ')}`);
  const ts = performance.now();
  const d = snapshot(g, { note: 'test' });
  const snapMs = performance.now() - ts;
  const file = await encodeSave(d);
  const tr = performance.now();
  const r1 = restore(d);
  const restoreMs = performance.now() - tr;
  const r2 = restore(await decodeSave(file));
  saves++;
  console.log(`[${m}m] saved: snapshot ${snapMs.toFixed(1)} ms, restore ${restoreMs.toFixed(1)} ms, file ${(file.length / 1024).toFixed(0)} KB; ${d.settlers.length} settlers, ${d.buildings.length} buildings, ${d.trees.length} trees, ${d.ships.length} ships`);
  // restoring keeps everything that is not a plan
  check(persistent(snapshot(r1)) === persistent(d), 'restored game differs from the save');
  check(JSON.stringify(snapshot(r1)) === JSON.stringify(snapshot(r2), (_k, v) => v), 'file round trip differs');
  check(r1.rng.state === g.rng.state && r1.time === g.time && r1.nextId >= g.nextId, 'clock, ids or random state');
  check(json(snapshot(r1)) === json(snapshot(restore(snapshot(r1)))), 're-saving a loaded game changes it');
  // restoring is deterministic: two restores run identically
  run(r1, 90); run(r2, 90);
  if (sea) {
    const stuck = [...r1.settlers.values()].filter((s) => s.voyage && !s.aboard && !s.dead && !s.actions.length);
    check(!stuck.length, `${stuck.length} voyagers without a plan after restore`);
  }
  check(JSON.stringify(snapshot(r1).settlers) === JSON.stringify(snapshot(r2).settlers), 'two restores diverge');
  run(r1, AHEAD * 60 - 90);
  for (const b of r1.buildings.values()) for (const gd of GOODS) {
    if (b.stock[gd] < 0 || b.incoming[gd] < 0 || b.outgoing[gd] < 0) { check(false, `negative ${gd} at ${b.type} ${b.id}`); break; }
  }
  pending.set(m + AHEAD, stats(r1));
}
console.log(`${saves} saves, ${fails} failures, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(fails ? 1 : 0);
