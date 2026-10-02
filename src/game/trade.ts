// Overland trade: market places, the trade routes between them and the donkeys that walk them.
//
// A market is the head of a route the player lays out: another of his markets on the same landmass
// and the goods to send there. Carriers stock those goods at the market, as they do a harbour's
// export pile; donkeys bred at the ranch wait at the markets, pick the goods up two at a time and
// walk them over; at the far end carriers take them on to a storehouse or straight to whoever
// needs them. Nothing here crosses water: that is what ships are for.
//
// A mission can open a rival's building to gifts (`ms.gifts`: the Ninth's camp, a hill fort): it is
// then a destination for the giver's markets, for the goods it wants, and what donkeys bring it is
// counted as given rather than stocked.
import { DONKEYS_PER_MARKET, DONKEY_LOAD, GOODS, GOOD_NAMES, Good, MAX_DONKEYS, emptyStock } from './defs';
import type { Game } from './game';
import { A, claim, park, parkable, plan } from './settlers';
import type { Building, Settler, TradeOrder } from './types';
import type { Gift } from './campaign';
import { atan2, hypot, sq } from '../core/fmath';

/** How many of a good one click in the market panel adds to (or takes off) an order. */
export const ORDER_STEP = 4;
const ORDER_MAX = 60;
/** A market never hoards more of a good than a few donkey loads ahead. */
const GATHER_AHEAD = 12;

const reg = (g: Game, b: Building) => g.world.region[b.door];

export function marketAlive(g: Game, id: number, owner: number): Building | null {
  const b = g.buildings.get(id);
  return b && b.type === 'market' && b.state === 'done' && b.owner === owner ? b : null;
}

/** Working markets of a player. */
export function marketsOf(g: Game, owner: number): Building[] {
  const out: Building[] = [];
  for (const b of g.buildings.values()) if (b.owner === owner && b.type === 'market' && b.state === 'done') out.push(b);
  return out;
}

/** The gift a mission has opened at a building for `owner` to give to, while it still stands and is not his. */
export function giftOf(g: Game, id: number, owner: number): Gift | null {
  const gift = g.ms?.gifts?.[id];
  if (!gift || gift.giver !== owner) return null;
  const b = g.buildings.get(id);
  return b && b.state === 'done' && b.owner !== owner ? gift : null;
}
export function giftAt(g: Game, id: number, owner: number): Building | null {
  return giftOf(g, id, owner) ? g.buildings.get(id)! : null;
}
/** How much more of a good a gift wants. */
export function giftWants(gift: Gift, gd: Good): number {
  return Math.max(0, (gift.wants[gd] ?? 0) - (gift.got[gd] ?? 0));
}
/** Where a route of `owner`'s may end: one of his markets, or a building open to his gifts. */
export function destAlive(g: Game, id: number, owner: number): Building | null {
  return marketAlive(g, id, owner) ?? giftAt(g, id, owner);
}

/** Where a route from `from` may lead: the same player's other markets on the same landmass, and the buildings open to his gifts there. */
export function destinationsOf(g: Game, from: Building): Building[] {
  const out = marketsOf(g, from.owner).filter((b) => b.id !== from.id && reg(g, b) === reg(g, from));
  for (const k of Object.keys(g.ms?.gifts ?? {})) {
    const b = giftAt(g, Number(k), from.owner);
    if (b && reg(g, b) === reg(g, from)) out.push(b);
  }
  return out;
}

/** Markets have no names: describe one by where it lies from a spot ("Market 18 to the NE"); a gift's
 *  building goes by its own ("The Ninth’s camp, 64 to the NW"). */
export function marketLabel(g: Game, b: Building, fromX: number, fromZ: number): string {
  const gift = g.ms?.gifts?.[b.id];
  const dx = b.cx - fromX, dz = b.cz - fromZ;
  const d = Math.round(hypot(dx, dz));
  if (d < 2) return gift ? gift.name : 'Market here';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  // north is -z on the map
  const a = atan2(dx, -dz);
  const k = ((Math.round((a / (Math.PI * 2)) * 8) % 8) + 8) % 8;
  return gift ? `${gift.name}, ${d} to the ${dirs[k]}` : `Market ${d} to the ${dirs[k]}`;
}

