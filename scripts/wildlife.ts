// Headless check of the wild game (src/game/wildlife.ts): hares fill the woods as far as the trees
// feed them, a hunter by a wood brings in a fair amount of meat, felling a wood drives its hares
// out, a forester's new wood fills up again, deer come back only to big forests and bring two meat,
// and all of it survives a save. The hares are drawn in their two poses without NaNs.
// Usage: npx tsx scripts/wildlife.ts [seed]
import { Game } from '../src/game/game';
import { BUILDINGS, type BuildingType } from '../src/game/defs';
import type { Animal, Building } from '../src/game/types';
import { CELL, DEER_TREES, cellOf, habitat, hareCap } from '../src/game/wildlife';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import { AnimalsRenderer } from '../src/render/entities';
import { lodView } from '../src/render/lod';

const seed = Number(process.argv[2] ?? 199);
const P = 0;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const run = (g: Game, sec: number, each?: () => void) => { for (let i = 0; i < sec; i++) { g.update(1); g.events.length = 0; each?.(); } };
const hares = (g: Game) => [...g.animals.values()].filter((a) => a.kind === 'hare' && a.alive && !a.leave);
const deer = (g: Game) => [...g.animals.values()].filter((a) => a.kind === 'deer' && a.alive);

function put(g: Game, type: BuildingType, x: number, z: number, r: number, score: (a: { x: number; y: number }) => number): Building {
  let best: { x: number; y: number } | null = null, bs = Infinity;
  g.world.forRadius(x, z, r, (_i, nx, ny) => {
    const a = g.anchorFor(type, nx, ny);
    if (!g.canPlace(type, P, a.x, a.y)) return;
    const s = score(a);
    if (s < bs) { bs = s; best = a; }
  });
  if (!best) throw new Error(`no site for ${type}`);
  const a = best as { x: number; y: number };
  return g.addBuilding(type, P, a.x, a.y, true);
}
const treesNear = (g: Game, x: number, z: number, r: number) => {
  let n = 0;
  g.world.forRadius(x, z, r, (i) => { if (g.world.tree[i]) n++; });
  return n;
};
function fresh() {
  const g = new Game({ size: 160, seed, players: 2, aiLevel: 1, islands: true });
  g.ai.length = 0;
  return g;
}

// ---- the woods are full of hares, and only the woods
{
  const g = fresh();
  const hab = habitat(g);
  let cap = 0;
  for (const t of hab) cap += hareCap(t);
  const hs = hares(g);
  check(hs.length > 120 && hs.length <= cap, `hares in the woods at the start: ${hs.length} (the woods hold ${cap}; deer ${deer(g).length})`);
  check(hs.every((a) => hareCap(hab[cellOf(g.world, a.home)]) > 0), 'every hare lives in a patch with trees enough for it');
  const w = g.world;
  const open = hs.filter((a) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(dx) + Math.abs(dy) < 2 && w.tree[w.idx(w.nx(a.node) + dx, w.ny(a.node) + dy)]) return false; return true; });
  check(open.length > hs.length * 0.6, `most sit out from under the crowns, where they can be seen (${open.length}/${hs.length})`);
  const hq = g.buildings.get(g.players[P].hq)!;
  check(hs.every((a) => Math.hypot(a.x - hq.cx, a.z - hq.cz) > 6), 'none in the HQ yard');
  // an hour on its own: the numbers hold (nobody hunts), everyone stays near home
  let far = 0, nan = 0;
  run(g, 3600, () => {
    if (g.time % 60 !== 0) return;
    for (const a of g.animals.values()) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.z)) nan++;
      if (a.kind === 'hare' && Math.hypot(a.x - w.nx(a.home), a.z - w.ny(a.home)) > 9) far++;
    }
  });
  const after = hares(g).length;
  let cap2 = 0;
  for (const t of habitat(g)) cap2 += hareCap(t);
  check(after >= hs.length * 0.9 && after <= cap2, `an hour later, no hunters: ${after} hares (the young trees have grown: the woods hold ${cap2})`);
  check(nan === 0 && far === 0, `hares keep to their homes (${far} strays, ${nan} NaN positions)`);
}

