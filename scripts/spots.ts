// Headless check that settlers standing about keep to spots of their own: idle carriers and crews
// around the storehouses, a busy AI economy, two groups of guards sent to the same place, and
// soldiers storming an enemy tower who fight its defender and wait round its door.
// Prints how many of the settlers standing still share their node with someone else.
// Usage: npx tsx scripts/spots.ts [seed] [minutes]
import { Game } from '../src/game/game';
import { orderAttack, orderMove } from '../src/game/orders';
import type { Settler } from '../src/game/types';

const seed = Number(process.argv[2] ?? 7);
const minutes = Number(process.argv[3] ?? 20);
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

const standing = (s: Settler) => !s.hidden && !s.dead && !s.aboard && s.next < 0;
/** Of the settlers matching `f` who stand still, how many share their node with another standing settler. */
function stacked(g: Game, f: (s: Settler) => boolean = () => true) {
  const at = new Map<number, number>();
  for (const s of g.settlers.values()) if (standing(s)) at.set(s.node, (at.get(s.node) ?? 0) + 1);
  let n = 0, k = 0;
  for (const s of g.settlers.values()) {
    if (!standing(s) || !f(s)) continue;
    n++;
    if (at.get(s.node)! > 1) k++;
  }
  return { n, k };
}

// 1. a whole game: player 0 sits idle, player 1's AI builds up
{
  const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
  const tot = [{ n: 0, k: 0 }, { n: 0, k: 0 }];
  let worst = 0;
  for (let t = 0; t < minutes * 60; t += 2) {
    for (let k = 0; k < 8; k++) g.update(0.25);
    g.events.length = 0;
    if (t < 30) continue; // let the start scatter settle
    for (const p of [0, 1]) {
      const r = stacked(g, (s) => s.owner === p);
      tot[p].n += r.n;
      tot[p].k += r.k;
      if (p === 1) worst = Math.max(worst, r.k);
    }
  }
  for (const p of [0, 1]) {
    const f = tot[p].k / Math.max(1, tot[p].n);
    console.log(`player ${p}: ${(f * 100).toFixed(1)}% of settlers standing still share a node`);
  }
  check(tot[0].k / tot[0].n < 0.03, 'idle settlers round the headquarters each stand apart');
  check(tot[1].k / tot[1].n < 0.06, `a busy economy keeps them apart too (worst sample ${worst})`);
  console.log(`  pop ${g.population(1).total} for player 1 after ${minutes} min`);
}

// 2. two groups of guards sent to the same spot, then an attack on a tower
{
  const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
  g.ai.length = 0;
  const w = g.world;
  const run = (sec: number) => { for (let k = 0; k < sec * 4; k++) g.update(0.25); g.events.length = 0; };
  const hq = g.buildings.get(g.players[0].hq)!;
  for (let k = 0; k < 10; k++) {
    const s = g.addSettler(0, 'swordsman', hq.door);
    s.hidden = true; s.inside = hq.id; s.sstate = 'garrison'; s.home = hq.id;
    hq.garrison.push(s.id);
  }
  let spot = -1;
  w.forRadius(hq.cx, hq.cz, 12, (i, x, y) => { if (spot < 0 && w.owner[i] === 0 && w.walkable(i) && Math.hypot(x - hq.cx, y - hq.cz) > 9) spot = i; });
  const a = hq.garrison.slice(0, 5), b = hq.garrison.slice(5, 10);
  orderMove(g, 0, a, w.nx(spot), w.ny(spot));
  run(2);
  orderMove(g, 0, b, w.nx(spot), w.ny(spot));
  run(40);
  const men = [...a, ...b].map((id) => g.settlers.get(id)!);
  const posts = new Set(men.map((s) => s.order));
  const nodes = new Set(men.filter((s) => standing(s)).map((s) => s.node));
  check(posts.size === 10 && nodes.size === 10, `two groups sent to one place take ten posts (${posts.size} posts, ${nodes.size} nodes)`);

  // a guard whose post someone else takes steps aside and makes the new spot his post
  const g0 = men[0];
  const intruder = men[1];
  intruder.order = g0.order;
  run(15);
  check(g0.node !== intruder.node && g0.node === g0.order && intruder.node === intruder.order, 'a guard crowded off his post takes the spot beside it');

  // storm an enemy tower whose defenders sally out: the rest wait around the door, one to a spot
  let tower = null as ReturnType<typeof g.addBuilding> | null;
  const sx = w.nx(spot), sz = w.ny(spot);
  for (let r = 0; r < 12 && !tower; r++) w.forRadius(sx + 14, sz, r, (i, x, y) => {
    if (tower || w.owner[i] === 0) return;
    const an = g.anchorFor('tower_s', x, y);
    if (g.placeError('tower_s', 1, an.x, an.y, true) === null) tower = g.addBuilding('tower_s', 1, an.x, an.y, true);
  });
  if (!tower) check(false, 'room for an enemy tower');
  else {
    const t = tower;
    // a stout defender holds the attackers off at the door for a while
    const def = g.addSettler(1, 'swordsman', t.door);
    def.hidden = true; def.inside = t.id; def.sstate = 'garrison'; def.home = t.id; def.hp = def.maxHp = 5000;
    t.garrison.push(def.id);
    t.occupied = true;
    g.territoryDirty = true;
    run(1);
    const sent = orderAttack(g, 0, men.map((s) => s.id), t);
    let worst = 0, sum = 0, samples = 0, fought = 0;
    for (let k = 0; k < 60; k++) {
      run(1);
      const at = men.filter((s) => !s.dead && standing(s) && w.dist(s.node, t.door) < 8);
      if (at.length < 3) continue;
      samples++;
      if (at.some((s) => s.engaged)) fought++;
      const doubled = at.length - new Set(at.map((s) => s.node)).size;
      sum += doubled;
      worst = Math.max(worst, doubled);
    }
    check(sent === 10 && samples > 20 && fought > 5, `ten men storm the tower and fight at its door (${sent} sent, ${fought}/${samples}s fighting)`);
    check(worst <= 1 && sum / Math.max(1, samples) < 0.25, `each fights or waits on a spot of his own (on average ${(sum / Math.max(1, samples)).toFixed(2)} doubled up, worst ${worst})`);
  }
}

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
