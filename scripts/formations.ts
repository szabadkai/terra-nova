// Headless check of soldier formations: a mixed group (swordsmen, bowmen, a catapult) marches out
// in each drill — line, block, wedge, ring — and stands in it facing the way it came, swordsmen in
// front; the group keeps to the catapult's pace and arrives together; men standing firm let a foe
// come to them while the others charge; a drill change re-forms the men where they stand; and the
// drill, stance and facing survive a save.
// Usage: npx tsx scripts/formations.ts [seed] [--draw]
import { Game } from '../src/game/game';
import { FORMATIONS, FIRM_LEASH, orderMove, planFormation, setDrill, setFirm } from '../src/game/orders';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import { CATAPULT_HP } from '../src/game/defs';
import type { Formation, Settler } from '../src/game/types';

const seed = Number(process.argv[2] ?? 7);
const draw = process.argv.includes('--draw');
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
g.ai.length = 0; // no interference
const w = g.world;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const run = (sec: number, until?: () => boolean) => {
  for (let k = 0; k < sec * 4; k++) { g.update(0.25); if (until?.()) break; }
  g.events.length = 0;
};
const hq = g.buildings.get(g.players[0].hq)!;

// open ground on our land: the spot with the most walkable nodes around it, well away from the HQ
let best = -1, bestN = -1;
w.forRadius(hq.cx, hq.cz, 16, (i, x, y) => {
  if (w.owner[i] !== 0 || !w.walkable(i) || Math.hypot(x - hq.cx, y - hq.cz) < 9) return;
  let n = 0;
  w.forRadius(x, y, 5, (j) => { if (w.walkable(j) && !w.building[j] && w.region[j] === w.region[i]) n++; });
  if (n > bestN) { bestN = n; best = i; }
});
const cx = w.nx(best), cz = w.ny(best);
console.log(`open ground at ${cx},${cz} (${bestN} free nodes within 5)`);

// the group: six swordsmen, four bowmen and a catapult, gathered by the headquarters' door
const men: Settler[] = [];
const add = (job: 'swordsman' | 'bowman' | 'catapult') => {
  const s = g.addSettler(0, job, hq.door);
  if (job === 'catapult') { s.hp = s.maxHp = CATAPULT_HP; s.wanderT = 0; }
  s.sstate = 'idle';
  men.push(s);
};
for (let i = 0; i < 6; i++) add('swordsman');
for (let i = 0; i < 4; i++) add('bowman');
add('catapult');
const ids = men.map((s) => s.id);
orderMove(g, 0, ids, w.nx(hq.door) + 3, w.ny(hq.door) + 3);
run(40, () => men.every((s) => s.node === s.order));

const kind = (s: Settler) => (s.job === 'swordsman' ? 0 : s.job === 'bowman' ? 1 : 2);
const atPost = () => men.filter((s) => s.sstate === 'hold' && s.node === s.order).length;

/** Posts in the formation's frame: `ahead` along its facing, `across` it. */
const frame = (a: number) => {
  let mx = 0, mz = 0;
  for (const s of men) { mx += w.nx(s.order); mz += w.ny(s.order); }
  mx /= men.length; mz /= men.length;
  return men.map((s) => {
    const dx = w.nx(s.order) - mx, dz = w.ny(s.order) - mz;
    return { s, ahead: dx * Math.sin(a) + dz * Math.cos(a), across: dx * Math.cos(a) - dz * Math.sin(a), r: Math.hypot(dx, dz), dx, dz };
  });
};
const picture = () => {
  const xs = men.map((s) => w.nx(s.order)), zs = men.map((s) => w.ny(s.order));
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1;
  for (let z = z0; z <= z1; z++) {
    let row = '      ';
    for (let x = x0; x <= x1; x++) {
      const s = men.find((m) => w.nx(m.order) === x && w.ny(m.order) === z);
      const i = w.idx(x, z);
      row += s ? 'SBC'[kind(s)] : !w.walkable(i) ? '#' : '.';
    }
    console.log(row);
  }
};

