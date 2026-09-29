// Pioneers: settlers with a shovel who stake out free land beside the border, patch by patch.
// Sent to a spot, each one digs in at the edge of his realm nearest to it and works outwards
// until the land around the spot is claimed. Military borders override staked land: an enemy
// tower takes it for good.
import type { Game } from './game';
import { equip, findToolSource } from './economy';
import { A, abortPlan, claim, idleWander, plan } from './settlers';
import type { Settler } from './types';
import { DX8, DY8 } from './world';
import { hypot, sq } from '../core/fmath';

/** Land within this distance of the spot a pioneer is sent to gets claimed. */
export const PIONEER_RADIUS = 7;
const DIG = 2.4;
const STAKE_R = 1.5;

/** Free dry land that touches `owner`'s territory. */
function claimable(g: Game, owner: number, i: number) {
  const w = g.world;
  if (w.owner[i] >= 0 || w.isWater(i)) return false;
  const x = w.nx(i), y = w.ny(i);
  if (x < 3 || y < 3 || x >= w.W - 3 || y >= w.H - 3) return false;
  for (let d = 0; d < 8; d++) if (w.owner[w.idx(x + DX8[d], y + DY8[d])] === owner) return true;
  return false;
}

/** Frontier nodes a pioneer on landmass `region` could stake around (x, z). */
function frontier(g: Game, owner: number, x: number, z: number, region: number): number[] {
  const w = g.world;
  const out: number[] = [];
  w.forRadius(x, z, PIONEER_RADIUS, (i) => { if (w.region[i] === region && claimable(g, owner, i)) out.push(i); });
  return out;
}

/** Why pioneers can't be sent to (x, z), or null. */
export function pioneerError(g: Game, owner: number, x: number, z: number): string | null {
  const w = g.world;
  const xi = Math.round(x), zi = Math.round(z);
  if (!w.inBounds(xi, zi)) return 'Out of bounds';
  const i = w.idx(xi, zi);
  const o = w.owner[i];
  if (o >= 0 && o !== owner) return 'That land belongs to another kingdom';
  const region = w.regionAt(i);
  if (!region) return 'Pioneers stake out land, not water';
  if (!g.storageRegions(owner).has(region)) return 'Your settlers cannot reach this land';
  if (!frontier(g, owner, x, z, region).length) {
    return o === owner ? 'That land is already yours — pick a spot just beyond your border' : 'Pioneers claim free land beside your border — pick a spot closer to it';
  }
  return null;
}

/** Pioneers of a player out staking land. */
export function pioneersAtWork(g: Game, owner: number): number {
  let n = 0;
  for (const s of g.settlers.values()) if (s.owner === owner && s.job === 'pioneer' && !s.dead && s.order >= 0) n++;
  return n;
}

/** Send one pioneer to stake out the land around (x, z). Returns an error message or null. */
export function sendPioneer(g: Game, owner: number, x: number, z: number): string | null {
  const err = pioneerError(g, owner, x, z);
  if (err) return err;
  const w = g.world;
  const target = w.idx(Math.round(x), Math.round(z));
  const region = w.regionAt(target);
  // a pioneer with nothing to do first
  let best: Settler | null = null, bd = Infinity;
  for (const s of g.settlers.values()) {
    if (s.owner !== owner || s.job !== 'pioneer' || s.dead || s.order >= 0 || s.voyage || s.aboard || w.region[s.node] !== region) continue;
    const d = sq(s.x - x) + sq(s.z - z);
    if (d < bd) { bd = d; best = s; }
  }
  if (best) {
    claim(g, best);
    best.order = target;
    best.fails = 0;
    return null;
  }
  // otherwise a free carrier fetches a shovel and takes up the trade
  const src = findToolSource(g, owner, 'shovel', x, z, region);
  if (!src) return 'No shovel in your storehouses — pioneers need one';
  let c: Settler | null = null;
  bd = Infinity;
  for (const s of g.settlers.values()) {
    if (s.owner !== owner || s.job !== 'carrier' || !s.idle || s.dead || s.home || s.voyage || s.aboard || w.region[s.node] !== region) continue;
    const d = sq(s.x - src.cx) + sq(s.z - src.cz);
    if (d < bd) { bd = d; c = s; }
  }
  if (!c) return 'No free settler to become a pioneer';
  equip(g, c, src, 'shovel', 'pioneer', null);
  c.order = target;
  c.fails = 0;
  return null;
}

