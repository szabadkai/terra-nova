// Headless check of war machines: a siege workshop builds a catapult out of boards and iron; sent
// against an empty enemy tower it rolls into range and its stones bring the tower down (with a save
// and a load in the middle of the bombardment); escorted by soldiers it breaks a garrisoned tower;
// standing guard it shells a stronghold that lies within reach on its own; and sent in alone
// against a manned tower it is smashed by the defenders who sally out.
// Usage: npx tsx scripts/siege.ts [seed]
import { Game } from '../src/game/game';
import { CATAPULT_RANGE } from '../src/game/defs';
import type { BuildingType } from '../src/game/defs';
import { callOut, orderAttack, orderMove, orderReturn } from '../src/game/orders';
import { catapultsOf, siegeHits, spawnCatapult } from '../src/game/siege';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import type { Building, Settler } from '../src/game/types';

const seed = Number(process.argv[2] ?? 7);
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
g.ai.length = 0; // the AI must not interfere
const w = g.world;
const P = 0;
const hq = g.buildings.get(g.players[P].hq)!;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const log = (...a: unknown[]) => console.log(`[${(g.time / 60).toFixed(1)}m]`, ...a);
const counts: Record<string, number> = {};
const run = (x: Game, sec: number) => {
  for (let k = 0; k < sec * 4; k++) {
    x.update(0.25);
    if (x === g) for (const e of x.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    x.events.length = 0;
  }
};
const runUntil = (x: Game, sec: number, cond: () => boolean) => { for (let t = 0; t < sec * 4 && !cond(); t++) run(x, 0.25); return cond(); };

function siteNear(x: number, z: number, type: BuildingType): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  w.forRadius(x, z, 9, (_i, nx, ny, d2) => {
    if (d2 >= bd) return;
    const a = g.anchorFor(type, nx, ny);
    if (!g.canPlace(type, P, a.x, a.y)) return;
    bd = d2;
    best = a;
  });
  return best;
}
/** An enemy tower on free land about `dist` from the headquarters, on our landmass, kept off the enemy's garrison rota. */
function enemyTower(dist: number, garrison: number, hp = 100): Building | null {
  const home = w.region[hq.door];
  for (let a = 0; a < Math.PI * 2; a += 0.35) {
    const cx = hq.cx + Math.cos(a) * dist, cz = hq.cz + Math.sin(a) * dist;
    let t: Building | null = null;
    for (let r = 0; r < 6 && !t; r++) w.forRadius(cx, cz, r, (i, x, y) => {
      if (t || w.owner[i] >= 0) return;
      const an = g.anchorFor('tower_s', x, y);
      if (g.placeError('tower_s', 1, an.x, an.y, true) !== null) return;
      if (w.region[g.doorOf(2, an.x, an.y)] !== home) return;
      t = g.addBuilding('tower_s', 1, an.x, an.y, true);
    });
    if (!t) continue;
    const tw: Building = t;
    for (let k = 0; k < garrison; k++) {
      const d = g.addSettler(1, 'swordsman', tw.door);
      d.hidden = true; d.inside = tw.id; d.sstate = 'garrison'; d.home = tw.id; d.hp = hp;
      tw.garrison.push(d.id);
    }
    tw.occupied = true;
    tw.desiredSoldiers = garrison;
    g.territoryDirty = true;
    run(g, 1);
    return tw;
  }
  return null;
}
const alive = (b: Building) => g.buildings.has(b.id) && b.state !== 'burning';
const catapults = (x: Game) => [...x.settlers.values()].filter((s) => s.owner === P && s.job === 'catapult' && !s.dead);

// 1. the workshop builds one
hq.stock.board = 40; hq.stock.iron = 10; hq.stock.hammer = 3;
const a = siteNear(hq.cx + 6, hq.cz + 5, 'siegeworks');
if (!a) throw new Error('no site for the workshop');
const works = g.addBuilding('siegeworks', P, a.x, a.y, true);
check(runUntil(g, 240, () => catapultsOf(g, P) > 0), `the workshop built a catapult (${(g.time / 60).toFixed(1)} min, ${works.status})`);
const cat = catapults(g)[0];
check(!!cat && cat.hp === cat.maxHp && cat.sstate === 'hold' && cat.order >= 0 && cat.order !== works.door, 'it takes up a place in the yard');

