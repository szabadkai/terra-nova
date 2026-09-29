// Headless check of the spells taken from The Settlers III: All-Seeing Eye, Gift of the Gods, Teeming
// Waters, Forest's Favour, Midas Touch and Winter's Grasp (and Healing Light thawing the frozen). Two
// people who give no orders; the first gets a Great Temple and a full store of mana, and every spell is
// cast through the command layer, refused where it should be and followed to its effect - a frost also
// through a save and a load half way. Then two computer kingdoms play and the book they use is counted.
// Usage: npx tsx scripts/spells.ts [seed] [aiMinutes]  (the seed of the first part; the AI game is always seed 13)
import { Game } from '../src/game/game';
import { AIController } from '../src/game/ai';
import { applyCommand } from '../src/game/commands';
import { FREEZE_TIME, MANA_MAX, SPELLS, SPELL_ORDER, castError, faithStatus, type SpellId } from '../src/game/faith';
import { GOODS } from '../src/game/defs';
import { hqOf, nearestWater, prebuilt } from '../src/game/campaign';
import { restore, snapshot } from '../src/game/save';
import { stateHash } from '../src/game/hash';
import type { Settler } from '../src/game/types';

const seed = Number(process.argv[2] ?? 7), aiMin = Number(process.argv[3] ?? 75);
let fails = 0;
const check = (ok: boolean, what: string) => { if (!ok) fails++; console.log(ok ? '  ok  ' : '  FAIL', what); };
const run = (x: Game, sec: number) => { for (let i = 0; i < sec * 20; i++) { x.update(0.05); x.events.length = 0; } };

const g = new Game({ size: 128, seed, players: 2, aiLevel: 1, humans: 2 });
const hq = hqOf(g, 0), foeHq = hqOf(g, 1);
const w = g.world;
prebuilt(g, 'greattemple', hq.cx, hq.cz, 14, 0);
for (let t = 0; t < 240 && !faithStatus(g, 0).great; t++) run(g, 1);
check(faithStatus(g, 0).great, 'a priest serves in the Great Temple');
const p = g.players[0];
/** full mana and rested priests, so a refusal names the place and not the temple */
const ready = () => { p.mana = MANA_MAX; p.spellCd = 0; };
const refusal = (id: SpellId, x: number, z: number) => { ready(); return castError(g, 0, id, x, z); };
const cast = (id: SpellId, x: number, z: number) => {
  ready();
  const r = applyCommand(g, 0, { t: 'cast', id, x, z });
  run(g, 2);
  return r;
};
check(SPELL_ORDER.length === 10 && SPELL_ORDER.every((id) => SPELLS[id].id === id), 'ten spells in the book, each under its own name');

// ---- All-Seeing Eye: into the fog, well past the border
{
  const r = hq.def.military!.radius;
  let spot: { x: number; z: number } | null = null, far: { x: number; z: number } | null = null;
  for (let a = 0; a < 64 && (!spot || !far); a++) {
    const ang = (a / 64) * Math.PI * 2;
    const at = (d: number) => ({ x: Math.round(hq.cx + Math.cos(ang) * d), z: Math.round(hq.cz + Math.sin(ang) * d) });
    const s = at(r + 24), f = at(r + 44);
    if (!spot && w.inBounds(s.x, s.z) && !((w.seen[w.idx(s.x, s.z)] >> 0) & 1)) spot = s;
    if (!far && w.inBounds(f.x, f.z)) far = f;
  }
  check(!!spot, 'there is unexplored land 24 beyond the border');
  if (spot) {
    check(refusal('harvest', spot.x, spot.z) === 'You cannot see that place', 'other spells need sight of the place');
    check(refusal('eye', spot.x, spot.z) === null, 'the Eye can be cast into the fog');
    if (far) check(refusal('eye', far.x, far.z) === 'Too far from your strongholds', 'but not 44 past the border');
    const res = cast('eye', spot.x, spot.z);
    let lit = 0, all = 0;
    w.forRadius(spot.x, spot.z, SPELLS.eye.radius, (i) => { all++; if ((w.seen[i] & 1) && w.explored[i]) lit++; });
    check(res.ok && lit === all, `the fog lifts from the whole circle (${lit}/${all} nodes)`);
  }
}

