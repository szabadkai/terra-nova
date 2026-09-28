// Direct orders for soldiers. The player picks men — in the field, or called out of a stronghold —
// and sends them to a spot to stand guard, against an enemy stronghold, into one of his own
// buildings, or back to their posts. Guards hold their ground: they charge foes that come near
// and return to their post afterwards, or stand firm and let the foe come to them. Catapults take
// the same orders (but never garrison).
//
// A group sent to stand guard forms up in its drill: a line, a block, a wedge or a ring. The
// formation faces the way the group marched (in one of eight directions, so the ranks fall on the
// node grid), swordsmen in front, bowmen behind them, catapults at the back; each man takes the
// slot on his own side so the files do not cross, and the group keeps to its slowest man's pace
// so it arrives together.
import type { Game } from './game';
import { isCombatant, sendSoldierTo } from './military';
import { claim, exit } from './settlers';
import type { Building, Formation, Settler } from './types';

export type { Formation } from './types';

/** A guard charges foes this close to him… */
export const GUARD_RANGE = 6;
/** …but gives up the chase this far from his post. */
export const LEASH = 9;
/** A guard standing firm follows a foe no farther than this from his post. */
export const FIRM_LEASH = 2.5;
export const FORMATIONS: Formation[] = ['line', 'block', 'wedge', 'ring'];
/** The widest rank of a line. */
const LINE_WIDTH = 10;
/** How much slower than his own pace a man may march to keep with his group. */
const MAX_PACE = 1.6;

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
  s.face = null;
  s.pace = 1;
}

/** Where a man stands for his orders: at the door of the building he is in, else his node. */
const standing = (g: Game, s: Settler) => (s.inside ? g.buildings.get(s.inside)?.door ?? s.node : s.node);
/** Swordsmen take the front, bowmen stand behind them, catapults at the back. */
const kindOf = (s: Settler) => (s.job === 'swordsman' ? 0 : s.job === 'bowman' ? 1 : 2);
/** A catapult is hauled along much slower than a man walks. */
const slowness = (s: Settler) => (s.job === 'catapult' ? 1.75 : 1);

/** The drill most of these men are in. */
export function drillOf(men: Settler[]): Formation {
  const n: Record<Formation, number> = { line: 0, block: 0, wedge: 0, ring: 0 };
  for (const s of men) n[s.drill ?? 'line']++;
  return FORMATIONS.reduce((a, b) => (n[b] > n[a] ? b : a), 'line');
}

/** One place in a formation, relative to its centre: an offset, the kind of man it is for, the way he faces. */
interface Slot { x: number; z: number; kind: number; face: number }

/**
 * The slots of a formation of `counts[kind]` men facing `a` (a multiple of 45°), relative to its
 * centre. Facing along the grid the ranks are two nodes apart man to man and one node deep, every
 * other rank shifted half a step; facing diagonally the men stand on diagonal neighbours. Both put
 * the men on nodes exactly and never shoulder to shoulder.
 */
