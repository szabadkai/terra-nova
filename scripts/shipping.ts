// Headless check of the player's shipping orders: a home harbour and a colony harbour on an island,
// one trade ship. With automatic supply switched off the planner ships nothing by itself; goods the
// player orders in the harbour panel are gathered, loaded and delivered; passengers booked there sail
// over (and can be called back while they wait); an order for something nobody has is kept rather
// than forgotten, is never trimmed by the planner, and survives a save and a load.
// Usage: npx tsx scripts/shipping.ts [seed]
import { Game } from '../src/game/game';
import {
  bookPassengers, bookedPassengers, cancelShipOrder, colonySite, harbourDestinations, launchShip, openShipOrder,
  placeShipOrder, shipOrders, shipRouteError,
} from '../src/game/sea';
import { decodeSave, encodeSave, restore, snapshot } from '../src/game/save';
import type { Building } from '../src/game/types';

const seed = Number(process.argv[2] ?? 7);
const g = new Game({ size: 160, seed, players: 2, aiLevel: 1 });
g.ai.length = 0;
const w = g.world;
const P = 0;
const hq = g.buildings.get(g.players[P].hq)!;
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const log = (...a: unknown[]) => console.log(`[${(g.time / 60).toFixed(1)}m]`, ...a);
const run = (x: Game, sec: number) => { for (let k = 0; k < sec * 4; k++) { x.update(0.25); x.events.length = 0; } };
const runUntil = (x: Game, sec: number, cond: () => boolean) => { for (let t = 0; t < sec * 4 && !cond(); t++) run(x, 0.25); return cond(); };

// ---- the home harbour, claimed by an instant tower
let site: { x: number; y: number } | null = null, bd = Infinity;
for (let y = 3; y < w.H - 6; y++) for (let x = 3; x < w.W - 6; x++) {
  if (w.region[w.idx(x, y)] !== w.region[hq.door]) continue;
  const d = Math.hypot(x - hq.cx, y - hq.cz);
  if (d >= bd) continue;
  if (g.placeError('harbour', P, x, y, true) && g.placeError('harbour', P, x, y)) continue;
  site = { x, y }; bd = d;
}
if (!site) throw new Error('no coast');
const t0 = g.addBuilding('tower_l', P, site.x - 4, site.y - 4, true);
const garrison = (b: Building) => {
  const sol = [...g.settlers.values()].find((s) => s.owner === P && s.job === 'swordsman' && s.inside === hq.id)!;
  hq.garrison = hq.garrison.filter((id) => id !== sol.id);
  sol.inside = b.id; sol.sstate = 'garrison'; sol.home = b.id; b.garrison.push(sol.id); b.occupied = true;
  sol.node = b.door; g.syncPos(sol);
};
garrison(t0);
g.territoryDirty = true;
g.update(0.1);
const home = g.addBuilding('harbour', P, site.x, site.y, true);
garrison(home);

// ---- a colony harbour on the nearest island coast, manned
let col: Building | null = null;
for (const I of g.isles) {
  for (let k = 0; k < 16 && !col; k++) {
    const a = (k / 16) * Math.PI * 2;
    const cs = colonySite(g, P, home, I.x + Math.cos(a) * I.r * 0.8, I.y + Math.sin(a) * I.r * 0.8);
    if (typeof cs === 'string') continue;
    col = g.addBuilding('harbour', P, cs.x, cs.y, true);
  }
  if (col) break;
}
if (!col) throw new Error('no island coast');
const colony = col;
colony.colony = true;
garrison(colony);
g.territoryDirty = true;
run(g, 1);
log('home', home.x, home.y, 'colony', colony.x, colony.y, 'regions', w.region[home.door], w.region[colony.door]);
check(harbourDestinations(g, home).some((b) => b.id === colony.id), 'the colony is offered as a destination');
check(shipRouteError(g, home, home.id) !== null && shipRouteError(g, home, colony.id) === null, 'a harbour cannot ship to itself, but to the colony');