// ---- Gift of the Gods: goods of eight kinds in the storehouse
{
  const before = { ...hq.stock };
  check(refusal('gift', hq.cx + 12, hq.cz + 12) === 'Call it over one of your storehouses', 'a gift needs a storehouse under the circle');
  cast('gift', hq.cx, hq.cz);
  const kinds = GOODS.filter((gd) => hq.stock[gd] > before[gd]);
  const n = GOODS.reduce((a, gd) => a + hq.stock[gd] - before[gd], 0);
  check(kinds.length === 8 && n >= 8 && n <= 16 && kinds.every((gd) => !['sword', 'bow', 'iron', 'gold', 'wine', 'axe', 'saw', 'hammer'].includes(gd)), `eight kinds, ${n} goods: ${kinds.join(', ')}`);
}

// ---- Midas Touch: forty bars at most
{
  hq.stock.iron = 0;
  check(refusal('midas', hq.cx, hq.cz) === 'No iron in store there', 'no iron, no gold');
  hq.stock.iron = 55;
  const gold = hq.stock.gold;
  cast('midas', hq.cx, hq.cz);
  check(hq.stock.iron === 15 && hq.stock.gold === gold + 40, `55 iron bars become 15 and ${hq.stock.gold - gold} gold`);
}

// ---- Teeming Waters
{
  const water = nearestWater(g);
  check(!!water, 'there is water near the headquarters');
  if (water) {
    let n = 0;
    w.forRadius(water.x, water.z, SPELLS.fish.radius, (i) => { if (w.isWater(i)) { w.fish[i] = 0; n++; } });
    const err = refusal('fish', water.x, water.z);
    check(err === null, `the lake can be filled (${err ?? n + ' water nodes'})`);
    cast('fish', water.x, water.z);
    let ok = 0;
    w.forRadius(water.x, water.z, SPELLS.fish.radius, (i) => { if (w.isWater(i) && w.fish[i] >= 1 && w.fish[i] <= 4) ok++; });
    check(ok === n, `every water node holds one to four fish (${ok}/${n})`);
  }
}

// ---- Forest's Favour: saplings spaced as a forester would, never on paths or doorsteps
{
  let best: { x: number; z: number } | null = null, bn = -1;
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2, x = Math.round(hq.cx + Math.cos(a) * 11), z = Math.round(hq.cz + Math.sin(a) * 11);
    if (!w.inBounds(x, z) || refusal('forest', x, z)) continue;
    let open = 0;
    w.forRadius(x, z, SPELLS.forest.radius, (i) => { if (!w.tree[i] && !w.building[i] && !w.isWater(i)) open++; });
    if (open > bn) { bn = open; best = { x, z }; }
  }
  check(!!best, 'open ground near the headquarters');
  if (best) {
    const had = new Set(g.trees.keys());
    cast('forest', best.x, best.z);
    const fresh = [...g.trees.values()].filter((t) => !had.has(t.id));
    const next = fresh.some((t) => [1, -1, w.W, -w.W].some((d) => fresh.some((o) => o.node === t.node + d)));
    const onPaths = fresh.some((t) => w.building[t.node] || w.reserve[t.node]);
    check(fresh.length >= 8 && !next && !onPaths && fresh.every((t) => t.state === 'grow'), `${fresh.length} saplings, none side by side, none on a footprint`);
  }
}