function layout(shape: Formation, counts: number[], a: number): Slot[] {
  const fx = Math.sin(a), fz = Math.cos(a); // forward
  const rx = Math.cos(a), rz = -Math.sin(a); // across
  const out: Slot[] = [];
  const n = counts[0] + counts[1] + counts[2];
  if (!n) return out;
  if (shape === 'ring') {
    // swordsmen round the outside, bowmen on an inner ring, catapults in the middle, all facing out
    let outer = counts[0] ? 0 : 1, inner = counts[0] && counts[1] ? 1 : -1;
    if (!counts[0] && !counts[1]) outer = -1;
    const cats = counts[2];
    // a man every 1.8 steps round a ring, rings two steps apart, so that they stay clear of each other on the grid
    const per = 1.8 / (Math.PI * 2);
    let rIn = inner >= 0 ? Math.max(cats ? 2 : 1.5, counts[inner] * per) : 0;
    if (cats > 1 && inner >= 0) rIn = Math.max(rIn, 3);
    let rOut = outer >= 0 ? Math.max(2, counts[outer] * per) : 0;
    if (inner >= 0) rOut = Math.max(rOut, rIn + 2);
    else if (cats && outer >= 0) rOut = Math.max(rOut, cats > 1 ? 3 : 2);
    const ring = (kind: number, r: number) => {
      const c = counts[kind];
      for (let j = 0; j < c; j++) {
        const t = a + (Math.PI * 2 * j) / c;
        out.push({ x: Math.sin(t) * r, z: Math.cos(t) * r, kind, face: t });
      }
    };
    if (outer >= 0) ring(outer, rOut);
    if (inner >= 0) ring(inner, rIn);
    for (let j = 0; j < cats; j++) {
      // catapults huddle in the middle, a couple of nodes apart, aimed the way the group faces
      const t = a + (Math.PI * 2 * j) / Math.max(1, cats);
      const r = cats > 1 ? 1.2 : 0;
      out.push({ x: Math.sin(t) * r, z: Math.cos(t) * r, kind: 2, face: a });
    }
    return out;
  }
  const diag = Math.round(a / (Math.PI / 4)) % 2 !== 0;
  const U = diag ? Math.SQRT2 : 2, V = diag ? Math.SQRT2 : 1, stagger = !diag;
  // ranks, front first, each a list of kinds
  const rows: number[][] = [];
  const kinds: number[] = [];
  for (let k = 0; k < 3; k++) for (let j = 0; j < counts[k]; j++) kinds.push(k);
  if (shape === 'line') {
    // each kind in ranks of its own, as wide as the biggest kind (up to LINE_WIDTH)
    const W = Math.min(LINE_WIDTH, Math.max(...counts));
    for (let k = 0; k < 3; k++) for (let left = counts[k]; left > 0; left -= W) rows.push(new Array(Math.min(W, left)).fill(k));
  } else if (shape === 'block') {
    // as deep as it is wide
    const W = Math.max(1, Math.round(diag ? Math.sqrt(n) : Math.sqrt(n / 2)));
    for (let i = 0; i < n; i += W) rows.push(kinds.slice(i, i + W));
  } else {
    // one man at the point, each rank behind it wider by one step to either side
    let i = 0;
    for (let r = 0; i < n; r++) { const c = diag ? 2 * r + 1 : r + 1; rows.push(kinds.slice(i, i + c)); i += c; }
  }
  // how far back each rank stands, and whether it is shifted half a step: staggered ranks alternate;
  // the ranks of a line shift as their own number of men centres them best, and a rank shifted
  // like the one before stands two nodes behind it rather than right at its back
  const depth: number[] = [], shift: number[] = [];
  rows.forEach((row, r) => {
    if (!stagger) { depth.push(r * V); shift.push(0); return; }
    const own = row.length % 2 === 0 ? 0.5 : 0;
    if (r === 0) { depth.push(0); shift.push(own); return; }
    if (shape === 'line') { shift.push(own); depth.push(depth[r - 1] + (own === shift[r - 1] ? 2 : 1)); return; }
    shift.push((shift[r - 1] + 0.5) % 1);
    depth.push(depth[r - 1] + V);
  });
  // the rank nearest the middle of the men stands on the centre
  let mean = 0;
  rows.forEach((row, r) => { mean += row.length * depth[r]; });
  const mid = Math.round(mean / n / V) * V;
  rows.forEach((row, r) => {
    const c = row.length;
    const k0 = Math.round(-(c - 1) / 2 - shift[r]);
    const across: number[] = [];
    for (let j = 0; j < c; j++) across.push((k0 + j + shift[r]) * U);
    // the front kinds of a mixed rank take its middle, or the wings of a wedge
    across.sort((p, q) => (shape === 'wedge' ? Math.abs(q) - Math.abs(p) : Math.abs(p) - Math.abs(q)) || p - q);
    const fwd = mid - depth[r];
    row.forEach((kind, j) => out.push({ x: across[j] * rx + fwd * fx, z: across[j] * rz + fwd * fz, kind, face: a }));
  });
  return out;
}

export interface FormationPlan {
  men: Settler[];
  /** node each man takes, in the order of `men` */
  nodes: number[];
  /** the way each man faces at his post */
  faces: number[];
  shape: Formation;
  /** the way the formation faces */
  face: number;
  x: number;
  z: number;
}

/**
 * Where the men would stand to guard (x, z) in formation `shape` (the men's own drill when not
 * given), facing `face` (the way they march there when not given, else the way they face now).
 */