// 1. every drill, marching off in a different direction each time
const dirs = [[12, 0], [0, 12], [-9, -9], [9, -9]];
FORMATIONS.forEach((shape: Formation, k) => {
  const [ox, oz] = dirs[k];
  const tx = cx + ox * 0.5, tz = cz + oz * 0.5;
  const from = { x: men.reduce((q, s) => q + w.nx(s.node), 0) / men.length, z: men.reduce((q, s) => q + w.ny(s.node), 0) / men.length };
  const n = orderMove(g, 0, ids, tx, tz, shape);
  const a = men[0].face ?? 0;
  const marched = Math.atan2(tx - from.x, tz - from.z);
  run(90, () => atPost() === men.length);
  if (draw) { console.log(`   ${shape}, facing ${Math.round((a * 180) / Math.PI)}°:`); picture(); }
  check(n === men.length && atPost() === men.length, `${shape}: all ${men.length} formed up (${atPost()})`);
  check(new Set(men.map((s) => s.order)).size === men.length, `${shape}: each on a node of his own`);
  const f = frame(a);
  const sw = f.filter((p) => kind(p.s) === 0), bw = f.filter((p) => kind(p.s) === 1), ct = f.filter((p) => kind(p.s) === 2);
  if (shape === 'ring') {
    const mean = (xs: typeof f) => xs.reduce((q, p) => q + p.r, 0) / xs.length;
    check(mean(sw) > mean(bw) + 0.8 && mean(bw) > mean(ct), `ring: swordsmen outside (${mean(sw).toFixed(1)}), bowmen inside (${mean(bw).toFixed(1)}), catapult in the middle (${mean(ct).toFixed(1)})`);
    const out = [...sw, ...bw].filter((p) => {
      const d = Math.atan2(p.dx, p.dz) - (p.s.face ?? 0);
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 0.6;
    });
    check(out.length >= sw.length + bw.length - 1, `ring: the men face outwards (${out.length}/${sw.length + bw.length})`);
  } else {
    const front = Math.min(...sw.map((p) => p.ahead)), backB = Math.max(...bw.map((p) => p.ahead));
    const avg = (xs: typeof f) => xs.reduce((q, p) => q + p.ahead, 0) / xs.length;
    if (shape === 'wedge') check(avg(sw) > avg(bw), `wedge: swordsmen ahead of the bowmen (${avg(sw).toFixed(1)} > ${avg(bw).toFixed(1)})`);
    else check(front > backB, `${shape}: swordsmen in front of the bowmen (${front.toFixed(1)} > ${backB.toFixed(1)})`);
    check(ct[0].ahead <= Math.min(...bw.map((p) => p.ahead)) + 0.01, `${shape}: the catapult at the back`);
    const d = Math.atan2(Math.sin(a - marched), Math.cos(a - marched));
    check(Math.abs(d) <= Math.PI / 8 + 0.01, `${shape}: it faces the way it marched (${Math.round((a * 180) / Math.PI)}° vs ${Math.round((marched * 180) / Math.PI)}°)`);
  }
  if (shape === 'line') {
    const depth = new Set(sw.map((p) => p.ahead.toFixed(1)));
    check(depth.size === 1, `line: the swordsmen in one rank (${depth.size})`);
  }
  if (shape === 'wedge') {
    const tip = f.reduce((p, q) => (q.ahead > p.ahead ? q : p));
    check(kind(tip.s) === 0 && f.filter((p) => Math.abs(p.ahead - tip.ahead) < 0.2).length === 1, 'wedge: a single swordsman at the point');
  }
  // no one stands shoulder to shoulder
  let tight = 0;
  for (const p of men) for (const q of men) if (p.id < q.id && Math.abs(w.nx(p.order) - w.nx(q.order)) + Math.abs(w.ny(p.order) - w.ny(q.order)) <= 1) tight++;
  check(tight <= 1, `${shape}: men a step apart (${tight} pairs side by side)`);
  run(3);
  const turned = men.filter((s) => s.job !== 'catapult' && Math.abs(Math.atan2(Math.sin(s.heading - (s.face ?? 0)), Math.cos(s.heading - (s.face ?? 0)))) < 0.05).length;
  check(turned === men.length - 1, `${shape}: the men turn to face the formation's way (${turned}/${men.length - 1})`);
});