// a ship, and automatic supply off at both ends
const ship = launchShip(g, P, { ...home, owner: P } as Building);
home.seaAuto = colony.seaAuto = false;
hq.stock.board += 30; hq.stock.stone += 20;
run(g, 30);
check(!g.seaOrders.some((o) => !o.manual), `with automatic supply off the planner orders nothing (${g.seaOrders.length} orders)`);

// 1. the player orders goods
const b0 = colony.stock.board, s0 = colony.stock.stone;
check(placeShipOrder(g, home, colony.id, 'board', 8) === null && placeShipOrder(g, home, colony.id, 'stone', 4) === null, 'ordered 8 boards and 4 stone to the colony');
check(placeShipOrder(g, home, colony.id, 'stone', -4) === null && !openShipOrder(g, home, colony.id, 'stone'), 'the stone order can be taken off again');
check(placeShipOrder(g, home, colony.id, 'stone', 4) === null, 'and put back');
const ob = openShipOrder(g, home, colony.id, 'board')!;
check(runUntil(g, 600, () => colony.stock.board >= b0 + 8 && colony.stock.stone >= s0 + 4), `the ship delivered them (boards ${colony.stock.board - b0}, stone ${colony.stock.stone - s0}; ship ${ship.state})`);
run(g, 3);
check(!openShipOrder(g, home, colony.id, 'board') && ob.delivered === 8, 'the order is complete');

// 2. passengers
const r1 = bookPassengers(g, home, colony.id, 'carrier', 3);
check(r1 === 3, `3 carriers booked (${r1})`);
for (let k = 0; k < 6; k++) {
  const s = g.addSettler(P, 'swordsman', hq.door);
  s.hidden = true; s.inside = hq.id; s.sstate = 'garrison'; s.home = hq.id; hq.garrison.push(s.id);
}
const r2 = bookPassengers(g, home, colony.id, 'soldier', 2);
check(r2 === 2, `2 soldiers booked (${r2})`);
const back = bookPassengers(g, home, colony.id, 'soldier', -1);
const sailor = bookedPassengers(g, home, colony.id, 'soldier');
check(back === 1 && sailor.length === 1, 'one soldier called back while waiting');
const onIsle = () => [...g.settlers.values()].filter((s) => s.owner === P && !s.dead && !s.aboard && w.region[s.node] === w.region[colony.door]);
const c0 = onIsle().filter((s) => s.job === 'carrier').length;
check(runUntil(g, 600, () => onIsle().filter((s) => s.job === 'carrier').length >= c0 + 3), `the carriers went ashore on the island (${onIsle().filter((s) => s.job === 'carrier').length - c0})`);
check(!!sailor[0] && runUntil(g, 300, () => !sailor[0].aboard && !sailor[0].voyage && w.region[sailor[0].node] === w.region[colony.door]), 'and the soldier');

// 3. an order nobody can fill is kept, even with automatic supply on again
home.seaAuto = colony.seaAuto = true;
check(placeShipOrder(g, home, colony.id, 'gold', 4) === null, 'ordered gold that nobody has');
const og = openShipOrder(g, home, colony.id, 'gold')!;
run(g, 300);
check(!!openShipOrder(g, home, colony.id, 'gold') && og.n === 4, `after 5 minutes it is still on order (${og.delivered}/${og.n})`);
// the planner never trims it, even when the colony needs nothing
check(shipOrders(g, P, home.id).includes(og), 'it is listed among the harbour\'s orders');

// 4. a save keeps the orders and the switches
home.seaAuto = false;
const copy = restore(await decodeSave(await encodeSave(snapshot(g))));
const cg = copy.seaOrders.find((o) => o.id === og.id);
check(!!cg && cg.manual === true && cg.n === 4 && copy.buildings.get(home.id)!.seaAuto === false && copy.buildings.get(colony.id)!.seaAuto === true, 'the saved game keeps the order and automatic supply settings');
cancelShipOrder(og);
run(g, 5);
check(!openShipOrder(g, home, colony.id, 'gold') && !g.seaOrders.includes(og), 'a called-off order is gone');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