// ---- Winter's Grasp: enemy soldiers held fast; they are struck and cannot strike back
{
  const at = (dx: number, dz: number) => w.idx(Math.round(hq.cx + dx), Math.round(hq.cz + dz));
  let base = -1;
  for (let k = 0; k < 64 && base < 0; k++) {
    const a = (k / 64) * Math.PI * 2, i = at(Math.cos(a) * 9, Math.sin(a) * 9);
    if (w.walkable(i) && [1, -1, w.W, -w.W].every((d) => w.walkable(i + d))) base = i;
  }
  check(base >= 0, 'room for a skirmish by the headquarters');
  const foes: Settler[] = [];
  for (const d of [0, 1, -1, w.W]) {
    const s = g.addSettler(1, 'swordsman', base + d);
    s.sstate = 'attack'; s.targetB = hq.id;
    s.maxHp = s.hp = 600; // tough enough to outlast the garrison that sallies out at them
    g.syncPos(s);
    foes.push(s);
  }
  const miss = refusal('freeze', w.nx(base) - (hq.cx - w.nx(base)) * 0.9, w.ny(base) - (hq.cz - w.ny(base)) * 0.9);
  check(miss === 'No enemy soldiers there', `the frost needs enemies under it (${miss})`);
  cast('freeze', w.nx(base), w.ny(base));
  check(foes.every((s) => s.frozenUntil > g.time + FREEZE_TIME - 3), 'all four raiders are frozen');
  const where = new Map(foes.map((s) => [s.id, `${s.node}/${s.next}/${s.t}`]));
  // two of ours step up beside them
  const ours: Settler[] = [];
  for (const d of [2, -2]) {
    const s = g.addSettler(0, 'swordsman', base + d);
    s.sstate = 'idle';
    g.syncPos(s);
    ours.push(s);
  }
  const hp0 = foes.reduce((a, s) => a + s.hp, 0);
  // half way through, the game is saved and loaded, and the copy carries on
  run(g, 4);
  const copy = restore(snapshot(g));
  const cf = foes.map((s) => copy.settlers.get(s.id)!);
  check(cf.every((s, k) => s.frozenUntil === foes[k].frozenUntil), 'a save keeps the frost');
  run(g, 4);
  run(copy, 4);
  const still = foes.filter((s) => !s.dead);
  check(still.length > 0 && still.every((s) => `${s.node}/${s.next}/${s.t}` === where.get(s.id)), `the ${still.length} still standing have not moved an inch in eight seconds`);
  check(ours.every((s) => s.hp === s.maxHp) && foes.reduce((a, s) => a + s.hp, 0) < hp0, `they took blows (${Math.round(hp0)} → ${Math.round(foes.reduce((a, s) => a + s.hp, 0))} hp) and dealt none`);
  check(cf.every((s) => s.dead || s.frozenUntil > copy.time), 'and in the loaded copy they are still frozen');
  run(g, FREEZE_TIME);
  check(foes.every((s) => s.dead || s.frozenUntil <= g.time), 'the frost lets go after 15 seconds');
  // Healing Light thaws one of ours the enemy froze
  const mine = ours.find((s) => !s.dead) ?? g.addSettler(0, 'swordsman', base);
  mine.frozenUntil = g.time + FREEZE_TIME;
  cast('heal', mine.x, mine.z);
  check(mine.frozenUntil === 0, 'Healing Light thaws a frozen soldier of ours');
  void foeHq;
}

// ---- the look-ahead the interface makes stays pure
{
  const before = `${g.rng.state}/${g.nextId}/${stateHash(g)}`;
  for (let k = 0; k < 400; k++) castError(g, 0, SPELL_ORDER[k % SPELL_ORDER.length], hq.cx + ((k * 7) % 61) - 30, hq.cz + ((k * 13) % 61) - 30);
  check(`${g.rng.state}/${g.nextId}/${stateHash(g)}` === before, 'castError leaves the game as it was');
}

// ---- two computer kingdoms: which spells do they call?
{
  // (seed 13 is a long war between two hard kingdoms: both raise great temples)
  const a = new Game({ size: 160, seed: 13, players: 2, aiLevel: 2, islands: true });
  a.ai.push(new AIController(a, 0, 2));
  const used: Record<string, number> = {};
  for (let t = 0; t < aiMin * 60 && !a.over; t++) {
    a.update(1);
    for (const e of a.events) if (e.type === 'spell') used[e.kind!] = (used[e.kind!] ?? 0) + 1;
    a.events.length = 0;
  }
  console.log(`  AI vs AI, ${Math.round(a.time / 60)} min: ${JSON.stringify(used)}`);
  check(Object.keys(used).some((k) => ['gift', 'fish', 'forest', 'midas', 'freeze'].includes(k)), 'the computer kingdoms call on the new spells');
}

console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