// ------------------------------------------------------------------ orders
export function openOrder(g: Game, from: Building, to: number, gd: Good): TradeOrder | undefined {
  return g.tradeOrders.find((o) => o.owner === from.owner && o.from === from.id && o.to === to && o.good === gd && o.n - o.delivered > 0);
}

/** Open orders leaving a market. */
export function ordersFrom(g: Game, from: Building): TradeOrder[] {
  return g.tradeOrders.filter((o) => o.owner === from.owner && o.from === from.id && o.n - o.delivered > 0);
}

/** Why goods can't be sent from `from` to market `to`, or null. */
export function routeError(g: Game, from: Building, to: number): string | null {
  if (from.type !== 'market' || from.state !== 'done') return 'Trade routes start at a finished market place';
  const dest = destAlive(g, to, from.owner);
  if (!dest) return 'Choose one of your other market places first';
  if (dest.id === from.id) return 'A market cannot trade with itself';
  if (reg(g, dest) !== reg(g, from)) return 'Donkeys cannot cross water — use harbours and ships for that';
  return null;
}

/** Order `n` more of `gd` from `from` to market `to`; a negative n takes that much off the open order. */
export function placeOrder(g: Game, from: Building, to: number, gd: Good, n: number): string | null {
  const err = routeError(g, from, to);
  if (err) return err;
  const o = openOrder(g, from, to, gd);
  if (n > 0) {
    let cap = ORDER_MAX;
    const gift = giftOf(g, to, from.owner);
    if (gift) {
      // a gift takes only what is wanted, and no more of it than is still wanted (less what is on order from elsewhere)
      const left = giftWants(gift, gd) - onOrderTo(g, from.owner, to, gd, o);
      if (!gift.wants[gd]) return `${gift.name} wants only ${wantList(gift)}`;
      if (left - (o ? o.n - o.delivered : 0) <= 0) return giftWants(gift, gd) ? `All the ${GOOD_NAMES[gd].toLowerCase()} ${gift.name.replace(/^The /, 'the ')} wants is on order` : `${gift.name} has all the ${GOOD_NAMES[gd].toLowerCase()} it wants`;
      cap = left;
    }
    if (o) o.n = Math.min(o.delivered + cap, o.n + n);
    else g.tradeOrders.push({ id: g.id(), owner: from.owner, from: from.id, to, good: gd, n: Math.min(cap, n), loaded: 0, delivered: 0, t: g.time });
    return null;
  }
  if (!o) return `Nothing of ${GOOD_NAMES[gd].toLowerCase()} is on order`;
  // what donkeys already carry is on its way regardless
  o.n = Math.max(o.delivered + o.loaded, o.n + n);
  return null;
}

