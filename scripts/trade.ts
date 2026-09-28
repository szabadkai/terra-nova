// Headless check of overland trade: a donkey ranch breeds donkeys on grain and water, two market
// places some way apart get a trade route, carriers stock the goods at the first market, donkeys
// carry them to the second and carriers take them on to the storehouse. Along the way the game is
// saved and restored while donkeys are on the road, and the copy must finish the route as well.
// Usage: npx tsx scripts/trade.ts [seed]
import { Game } from '../src/game/game';
import { BUILDINGS, BuildingType, GOODS } from '../src/game/defs';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import { donkeyCap, donkeysOf, marketTraffic, placeOrder, routeError } from '../src/game/trade';
import type { Building } from '../src/game/types';

const seed = Number(process.argv[2] ?? 7);
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
g.ai.length = 0; // the AI must not interfere
const w = g.world;
const P = 0;
const hq = g.buildings.get(g.players[P].hq)!;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const log = (...a: unknown[]) => console.log(`[${(g.time / 60).toFixed(1)}m]`, ...a);

/** The placeable site for `type` nearest to (x, z). */
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
const put = (type: BuildingType, x: number, z: number): Building => {
  const a = siteNear(x, z, type);
  if (!a) throw new Error(`no site for ${type} near ${x},${z}`);
  return g.addBuilding(type, P, a.x, a.y, true);
};
// the markets sit on opposite sides of the headquarters, the ranch below it
const A = put('market', hq.cx - 8, hq.cz - 2);
const B = put('market', hq.cx + 9, hq.cz + 3);
const ranch = put('donkeyfarm', hq.cx, hq.cz + 7);
log('markets', `${A.x},${A.y}`, `${B.x},${B.y}`, 'apart', Math.hypot(A.cx - B.cx, A.cz - B.cz).toFixed(1), 'ranch', `${ranch.x},${ranch.y}`);
hq.stock.grain += 20;
hq.stock.water += 20;
const boards0 = g.totalStock(P).board, stone0 = g.totalStock(P).stone;

/** Boards anywhere in the realm: stores, markets and on anyone's back. */
const boardsEverywhere = (x: Game) => {
  let n = x.totalStock(P).board;
  for (const s of x.settlers.values()) if (s.owner === P && !s.dead) { if (s.carrying === 'board') n++; if (s.pack === 'board') n++; }
  return n;
};

check(routeError(g, A, A.id) !== null, `a market cannot trade with itself: "${routeError(g, A, A.id)}"`);
check(routeError(g, A, 12345) !== null, `an unknown destination is refused: "${routeError(g, A, 12345)}"`);
check(placeOrder(g, A, B.id, 'board', 10) === null, 'ordered 10 boards A → B');
check(placeOrder(g, A, B.id, 'stone', 8) === null, 'ordered 8 stone A → B');
check(placeOrder(g, A, B.id, 'stone', -2) === null, 'trimmed the stone order to 6');
const stoneOrder = g.tradeOrders.find((o) => o.good === 'stone')!;
check(stoneOrder.n === 6, `stone order is ${stoneOrder.n}`);