export function planFormation(g: Game, owner: number, ids: Iterable<number>, x: number, z: number, shape?: Formation, face?: number): FormationPlan | null {
  const w = g.world;
  const xi = Math.round(x), zi = Math.round(z);
  if (!w.inBounds(xi, zi)) return null;
  const region = w.regionAt(w.idx(xi, zi));
  if (!region) return null;
  const men = pick(g, owner, ids).filter((s) => w.region[standing(g, s)] === region);
  if (!men.length) return null;
  shape ??= drillOf(men);
  let mx = 0, mz = 0;
  for (const s of men) { const at = standing(g, s); mx += w.nx(at); mz += w.ny(at); }
  mx /= men.length;
  mz /= men.length;
  if (face === undefined) {
    if (Math.hypot(xi - mx, zi - mz) >= 2.5) face = Math.atan2(xi - mx, zi - mz);
    else face = men.find((s) => s.face !== null)?.face ?? Math.atan2(xi - mx, zi - mz);
  }
  const step = Math.PI / 4;
  const a = Math.round(face / step) * step;
  const counts = [0, 0, 0];
  for (const s of men) counts[kindOf(s)]++;
  const slots = layout(shape, counts, a);

  // each slot on the free node nearest to it, clear of other guards' posts
  const mine = new Set(men.map((s) => s.id));
  const posts = new Set<number>();
  for (const o of g.settlers.values()) if (o.sstate === 'hold' && o.order >= 0 && !o.dead && isCombatant(o) && !mine.has(o.id)) posts.add(o.order);
  const taken = new Set<number>();
  const free = (i: number) => w.walkable(i) && w.region[i] === region && !w.building[i] && !w.reserve[i] && !posts.has(i) && !taken.has(i);
  const cramped = (i: number) => {
    const ix = w.nx(i), iz = w.ny(i);
    for (const t of taken) if (Math.abs(w.nx(t) - ix) + Math.abs(w.ny(t) - iz) <= 1) return true;
    return false;
  };
  const place = (px: number, pz: number) => {
    for (const r of [2.5, 6]) {
      let best = -1, bd = Infinity;
      w.forRadius(px, pz, r, (i, nx, nz) => {
        if (!free(i)) return;
        const d = (nx - px) ** 2 + (nz - pz) ** 2 + (cramped(i) ? 4 : 0);
        if (d < bd) { bd = d; best = i; }
      });
      if (best >= 0) return best;
    }
    return -1;
  };
  const slotNode = slots.map((sl) => {
    const i = place(xi + sl.x, zi + sl.z);
    if (i >= 0) taken.add(i);
    return i;
  });

  // match men to slots kind by kind, each on his own side so that the files do not cross
  const nodes = new Array<number>(men.length).fill(-1);
  const faces = new Array<number>(men.length).fill(a);
  const rx = Math.cos(a), rz = -Math.sin(a);
  for (let k = 0; k < 3; k++) {
    const who = men.map((s, i) => ({ s, i })).filter((m) => kindOf(m.s) === k);
    const where = slots.map((sl, j) => ({ sl, j })).filter((o) => o.sl.kind === k);
    if (!who.length) continue;
    if (shape === 'ring') {
      // round the ring in order, turned so that the men walk the least
      const ang = (px: number, pz: number) => Math.atan2(px - xi, pz - zi);
      who.sort((p, q) => ang(w.nx(standing(g, p.s)), w.ny(standing(g, p.s))) - ang(w.nx(standing(g, q.s)), w.ny(standing(g, q.s))));
      where.sort((p, q) => Math.atan2(p.sl.x, p.sl.z) - Math.atan2(q.sl.x, q.sl.z));
      let best = 0, bd = Infinity;
      for (let off = 0; off < where.length; off++) {
        let d = 0;
        who.forEach((m, j) => {
          const o = where[(j + off) % where.length], at = standing(g, m.s);
          d += (w.nx(at) - xi - o.sl.x) ** 2 + (w.ny(at) - zi - o.sl.z) ** 2;
        });
        if (d < bd) { bd = d; best = off; }
      }
      who.forEach((m, j) => { const o = where[(j + best) % where.length]; nodes[m.i] = slotNode[o.j]; faces[m.i] = o.sl.face; });
    } else {
      const side = (px: number, pz: number) => (px - mx) * rx + (pz - mz) * rz;
      who.sort((p, q) => side(w.nx(standing(g, p.s)), w.ny(standing(g, p.s))) - side(w.nx(standing(g, q.s)), w.ny(standing(g, q.s))));
      where.sort((p, q) => (p.sl.x * rx + p.sl.z * rz) - (q.sl.x * rx + q.sl.z * rz));
      who.forEach((m, j) => { const o = where[j]; nodes[m.i] = slotNode[o.j]; faces[m.i] = o.sl.face; });
    }
  }
  // anyone left without a slot (no room there) stands as near as he can
  for (let i = 0; i < men.length; i++) {
    if (nodes[i] >= 0) continue;
    const at = place(xi, zi);
    if (at >= 0) { taken.add(at); nodes[i] = at; }
  }
  const ok = nodes.map((n, i) => ({ n, i })).filter((o) => o.n >= 0);
  if (!ok.length) return null;
  return {
    men: ok.map((o) => men[o.i]), nodes: ok.map((o) => o.n), faces: ok.map((o) => faces[o.i]),
    shape, face: a, x: xi, z: zi,
  };
}