// ---- a hunter by the woods near the HQ: a fair early source of meat, running dry as the woods go
let hunterMeat = 0;
{
  const g = fresh();
  const hq = g.buildings.get(g.players[P].hq)!;
  const h = put(g, 'hunter', hq.cx, hq.cz, 12, (a) => -treesNear(g, a.x, a.y, 12) + Math.hypot(a.x - hq.cx, a.y - hq.cz) * 0.3);
  run(g, 600);
  const m10 = h.prodCount;
  run(g, 600);
  hunterMeat = h.prodCount;
  check(m10 >= 12, `a hunter by the woods: ${m10} meat in his first 10 minutes`);
  check(hunterMeat - m10 >= 8, `and ${hunterMeat - m10} in the next 10, from the hares breeding`);
  // now fell every tree in his range
  const w = g.world;
  for (const t of [...g.trees.values()]) if (Math.hypot(w.nx(t.node) - h.cx, w.ny(t.node) - h.cz) < 22) g.removeTree(t);
  run(g, 120);
  const hab = habitat(g);
  const homeless = hares(g).filter((a) => hareCap(hab[cellOf(w, a.home)]) === 0);
  check(homeless.length === 0, `two minutes after the woods are felled no hare lives there any more (${homeless.length} left)`);
  run(g, 300);
  const m25 = h.prodCount;
  run(g, 600);
  check(h.prodCount - m25 <= 2, `with the woods gone the hunter brings in ${h.prodCount - m25} meat in 10 minutes`);
  check(h.stall?.kind === 'range', `and says why: "${h.status}"`);
  // a forester's new wood: once the saplings are half grown the hares come back
  for (let k = 0; k < 60; k++) {
    const x = Math.round(h.cx + g.rng.range(-9, 9)), z = Math.round(h.cz + g.rng.range(-9, 9));
    const i = w.idx(x, z);
    if (w.walkable(i) && !w.building[i] && !w.tree[i] && !w.field[i]) g.addTree(i, 0, 0.2);
  }
  run(g, 60);
  const back0 = hares(g).filter((a) => Math.hypot(a.x - h.cx, a.z - h.cz) < 16).length;
  h.paused = true;
  run(g, 900);
  const back = hares(g).filter((a) => Math.hypot(a.x - h.cx, a.z - h.cz) < 16).length;
  check(back > back0 && back >= 3, `a new wood fills with hares again (${back0} → ${back} in 15 minutes)`);
}

// ---- deer: back only in big forests, and a deer is two meat
{
  const g = fresh();
  const w = g.world;
  for (const a of deer(g)) g.animals.delete(a.id);
  const born: Animal[] = [];
  const seen = new Set<number>();
  let inForest = 0;
  run(g, 1200, () => {
    for (const a of g.animals.values()) {
      if (a.kind !== 'deer' || seen.has(a.id)) continue;
      seen.add(a.id);
      born.push(a);
      const hab = habitat(g), n = Math.ceil(w.W / CELL), c = cellOf(w, a.home);
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += hab[c + dy * n + dx] ?? 0;
      if (s >= DEER_TREES) inForest++;
    }
  });
  check(born.length > 0 && inForest === born.length, `deer come back to big forests only (${inForest}/${born.length})`);
  // a hunter by the HQ with a lone deer in range and no hares
  for (const a of [...g.animals.values()]) g.animals.delete(a.id);
  const hq = g.buildings.get(g.players[P].hq)!;
  const hut = put(g, 'hunter', hq.cx, hq.cz, 12, (a) => Math.hypot(a.x - hq.cx - 6, a.y - hq.cz));
  let at = -1;
  w.forRadius(hut.cx, hut.cz, 9, (i, _x, _y, d2) => { if (at < 0 && d2 > 36 && w.walkable(i) && !w.building[i]) at = i; });
  g.addAnimal(at, 1, 'deer');
  const gw = g as unknown as { wildT: number; deerT: number };
  let first = -1;
  run(g, 300, () => { gw.wildT = gw.deerT = 999; if (first < 0 && hut.prodCount > 0) first = hut.prodCount; });
  check(first === 2, `a deer brings two meat (${first})`);
}

