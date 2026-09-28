// Direct orders for soldiers. The player picks men — in the field, or called out of a stronghold —
// and sends them to a spot to stand guard, against an enemy stronghold, into one of his own
// buildings, or back to their posts. Guards hold their ground: they charge foes that come near
// and return to their post afterwards. Catapults take the same orders (but never garrison).
import type { Game } from './game';
import { isCombatant, sendSoldierTo } from './military';
import { claim, exit } from './settlers';
import type { Building, Settler } from './types';

/** A guard charges foes this close to him… */
export const GUARD_RANGE = 6;
/** …but gives up the chase this far from his post. */
export const LEASH = 9;

/** Can the player give this settler orders? Soldiers in the field or in one of his strongholds, and catapults. */
export function commandable(g: Game, owner: number, s: Settler | undefined): s is Settler {
  if (!s || s.owner !== owner || !isCombatant(s) || s.dead || s.aboard || s.voyage) return false;
  if (s.inside) {
    const b = g.buildings.get(s.inside);
    return !!b && b.owner === owner && !!b.def.military && b.garrison.includes(s.id);
  }
  return true;
}

function pick(g: Game, owner: number, ids: Iterable<number>): Settler[] {
  const out: Settler[] = [];
  for (const id of ids) {
    const s = g.settlers.get(id);
    if (commandable(g, owner, s)) out.push(s);
  }
  return out;
}

/** Take a soldier off garrison duty and out of the building. */
function release(g: Game, s: Settler) {
  if (s.inside) {
    const b = g.buildings.get(s.inside);
    if (b) b.garrison = b.garrison.filter((id) => id !== s.id);
    exit(g, s);
  }
  claim(g, s);
  // a man ordered away breaks off his duel
  for (const o of g.settlers.values()) if (o.engaged === s.id) o.engaged = 0;
  s.engaged = 0;
  s.targetB = 0;
  s.target = 0;
}

/** Walkable spots around (x, z), nearest first, for a group to stand on, clear of other guards' posts. */
function formation(g: Game, x: number, z: number, men: Settler[], region: number): number[] {
  const w = g.world;
  const n = men.length;
  const ids = new Set(men.map((s) => s.id));
  const posts = new Set<number>();
  for (const o of g.settlers.values()) if (o.sstate === 'hold' && o.order >= 0 && !o.dead && isCombatant(o) && !ids.has(o.id)) posts.add(o.order);
  const out: { i: number; d: number }[] = [];
  const r = Math.ceil(Math.sqrt(n) * 1.3) + 2;
  w.forRadius(x, z, r, (i, _x, _y, d2) => {
    if (!w.walkable(i) || w.region[i] !== region || w.building[i] || w.reserve[i] || posts.has(i)) return;
    out.push({ i, d: d2 });
  });
  out.sort((a, b) => a.d - b.d);
  // every other node, so the men do not stand shoulder to shoulder
  const spaced: number[] = [];
  for (const o of out) {
    if (spaced.length >= n) break;
    if (spaced.some((j) => w.dist(j, o.i) < 1.2)) continue;
    spaced.push(o.i);
  }
  for (const o of out) { if (spaced.length >= n) break; if (!spaced.includes(o.i)) spaced.push(o.i); }
  return spaced;
}

/** Send soldiers to stand guard around (x, z). Returns how many went. */
export function orderMove(g: Game, owner: number, ids: Iterable<number>, x: number, z: number): number {
  const w = g.world;
  const xi = Math.round(x), zi = Math.round(z);
  if (!w.inBounds(xi, zi)) return 0;
  const region = w.regionAt(w.idx(xi, zi));
  // swordsmen take the front spots, bowmen stand behind them, catapults at the back
  const rank = (s: Settler) => (s.job === 'swordsman' ? 0 : s.job === 'bowman' ? 1 : 2);
  const men = pick(g, owner, ids).filter((s) => w.region[s.inside ? (g.buildings.get(s.inside)?.door ?? s.node) : s.node] === region)
    .sort((a, b) => rank(a) - rank(b));
  if (!men.length) return 0;
  const spots = formation(g, x, z, men, region);
  if (!spots.length) return 0;
  men.forEach((s, k) => {
    release(g, s);
    s.sstate = 'hold';
    s.order = spots[k % spots.length];
    s.idle = false;
  });
  g.emit({ type: 'order', x, z, owner, kind: 'move' });
  return men.length;
}