let firstDonkey = -1, firstDelivery = -1, doneAt = -1, saved = false;
let copy: Game | null = null;
for (let t = 0; t < 30 * 60; t++) {
  g.update(1);
  g.events.length = 0;
  const donkeys = donkeysOf(g, P);
  if (firstDonkey < 0 && donkeys > 0) { firstDonkey = g.time; log('first donkey bred'); }
  const orders = g.tradeOrders.filter((o) => o.owner === P);
  const delivered = orders.reduce((n, o) => n + o.delivered, 0);
  if (firstDelivery < 0 && delivered > 0) { firstDelivery = g.time; log('first delivery at B'); }
  // save while a donkey is carrying something
  if (!saved && [...g.settlers.values()].some((s) => s.job === 'donkey' && s.carrying)) {
    saved = true;
    const bytes = await encodeSave(snapshot(g));
    copy = restore(await decodeSave(bytes));
    copy.ai.length = 0;
    log(`saved and restored (${(bytes.length / 1024).toFixed(0)} KB) with donkeys on the road`);
    const laden = [...copy.settlers.values()].filter((s) => s.job === 'donkey' && (s.carrying || s.pack));
    check(laden.length > 0 && laden.every((s) => s.target > 0), `restored copy: ${laden.length} laden donkeys keep their destination`);
  }
  if (t % 60 === 0) {
    const tr = marketTraffic(g, A);
    log(`donkeys ${donkeys}/${donkeyCap(g, P)} ranch="${ranch.status}" A: board ${A.stock.board} stone ${A.stock.stone} ready ${tr.ready} here ${tr.here} | B: board ${B.stock.board} stone ${B.stock.stone} | orders ${orders.map((o) => `${o.good} ${o.delivered}/${o.n}${o.loaded ? `+${o.loaded}` : ''}`).join(', ') || 'none'}`);
  }
  if (doneAt < 0 && g.players[P].traded >= 16) { doneAt = g.time; log('every order delivered'); }
  if (doneAt > 0 && g.time - doneAt > 90) break;
}
check(firstDonkey > 0 && firstDonkey < 6 * 60, `donkeys are bred (first after ${(firstDonkey / 60).toFixed(1)} min)`);
check(donkeysOf(g, P) <= donkeyCap(g, P), `the ranch stops at the cap (${donkeysOf(g, P)} of ${donkeyCap(g, P)})`);
check(firstDelivery > 0, `a caravan delivered (first after ${(firstDelivery / 60).toFixed(1)} min)`);
check(doneAt > 0, `the whole route was delivered (${(doneAt / 60).toFixed(1)} min)`);
check(g.players[P].traded === 16, `16 goods credited to the player (${g.players[P].traded})`);
check(g.tradeOrders.filter((o) => o.owner === P).length === 0, 'finished orders are cleared');
const done = [...g.buildings.values()].filter((b) => b.owner === P && b.type === 'market' && b.stock.board + b.stock.stone > 0);
check(done.length === 0, `goods that arrived went on to the storehouse (${done.map((b) => `${b.stock.board}/${b.stock.stone}`).join(' ') || 'markets empty'})`);
check(boardsEverywhere(g) === boards0 && g.totalStock(P).stone === stone0, `nothing was lost on the way (boards ${boardsEverywhere(g)}/${boards0}, stone ${g.totalStock(P).stone}/${stone0})`);
check(A.seaWant === null, 'the source market stops gathering');
check(g.population(P).donkeys === donkeysOf(g, P) && g.population(P).total < 60, 'donkeys are not counted as people');

// the restored copy finishes the same route on its own
if (copy) {
  const c = copy;
  let cDone = -1;
  for (let t = 0; t < 20 * 60 && cDone < 0; t++) {
    c.update(1);
    c.events.length = 0;
    if (c.players[P].traded >= 16) cDone = c.time;
  }
  check(cDone > 0, `the restored copy delivered its route too (${(cDone / 60).toFixed(1)} min)`);
  check(c.players[P].traded === 16, `and credited 16 goods (${c.players[P].traded})`);
  check(boardsEverywhere(c) === boards0, `with no boards lost (${boardsEverywhere(c)}/${boards0})`);
}

// a lost destination: donkeys on the road take their load to the storehouse instead
check(placeOrder(g, A, B.id, 'board', 4) === null, 'a new order of 4 boards');
let onRoad = false;
for (let t = 0; t < 6 * 60 && !onRoad; t++) {
  g.update(1);
  g.events.length = 0;
  onRoad = [...g.settlers.values()].some((s) => s.job === 'donkey' && s.carrying && s.target === B.id);
}
check(onRoad, 'a donkey set out with boards');
g.destroyBuilding(B, false);
for (let t = 0; t < 4 * 60; t++) { g.update(1); g.events.length = 0; }
check(g.tradeOrders.filter((o) => o.owner === P).length === 0, 'orders to the lost market are dropped');
check([...g.settlers.values()].every((s) => s.job !== 'donkey' || (!s.carrying && !s.pack && !s.target)), 'donkeys unloaded and stood down');
check(boardsEverywhere(g) === boards0, `the boards came back to the stores (${boardsEverywhere(g)}/${boards0})`);
void GOODS; void BUILDINGS;
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