// ---- game can't be shut in a footprint, and a hunter doesn't search the whole landmass for one that is
{
  const g = fresh();
  const w = g.world;
  for (const a of [...g.animals.values()]) g.animals.delete(a.id);
  const hq = g.buildings.get(g.players[P].hq)!;
  const hut = put(g, 'hunter', hq.cx, hq.cz, 12, (a) => Math.hypot(a.x - hq.cx - 6, a.y - hq.cz));
  // a hare sits where a farm goes up round it
  let site: { x: number; y: number } | null = null;
  w.forRadius(hut.cx, hut.cz, 10, (_i, nx, ny) => {
    const a = g.anchorFor('farm', nx, ny);
    if (!site && g.canPlace('farm', P, a.x, a.y)) site = a;
  });
  const s = site as { x: number; y: number } | null;
  if (!s) throw new Error('no site for the farm');
  const fp = g.footprint(BUILDINGS.farm.size, s.x, s.y).filter((i) => w.walkable(i));
  const inner = fp[fp.length >> 1];
  const hare = g.addAnimal(inner, 1, 'hare');
  hare.home = inner;
  const farm = g.addBuilding('farm', P, s.x, s.y, true);
  check(hare.node === farm.door && hare.home === farm.door && !w.blocked[hare.node], `a hare inside a new footprint steps out to the door (node ${hare.node}, door ${farm.door})`);
  // an older save's hare already shut in: the hunter looks elsewhere instead of searching the landmass every half second
  g.animals.delete(hare.id);
  const walled = g.footprint(farm.size, farm.x, farm.y).find((i) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!w.blocked[w.idx(w.nx(i) + dx, w.ny(i) + dy)]) return false; return true; });
  if (walled === undefined) throw new Error('no node walled in on every side');
  const shut = g.addAnimal(walled, 1, 'hare');
  const gw = g as unknown as { wildT: number; deerT: number };
  const e0 = g.path.expansions;
  run(g, 60, () => { gw.wildT = gw.deerT = 999; });
  check(g.path.expansions - e0 < 20000 && shut.alive, `a hunter ignores a hare shut in a footprint (${g.path.expansions - e0} nodes searched in a minute, "${hut.status}")`);
  check(g.path.find(hut.door, walled, true) === null && g.path.expansions - e0 < 20000, 'and a path to it fails at once');
}

// ---- a save keeps the game where it is; old saves (deer only) still load
{
  const g = fresh();
  const hq = g.buildings.get(g.players[P].hq)!;
  const h = put(g, 'hunter', hq.cx, hq.cz, 12, (a) => -treesNear(g, a.x, a.y, 12) + Math.hypot(a.x - hq.cx, a.y - hq.cz) * 0.3);
  run(g, 400);
  const r = restore(await decodeSave(await encodeSave(snapshot(g))));
  const key = (x: Game) => [...x.animals.values()].map((a) => `${a.id}:${a.kind}:${a.home}:${a.leave}:${a.alive}`).join(' ');
  check(key(r) === key(g), `a save keeps every animal, its kind and its home (${r.animals.size})`);
  const rh = r.buildings.get(h.id)!;
  const before = rh.prodCount;
  run(r, 600);
  check(rh.prodCount - before >= 8, `after loading the hunter keeps hunting (${rh.prodCount - before} meat in 10 minutes)`);
  check(Math.abs(hares(r).length - hares(g).length) < 40, `and the woods keep their hares (${hares(r).length} vs ${hares(g).length} before)`);
  const old = snapshot(g);
  old.animals = old.animals.filter((a) => a.kind === 'deer');
  for (const a of old.animals as unknown as Record<string, unknown>[]) { delete a.kind; delete a.home; delete a.leave; }
  delete (old.scalars as Record<string, unknown>).wildT;
  const deer0 = old.animals.map((a) => a.id);
  const o = restore(old);
  check(deer0.every((id) => { const a = o.animals.get(id); return a?.kind === 'deer' && a.home === a.node && a.leave === 0; }), 'a save from before hares loads, every animal in it a deer at home where it stands');
  check(hares(o).length > 100, `and its woods fill with hares as in a new game (${hares(o).length})`);
  run(o, 60);
}

// ---- drawn: both poses, a hare going into its burrow sinks, no NaNs
{
  const g = fresh();
  g.world.explored.fill(1);
  lodView.enabled = false;
  const ar = new AnimalsRenderer(g);
  const R = ar as unknown as { hareSit: import('three').InstancedMesh; hareLeap: import('three').InstancedMesh };
  let sit = 0, leap = 0, bad = 0;
  for (let f = 0; f < 200; f++) {
    g.update(0.1);
    g.events.length = 0;
    ar.update(0.1, f * 0.1);
    sit = Math.max(sit, R.hareSit.count);
    leap = Math.max(leap, R.hareLeap.count);
    for (const m of [R.hareSit, R.hareLeap]) for (let i = 0; i < m.count * 16; i++) if (!Number.isFinite(m.instanceMatrix.array[i])) bad++;
  }
  check(sit > 100 && leap > 0 && bad === 0, `hares drawn sitting (${sit}) and in mid-leap (${leap}), ${bad} bad matrix entries`);
  const a = hares(g)[0];
  a.leave = g.time;
  ar.update(0.01, 30);
  const y0 = g.world.heightAt(a.x, a.z);
  g.update(1); g.events.length = 0;
  check(g.animals.has(a.id), 'a hare going into its burrow is still there a second later');
  g.update(0.3); g.events.length = 0;
  check(!g.animals.has(a.id), 'and gone a moment after');
  void y0;
}

console.log(`hunter by the woods: ${hunterMeat} meat in 20 minutes`);
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