// 2. marching together: the group keeps to the catapult's pace
{
  const tx = cx - 10, tz = cz + 6;
  orderMove(g, 0, ids, tx, tz, 'block');
  const arrive = new Map<number, number>();
  const t0 = g.time;
  for (let k = 0; k < 4 * 120 && arrive.size < men.length; k++) {
    g.update(0.25);
    for (const s of men) if (!arrive.has(s.id) && s.node === s.order) arrive.set(s.id, g.time - t0);
  }
  g.events.length = 0;
  const cat = arrive.get(men[10].id) ?? Infinity;
  const soldiers = men.slice(0, 10).map((s) => arrive.get(s.id) ?? Infinity);
  const first = Math.min(...soldiers);
  check(arrive.size === men.length && first > cat * 0.55, `the men keep with the catapult (first man in after ${first.toFixed(0)} s, the catapult after ${cat.toFixed(0)} s)`);
  run(1);
  check(men.every((s) => s.pace === 1), `and walk at their own pace again once there (${men.filter((s) => s.pace !== 1).map((s) => `${s.job} ${s.pace.toFixed(2)} ${s.sstate} ${s.node === s.order}`).join(', ') || 'all'})`);
}

// 3. standing firm
{
  const a = men[0].face ?? 0;
  const lead = men[0];
  const spot = (d: number) => w.idx(Math.round(w.nx(lead.order) + Math.sin(a) * d), Math.round(w.ny(lead.order) + Math.cos(a) * d));
  let at = spot(4.5);
  for (let d = 4.5; d < 6 && !w.walkable(at); d += 0.5) at = spot(d);
  setFirm(g, 0, ids, true);
  const foe = g.addSettler(1, 'swordsman', at);
  foe.sstate = 'hold';
  foe.order = at;
  foe.firm = true; // he stands his ground too
  foe.hp = foe.maxHp = 400;
  run(8);
  const strayed = men.filter((s) => w.dist(s.node, s.order) > FIRM_LEASH).length;
  check(strayed === 0 && !foe.dead, `standing firm, nobody charges a foe ${w.dist(at, lead.order).toFixed(1)} away (${strayed} left their posts)`);
  setFirm(g, 0, ids.slice(0, 6), false);
  run(4);
  const charged = men.slice(0, 6).filter((s) => s.engaged === foe.id || w.dist(s.node, s.order) > 1.5).length;
  check(charged > 0, `told to charge again, the swordsmen go for him (${charged})`);
  run(40, () => foe.dead);
  check(foe.dead, 'and cut him down');
  run(30, () => atPost() === men.length);
  check(atPost() >= men.length - 1, `then go back to their posts (${atPost()}/${men.length})`);
}

// 4. a new drill re-forms the men where they stand
{
  const before = frame(0);
  let mx = 0, mz = 0;
  for (const p of before) { mx += w.nx(p.s.order); mz += w.ny(p.s.order); }
  mx /= men.length; mz /= men.length;
  const face = men[0].face;
  setDrill(g, 0, ids, 'ring');
  run(40, () => atPost() === men.length);
  let nx = 0, nz = 0;
  for (const s of men) { nx += w.nx(s.order); nz += w.ny(s.order); }
  nx /= men.length; nz /= men.length;
  check(men.every((s) => s.drill === 'ring') && Math.hypot(nx - mx, nz - mz) < 2, `a drill change re-forms them in place (moved ${Math.hypot(nx - mx, nz - mz).toFixed(1)})`);
  check(atPost() === men.length, 'into a ring');
  const plan = planFormation(g, 0, ids, nx + 8, nz);
  check(!!plan && plan.shape === 'ring' && plan.men.length === men.length, 'the next order keeps their drill');
  void face;
}

// 5. drill, stance and facing survive a save
{
  setFirm(g, 0, ids.slice(6), true);
  const copy = restore(await decodeSave(await encodeSave(snapshot(g))));
  const same = men.every((s) => {
    const c = copy.settlers.get(s.id);
    return !!c && c.drill === s.drill && c.firm === s.firm && c.face === s.face && c.order === s.order;
  });
  check(same, 'drill, stance and facing are saved');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