/** Call a pioneer back from his work. */
export function recallPioneer(g: Game, s: Settler) {
  if (s.job !== 'pioneer' || s.order < 0) return;
  abortPlan(g, s);
  finish(g, s, false);
}

/** Pioneers with an order dig their way outwards; without one they wait by the storehouse. */
export function pioneerThink(g: Game, s: Settler, dt: number) {
  if (s.order < 0 || s.voyage || s.aboard) return idleWander(g, s, dt);
  s.idle = false;
  const w = g.world;
  const node = pickSpot(g, s);
  if (node < 0 || s.fails > 5) { finish(g, s, true); return; }
  s.target = node;
  s.task = 'Pioneering: staking out land';
  plan(s, [
    A.walk(node, true),
    A.anim('dig', DIG, node, (t) => { if (Math.floor(t / 0.8) !== Math.floor((t - 0.05) / 0.8)) g.emit({ type: 'dig', x: w.nx(node), z: w.ny(node) }); }),
    A.do(() => {
      s.fails = 0;
      s.target = 0;
      stake(g, s.owner, node);
    }),
  ], () => { s.fails++; s.target = 0; });
}

/** The nearest frontier node around the order, keeping clear of fellow pioneers. */
function pickSpot(g: Game, s: Settler): number {
  const w = g.world;
  const tx = w.nx(s.order), tz = w.ny(s.order);
  const others: number[] = [];
  for (const o of g.settlers.values()) if (o !== s && o.owner === s.owner && o.job === 'pioneer' && o.order >= 0 && o.target) others.push(o.target);
  let best = -1, bs = Infinity;
  for (const i of frontier(g, s.owner, tx, tz, w.region[s.node])) {
    const x = w.nx(i), y = w.ny(i);
    let sc = hypot(x - s.x, y - s.z) + hypot(x - tx, y - tz) * 0.6 + g.rng.next() * 1.5;
    for (const o of others) if (w.dist(o, i) < 3) sc += 8;
    if (sc < bs) { bs = sc; best = i; }
  }
  return best;
}

/** Claim the free land around a spot a pioneer has dug in at. */
export function stake(g: Game, owner: number, node: number) {
  const w = g.world;
  let n = 0;
  w.forRadius(w.nx(node), w.ny(node), STAKE_R, (i) => {
    if (w.owner[i] >= 0 || w.isWater(i)) return;
    w.owner[i] = owner;
    w.claim[i] = owner;
    n++;
  });
  if (!n) return;
  w.ownerDirty = true;
  w.exploredDirty = true;
  g.ownerVersion++;
  g.emit({ type: 'staked', x: w.nx(node), z: w.ny(node), owner });
}

function finish(g: Game, s: Settler, done: boolean) {
  const w = g.world;
  const order = s.order;
  s.order = -1;
  s.fails = 0;
  s.target = 0;
  s.task = '';
  s.idle = true;
  if (done && order >= 0) {
    let others = false;
    for (const o of g.settlers.values()) if (o !== s && o.owner === s.owner && o.job === 'pioneer' && o.order === order) others = true;
    if (!others) g.message(s.owner, 'Your pioneers have staked out the land', w.nx(order), w.ny(order), 'good');
  }
  const st = g.nearestStorage(s.owner, s.x, s.z, w.region[s.node]);
  if (st) plan(s, [A.walk(st.door, true)]);
}