/** Send soldiers against an enemy stronghold. Returns how many went. */
export function orderAttack(g: Game, owner: number, ids: Iterable<number>, target: Building): number {
  if (target.owner === owner || !target.def.military || target.state !== 'done') return 0;
  const w = g.world;
  const region = w.region[target.door];
  let n = 0;
  for (const s of pick(g, owner, ids)) {
    const at = s.inside ? g.buildings.get(s.inside)?.door ?? s.node : s.node;
    if (w.region[at] !== region) continue;
    const post = s.inside || s.home;
    release(g, s);
    s.home = post;
    s.sstate = 'attack';
    s.targetB = target.id;
    s.order = -1;
    n++;
  }
  if (n) {
    g.emit({ type: 'attack', b: target.id, owner, x: target.cx, z: target.cz });
    g.emit({ type: 'order', x: target.cx, z: target.cz, owner, kind: 'attack' });
    g.message(target.owner, `Your ${target.def.name} is under attack!`, target.cx, target.cz, 'bad');
    target.underAttackT = 20;
  }
  return n;
}

/** Send soldiers into one of the player's own strongholds, as far as there is room. */
export function orderGarrison(g: Game, owner: number, ids: Iterable<number>, b: Building): number {
  if (b.owner !== owner || !b.def.military || b.state !== 'done') return 0;
  const w = g.world;
  let room = b.type === 'hq' ? Infinity : b.def.military.capacity - b.garrison.length - b.soldiersIncoming;
  let n = 0;
  for (const s of pick(g, owner, ids)) {
    if (room <= 0) break;
    if (s.inside === b.id || s.job === 'catapult') continue;
    if (w.region[s.inside ? g.buildings.get(s.inside)?.door ?? s.node : s.node] !== w.region[b.door]) continue;
    release(g, s);
    s.order = -1;
    sendSoldierTo(g, s, b);
    // he means to stay: the building keeps him even above its usual strength
    if (b.type !== 'hq') b.desiredSoldiers = Math.max(b.desiredSoldiers, Math.min(b.def.military.capacity, b.garrison.length + b.soldiersIncoming));
    room--;
    n++;
  }
  if (n) g.emit({ type: 'order', x: b.cx, z: b.cz, owner, kind: 'garrison' });
  return n;
}

/** Soldiers go back to garrison duty wherever they are needed. */
export function orderReturn(g: Game, owner: number, ids: Iterable<number>): number {
  let n = 0;
  for (const s of pick(g, owner, ids)) {
    if (s.inside) continue;
    claim(g, s);
    s.order = -1;
    s.targetB = 0;
    s.sstate = 'idle';
    n++;
  }
  return n;
}

/** Bring a stronghold's soldiers out to stand guard before its door, keeping `keep` inside. */
export function callOut(g: Game, owner: number, b: Building, keep = 1): Settler[] {
  if (b.owner !== owner || !b.def.military || b.state !== 'done') return [];
  const ids = b.garrison.slice(Math.max(0, keep));
  if (!ids.length) return [];
  const w = g.world;
  // form up a little way out from the door
  const dx = w.nx(b.door) - b.cx, dz = w.ny(b.door) - b.cz;
  const l = Math.hypot(dx, dz) || 1;
  const x = w.nx(b.door) + (dx / l) * 2.5, z = w.ny(b.door) + (dz / l) * 2.5;
  orderMove(g, owner, ids, x, z);
  return ids.map((id) => g.settlers.get(id)!).filter((s) => s && s.sstate === 'hold');
}

/** The player's soldiers standing in the field (guarding, idle or marching). */
export function fieldSoldiers(g: Game, owner: number): Settler[] {
  const out: Settler[] = [];
  for (const s of g.settlers.values()) if (commandable(g, owner, s) && !s.inside) out.push(s);
  return out;
}