/** Send soldiers to stand guard around (x, z) in formation. Returns how many went. */
export function orderMove(g: Game, owner: number, ids: Iterable<number>, x: number, z: number, shape?: Formation, face?: number): number {
  const p = planFormation(g, owner, ids, x, z, shape, face);
  if (!p) return 0;
  const w = g.world;
  // the group keeps to the pace of the man with the longest march, so that it arrives together
  const time = p.men.map((s, k) => Math.max(2, w.dist(standing(g, s), p.nodes[k])) * slowness(s));
  const longest = Math.max(...time);
  p.men.forEach((s, k) => {
    release(g, s);
    s.sstate = 'hold';
    s.order = p.nodes[k];
    s.face = p.faces[k];
    s.drill = p.shape;
    s.pace = p.men.length > 1 ? Math.min(MAX_PACE, Math.max(1, longest / time[k])) : 1;
    s.idle = false;
  });
  g.emit({ type: 'order', x: p.x, z: p.z, owner, kind: 'move' });
  return p.men.length;
}

/** Put the men in drill `shape`; those standing guard form up in it at once where they stand. */
export function setDrill(g: Game, owner: number, ids: Iterable<number>, shape: Formation): number {
  const men = pick(g, owner, ids);
  for (const s of men) s.drill = shape;
  const w = g.world;
  // guards re-form round the middle of their posts, one group per landmass
  const guards = men.filter((s) => s.sstate === 'hold' && s.order >= 0 && !s.inside);
  const byRegion = new Map<number, Settler[]>();
  for (const s of guards) {
    const r = w.region[s.order];
    byRegion.set(r, [...(byRegion.get(r) ?? []), s]);
  }
  for (const grp of byRegion.values()) {
    let x = 0, z = 0;
    for (const s of grp) { x += w.nx(s.order); z += w.ny(s.order); }
    const face = grp.find((s) => s.face !== null)?.face ?? undefined;
    orderMove(g, owner, grp.map((s) => s.id), x / grp.length, z / grp.length, shape, face);
  }
  return men.length;
}

/** Have the men stand firm at their posts (or charge foes that come near again). */
export function setFirm(g: Game, owner: number, ids: Iterable<number>, firm: boolean): number {
  const men = pick(g, owner, ids);
  for (const s of men) s.firm = firm;
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
    g.message(target.owner, `Your ${target.def.name} is under attack!`, target.cx, target.cz, 'bad', target.id);
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
    s.face = null;
    s.pace = 1;
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
  // form up a little way out from the door, facing away from it
  const dx = w.nx(b.door) - b.cx, dz = w.ny(b.door) - b.cz;
  const l = Math.hypot(dx, dz) || 1;
  const x = w.nx(b.door) + (dx / l) * 3, z = w.ny(b.door) + (dz / l) * 3;
  orderMove(g, owner, ids, x, z, undefined, Math.atan2(dx, dz));
  return ids.map((id) => g.settlers.get(id)!).filter((s) => s && s.sstate === 'hold');
}

/** The player's soldiers standing in the field (guarding, idle or marching). */
export function fieldSoldiers(g: Game, owner: number): Settler[] {
  const out: Settler[] = [];
  for (const s of g.settlers.values()) if (commandable(g, owner, s) && !s.inside) out.push(s);
  return out;
}
