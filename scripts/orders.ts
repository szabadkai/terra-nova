// Headless check of direct soldier orders: call men out of the headquarters, march them to a
// spot where they stand guard, let them beat off an intruder and return to their posts, storm
// an enemy tower, garrison one of our own and go back to duty.
// Usage: npx tsx scripts/orders.ts [seed]
import { Game } from '../src/game/game';
import { callOut, fieldSoldiers, orderAttack, orderGarrison, orderMove, orderReturn } from '../src/game/orders';

const seed = Number(process.argv[2] ?? 7);
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
g.ai.length = 0; // no interference
const w = g.world;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const run = (sec: number) => { for (let k = 0; k < sec * 4; k++) g.update(0.25); g.events.length = 0; };
const hq = g.buildings.get(g.players[0].hq)!;

// 1. call out
const out = callOut(g, 0, hq, 2);
check(out.length === 5 && hq.garrison.length === 2, `five called out, two stay (${out.length}, ${hq.garrison.length})`);
run(20);
const ids = out.map((s) => s.id);
const atPost = () => ids.map((id) => g.settlers.get(id)!).filter((s) => s && !s.dead && s.sstate === 'hold' && s.node === s.order).length;
check(atPost() === 5, `they stand guard at their posts (${atPost()}/5)`);
run(30);
check(atPost() === 5 && hq.garrison.length === 2, 'the headquarters does not take them back while they guard');

// 2. march to a spot on our land
let spot = -1;
w.forRadius(hq.cx, hq.cz, 12, (i, x, y) => { if (spot < 0 && w.owner[i] === 0 && w.walkable(i) && Math.hypot(x - hq.cx, y - hq.cz) > 9) spot = i; });
const sx = w.nx(spot), sz = w.ny(spot);
check(orderMove(g, 0, ids, sx, sz) === 5, 'ordered to march');
run(40);
const posts = ids.map((id) => g.settlers.get(id)!.order);
const spread = Math.max(...posts.map((p) => w.dist(p, spot)));
check(atPost() === 5 && spread < 4, `they stand around the spot (${atPost()}/5, within ${spread.toFixed(1)})`);
check(new Set(posts).size === 5, 'each on his own spot');

// 3. an intruder comes near
const foe = g.addSettler(1, 'swordsman', posts[0] + 4);
foe.sstate = 'idle';
foe.hp = foe.maxHp = 60;
run(30);
check(foe.dead || !g.settlers.has(foe.id), 'the guards cut down an intruder');
run(25);
check(atPost() >= 4, `and go back to their posts (${atPost()}/5)`);

// 4. storm an enemy tower
let tower = null as ReturnType<typeof g.addBuilding> | null;
for (let r = 0; r < 10 && !tower; r++) w.forRadius(sx + 14, sz, r, (i, x, y) => {
  if (tower || w.owner[i] === 0) return;
  const a = g.anchorFor('tower_s', x, y);
  if (g.placeError('tower_s', 1, a.x, a.y, true) === null) tower = g.addBuilding('tower_s', 1, a.x, a.y, true);
});
if (tower) {
  const t = tower;
  const def = g.addSettler(1, 'swordsman', t.door);
  def.hidden = true; def.inside = t.id; def.sstate = 'garrison'; def.home = t.id; def.hp = 40;
  t.garrison.push(def.id);
  t.occupied = true;
  g.territoryDirty = true;
  run(1);
  check(orderAttack(g, 0, ids, t) > 0, 'ordered to attack the enemy tower');
  run(90);
  check(t.owner === 0, `the tower is taken (owner ${t.owner})`);
} else console.log('(no room for an enemy tower)');

// 5. back to duty: a fresh group marches out, then is sent back
const group = callOut(g, 0, hq, 1).map((x) => x.id);
run(5);
orderMove(g, 0, group, sx, sz);
run(30);
check(group.length > 0 && orderReturn(g, 0, group) === group.length, `${group.length} sent back to duty`);
run(90);
check(fieldSoldiers(g, 0).filter((x) => group.includes(x.id)).length === 0, 'they are all garrisoned again');

// 6. garrison a chosen building above its usual strength
let own = null as ReturnType<typeof g.addBuilding> | null;
w.forRadius(hq.cx, hq.cz, 11, (i, x, y) => {
  if (own) return;
  const a = g.anchorFor('tower_l', x, y);
  if (g.canPlace('tower_l', 0, a.x, a.y)) own = g.addBuilding('tower_l', 0, a.x, a.y, true);
});
if (own) {
  const t = own;
  t.desiredSoldiers = 1;
  run(40);
  check(t.garrison.length === 1, `a watchtower kept at one guard (${t.garrison.length})`);
  const men = callOut(g, 0, hq, 1).slice(0, 3);
  run(3);
  const n = orderGarrison(g, 0, men.map((x) => x.id), t);
  check(n === men.length && n > 0, `${n} sent into it`);
  run(60);
  check(t.garrison.length === 1 + n, `it holds them (${t.garrison.length}/${1 + n}, desired ${t.desiredSoldiers})`);
} else console.log('(no room for a watchtower)');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