// 2. alone against an empty tower, with a save in the middle
const T1 = enemyTower(24, 0);
if (!T1 || !cat) { console.log('(no room for an enemy tower)'); process.exit(1); }
const d0 = Math.hypot(T1.cx - cat.x, T1.cz - cat.z);
check(orderAttack(g, P, [cat.id], T1) === 1, `ordered against an empty tower ${d0.toFixed(0)} away`);
counts.siegehit = 0;
check(runUntil(g, 120, () => (counts.siegehit ?? 0) > 0), `it rolled into range and landed a stone (${Math.hypot(T1.cx - cat.x, T1.cz - cat.z).toFixed(1)} from the tower, range ${CATAPULT_RANGE})`);
const copy = restore(await decodeSave(await encodeSave(snapshot(g))));
copy.ai.length = 0;
const cc = catapults(copy)[0];
check(!!cc && cc.sstate === 'attack' && cc.targetB === T1.id && copy.buildings.get(T1.id)!.damage > 0, 'the saved game keeps the bombardment and the damage');
check(runUntil(g, 90, () => !alive(T1)), `${siegeHits(T1)} hits razed it (damage ${T1.damage.toFixed(1)})`);
check(runUntil(copy, 120, () => !copy.buildings.has(T1.id) || copy.buildings.get(T1.id)!.state === 'burning'), 'and the restored game razes it too');
run(g, 15);
check(cat.sstate === 'idle' && !cat.dead, 'the catapult stands down afterwards');

// 3. escorted against a garrisoned tower
const T2 = enemyTower(30, 2, 60);
if (T2) {
  const escort = callOut(g, P, hq, 2).map((s) => s.id);
  run(g, 3);
  // the escort holds the ground the catapult will fire from
  const ex = T2.cx + (cat.x - T2.cx) * (8 / Math.hypot(cat.x - T2.cx, cat.z - T2.cz));
  const ez = T2.cz + (cat.z - T2.cz) * (8 / Math.hypot(cat.x - T2.cx, cat.z - T2.cz));
  check(orderMove(g, P, escort, ex, ez) === escort.length, `${escort.length} soldiers escort it`);
  check(orderAttack(g, P, [cat.id], T2) === 1, 'the catapult is sent against a manned tower');
  const g0 = T2.garrison.length;
  check(runUntil(g, 300, () => !alive(T2)), `the tower fell (garrison ${g0} → ${alive(T2) ? T2.garrison.length : 'razed'}, catapult ${cat.dead ? 'lost' : 'intact'})`);
  orderReturn(g, P, escort);
} else console.log('(no room for a second tower)');

// 4. on guard, it shells what comes within reach by itself
if (!cat.dead) {
  const T3 = enemyTower(36, 0);
  if (T3) {
    let spot = -1;
    w.forRadius(T3.cx, T3.cz, CATAPULT_RANGE - 1.5, (i, x, y, d2) => {
      if (spot >= 0 || d2 < 36 || !w.walkable(i) || w.region[i] !== w.region[hq.door]) return;
      if (Math.hypot(x - hq.cx, y - hq.cz) < Math.hypot(T3.cx - hq.cx, T3.cz - hq.cz)) spot = i;
    });
    if (spot >= 0) {
      check(orderMove(g, P, [cat.id], w.nx(spot), w.ny(spot)) === 1, 'sent to stand guard within reach of another tower');
      check(runUntil(g, 150, () => !alive(T3)), `standing guard, it razed it without orders (${cat.sstate})`);
      check(orderReturn(g, P, [cat.id]) === 1 && cat.sstate === 'idle', 'and can be stood down');
    } else console.log('(no guard spot near the third tower)');
  } else console.log('(no room for a third tower)');
}

// 5. alone against a manned tower, the garrison sallies out and smashes it
const T4 = enemyTower(42, 3);
if (T4) {
  const lone = spawnCatapult(g, works);
  run(g, 1);
  check(orderAttack(g, P, [lone.id], T4) === 1, 'a lone catapult is sent against a manned tower');
  check(runUntil(g, 180, () => lone.dead || !g.settlers.has(lone.id)), `the defenders came out and smashed it (tower ${alive(T4) ? 'stands' : 'fell'}, garrison ${T4.garrison.length})`);
  check(alive(T4), 'the tower still stands');
} else console.log('(no room for a fourth tower)');

log('events', JSON.stringify({ catapult: counts.catapult, siegehit: counts.siegehit, stonefall: counts.stonefall, razed: counts.razed, machine: counts.machine }));
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