/** What other open orders still have on the road or to send to `to` (not `except`). */
function onOrderTo(g: Game, owner: number, to: number, gd: Good, except?: TradeOrder): number {
  let n = 0;
  for (const o of g.tradeOrders) if (o !== except && o.owner === owner && o.to === to && o.good === gd) n += Math.max(0, o.n - o.delivered);
  return n;
}
/** "bread and meat" */
export function wantList(gift: Gift): string {
  const names = GOODS.filter((gd) => gift.wants[gd]).map((gd) => GOOD_NAMES[gd].toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'nothing';
}

export function cancelOrder(g: Game, o: TradeOrder) {
  o.n = o.delivered + o.loaded;
}

/** Credit a delivery to the order it belongs to (the oldest open one for that good and market). */
function credit(g: Game, owner: number, to: number, gd: Good) {
  const o = g.tradeOrders.find((x) => x.owner === owner && x.to === to && x.good === gd && x.loaded > 0);
  if (o) { o.loaded--; o.delivered++; o.t = g.time; }
}

/** Goods a donkey gave up on go back on the books as still to be sent. */
function uncredit(g: Game, owner: number, to: number, gd: Good) {
  const o = g.tradeOrders.find((x) => x.owner === owner && x.to === to && x.good === gd && x.loaded > 0);
  if (o) o.loaded--;
}

// ------------------------------------------------------------------ donkeys
export function isDonkey(s: Settler) {
  return s.job === 'donkey';
}

export function donkeysOf(g: Game, owner: number): number {
  let n = 0;
  for (const s of g.settlers.values()) if (s.owner === owner && s.job === 'donkey' && !s.dead) n++;
  return n;
}

/** How many donkeys a realm keeps: a couple, plus a few for every market place. */
export function donkeyCap(g: Game, owner: number): number {
  return Math.min(MAX_DONKEYS, 2 + DONKEYS_PER_MARKET * marketsOf(g, owner).length);
}

/** A donkey leaves the ranch. */
export function spawnDonkey(g: Game, ranch: Building): Settler {
  const s = g.addSettler(ranch.owner, 'donkey', ranch.door);
  s.wanderT = 1;
  g.syncPos(s);
  g.emit({ type: 'donkey', x: s.x, z: s.z, owner: s.owner });
  if (donkeysOf(g, ranch.owner) === 1) g.message(ranch.owner, 'Your first donkey has been bred — it will wait at a market place for goods to carry', s.x, s.z, 'good');
  return s;
}

interface Load { from: Building; to: Building; picks: { order: TradeOrder; good: Good }[] }

/** Goods at a market a donkey could set off with right now, per destination. */
function readyAt(g: Game, m: Building): Map<number, { order: TradeOrder; good: Good }[]> {
  const out = new Map<number, { order: TradeOrder; good: Good }[]>();
  const left = emptyStock();
  for (const gd of GOODS) left[gd] = m.stock[gd] - m.outgoing[gd];
  for (const o of g.tradeOrders) {
    if (o.owner !== m.owner || o.from !== m.id) continue;
    if (!destAlive(g, o.to, m.owner)) continue;
    let rem = o.n - o.loaded - o.delivered;
    while (rem > 0 && left[o.good] > 0) {
      let arr = out.get(o.to);
      if (!arr) out.set(o.to, (arr = []));
      arr.push({ order: o, good: o.good });
      left[o.good]--;
      rem--;
    }
  }
  return out;
}

/** The nearest market with goods waiting that no other donkey is already coming for. */
function findLoad(g: Game, s: Settler): Load | null {
  const w = g.world;
  const r = w.region[s.node];
  let best: Load | null = null, bd = Infinity;
  for (const m of marketsOf(g, s.owner)) {
    if (reg(g, m) !== r) continue;
    const d = sq(m.cx - s.x) + sq(m.cz - s.z);
    if (d >= bd) continue;
    const ready = readyAt(g, m);
    let pick: { order: TradeOrder; good: Good }[] | null = null, pn = 0, to = 0;
    for (const [dest, arr] of ready) if (arr.length > pn) { pn = arr.length; pick = arr; to = dest; }
    if (!pick) continue;
    const dest = destAlive(g, to, s.owner)!;
    bd = d;
    best = { from: m, to: dest, picks: pick.slice(0, DONKEY_LOAD) };
  }
  return best;
}

function holding(s: Settler): Good[] {
  const out: Good[] = [];
  if (s.carrying) out.push(s.carrying);
  if (s.pack) out.push(s.pack);
  return out;
}

/** Walk to the market, take the goods on, carry them over. Goods count as on the road from the
 *  moment a donkey sets out for them, so no other donkey sets out for the same ones. */
function fetch(g: Game, s: Settler, load: Load) {
  const { from, to, picks } = load;
  claim(g, s);
  for (const p of picks) { from.outgoing[p.good]++; p.order.loaded++; }
  let reserved = true;
  s.task = 'Going to the market for goods';
  plan(s, [
    A.walk(from.door),
    A.wait(0.7),
    A.do(() => {
      reserved = false;
      let taken = 0;
      for (const p of picks) {
        from.outgoing[p.good] = Math.max(0, from.outgoing[p.good] - 1);
        if (!marketAlive(g, from.id, s.owner) || from.stock[p.good] <= 0) { p.order.loaded = Math.max(0, p.order.loaded - 1); continue; }
        from.stock[p.good]--;
        p.order.t = g.time;
        if (!s.carrying) s.carrying = p.good; else s.pack = p.good;
        taken++;
      }
      if (!taken) return false;
      s.target = to.id;
      for (const gd of holding(s)) to.incoming[gd]++;
      s.fails = 0;
    }),
    ...deliverActions(g, s, to),
  ], () => {
    if (reserved) for (const p of picks) {
      if (g.buildings.has(from.id)) from.outgoing[p.good] = Math.max(0, from.outgoing[p.good] - 1);
      p.order.loaded = Math.max(0, p.order.loaded - 1);
    }
    dropIncoming(g, s);
    s.task = '';
    // a market it cannot reach is tried again later, not at once
    s.fails++;
    s.wanderT = Math.min(30, 3 * s.fails);
  });
}

function dropIncoming(g: Game, s: Settler) {
  const to = s.target ? g.buildings.get(s.target) : undefined;
  if (to) for (const gd of holding(s)) to.incoming[gd] = Math.max(0, to.incoming[gd] - 1);
}

function deliverActions(g: Game, s: Settler, to: Building) {
  return [
    A.do(() => { const gift = giftOf(g, to.id, s.owner); s.task = gift ? `Carrying a gift to ${gift.name}` : `Carrying goods to the market`; }),
    A.walk(to.door),
    A.wait(0.6),
    A.do(() => {
      if (!destAlive(g, to.id, s.owner)) return false;
      const gift = giftOf(g, to.id, s.owner);
      for (const gd of holding(s)) {
        to.incoming[gd] = Math.max(0, to.incoming[gd] - 1);
        if (gift) gift.got[gd] = (gift.got[gd] ?? 0) + 1;
        else to.stock[gd]++;
        credit(g, s.owner, to.id, gd);
        g.players[s.owner].traded++;
      }
      s.carrying = s.pack = null;
      s.target = 0;
      s.task = '';
      s.fails = 0;
      g.emit({ type: 'caravan', x: to.cx, z: to.cz, owner: s.owner, b: to.id });
    }),
    A.wait(1),
  ];
}

/** A donkey with goods on its back but no plan finishes the trip, or takes the goods to a storehouse. */
function deliverOrDump(g: Game, s: Settler) {
  const to = s.target ? destAlive(g, s.target, s.owner) : null;
  if (to && s.fails < 4) {
    s.idle = false;
    for (const gd of holding(s)) to.incoming[gd]++;
    plan(s, deliverActions(g, s, to), () => { s.fails++; dropIncoming(g, s); s.task = ''; });
    return;
  }
  // the route is lost: the goods are not delivered after all
  for (const gd of holding(s)) uncredit(g, s.owner, s.target, gd);
  s.target = 0;
  s.fails = 0;
  const st = g.nearestStorage(s.owner, s.x, s.z, g.world.region[s.node]);
  if (!st) { s.carrying = s.pack = null; return; }
  const goods = holding(s);
  for (const gd of goods) st.incoming[gd]++;
  s.idle = false;
  s.task = 'Taking the goods to the storehouse';
  plan(s, [A.walk(st.door), A.do(() => {
    for (const gd of goods) { st.incoming[gd] = Math.max(0, st.incoming[gd] - 1); if (g.buildings.has(st.id)) st.stock[gd]++; }
    s.carrying = s.pack = null;
    s.task = '';
  })], () => {
    for (const gd of goods) if (g.buildings.has(st.id)) st.incoming[gd] = Math.max(0, st.incoming[gd] - 1);
    s.carrying = s.pack = null;
    s.task = '';
  });
}

/** Donkeys look for goods to carry; with nothing to do they wait beside the nearest market. */
export function donkeyThink(g: Game, s: Settler, dt: number) {
  if (s.aboard || s.voyage) return;
  if (s.carrying || s.pack) { deliverOrDump(g, s); return; }
  s.idle = true;
  s.wanderT -= dt;
  if (s.wanderT > 0) return;
  s.wanderT = g.rng.range(1.5, 3.5);
  const load = findLoad(g, s);
  if (load) { fetch(g, s, load); return; }
  s.fails = 0;
  // stand around near a market (or the storehouse) without crowding the door
  s.wanderT = g.rng.range(6, 16);
  const w = g.world;
  let base: Building | null = null, bd = Infinity;
  for (const m of marketsOf(g, s.owner)) {
    if (reg(g, m) !== w.region[s.node]) continue;
    const d = sq(m.cx - s.x) + sq(m.cz - s.z);
    if (d < bd) { bd = d; base = m; }
  }
  base ??= g.nearestStorage(s.owner, s.x, s.z, w.region[s.node]);
  if (!base) return;
  const bx = w.nx(base.door), by = w.ny(base.door);
  if (hypot(s.x - bx, s.z - by) < 4 && g.rng.chance(0.6)) return;
  for (let k = 0; k < 6; k++) {
    const tx = bx + g.rng.int(-3, 4), ty = by + g.rng.int(1, 4);
    if (!w.inBounds(tx, ty)) continue;
    const ti = w.idx(tx, ty);
    if (!parkable(g, s, ti) || w.owner[ti] !== s.owner) continue;
    park(g, s, ti);
    return;
  }
}

/** After loading a game the reservations of donkeys that were still walking to a market are gone:
 *  what counts as on the road is exactly what donkeys carry on their backs. */
export function reconcileLoads(g: Game) {
  const carried = new Map<string, number>();
  for (const s of g.settlers.values()) {
    if (s.job !== 'donkey' || s.dead || !s.target) continue;
    for (const gd of holding(s)) { const k = `${s.owner}:${s.target}:${gd}`; carried.set(k, (carried.get(k) ?? 0) + 1); }
  }
  for (const o of g.tradeOrders) o.loaded = 0;
  for (const o of g.tradeOrders) {
    const k = `${o.owner}:${o.to}:${o.good}`;
    const n = carried.get(k) ?? 0;
    if (!n) continue;
    const take = Math.min(n, Math.max(0, o.n - o.delivered));
    o.loaded = take;
    carried.set(k, n - take);
  }
}

/** After loading a game: a donkey with goods on its back sets out again; the rest wait for work.
 *  (No random draws here: a loaded game carries on from exactly the saved random state.) */
export function resumeDonkey(g: Game, s: Settler) {
  if (s.carrying || s.pack) { deliverOrDump(g, s); return; }
  s.target = 0;
  s.idle = true;
}

// ------------------------------------------------------------------ tick
/** Keep the orders tidy and tell each market what to gather. */
export function updateTrade(g: Game, dt: number) {
  g.tradeT -= dt;
  if (g.tradeT > 0) return;
  g.tradeT = 1.5;
  for (const p of g.players) {
    if (!p.alive) continue;
    const markets = marketsOf(g, p.id);
    g.tradeOrders = g.tradeOrders.filter((o) => {
      if (o.owner !== p.id) return true;
      // a lost market (or a gift's building taken or gone) ends its routes once nothing is left on the road
      if (!marketAlive(g, o.from, p.id) || !destAlive(g, o.to, p.id)) return o.loaded > 0;
      return o.n - o.delivered > 0 || o.loaded > 0;
    });
    for (const m of markets) {
      m.seaWant = null;
      if (m.tradeTo && !destAlive(g, m.tradeTo, p.id)) m.tradeTo = 0;
    }
    for (const o of g.tradeOrders) {
      if (o.owner !== p.id) continue;
      const m = marketAlive(g, o.from, p.id);
      const rem = o.n - o.loaded - o.delivered;
      if (!m || rem <= 0) continue;
      if (!m.seaWant) m.seaWant = emptyStock();
      m.seaWant[o.good] += Math.min(rem, GATHER_AHEAD);
    }
  }
}

/** What is going on at a market, for its panel. */
export function marketTraffic(g: Game, m: Building) {
  let here = 0, coming = 0, ready = 0;
  for (const s of g.settlers.values()) {
    if (s.owner !== m.owner || s.job !== 'donkey' || s.dead) continue;
    if (s.target === m.id) coming++;
    else if (!s.target && hypot(s.x - m.cx, s.z - m.cz) < 6) here++;
  }
  for (const arr of readyAt(g, m).values()) ready += arr.length;
  let incoming = 0;
  for (const o of g.tradeOrders) if (o.owner === m.owner && o.to === m.id) incoming += o.n - o.delivered;
  return { here, coming, ready, incoming };
}
