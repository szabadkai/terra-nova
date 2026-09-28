// Wild game. Hares live in every wood and deer in the big forests, and the trees decide how many:
// the map is cut into patches of CELL × CELL nodes, and a patch holds a hare for every HARE_TREES
// grown trees in it (at most HARE_MAX). Below that the hares breed, the more of them the faster;
// above it (the wood has been felled) one at a time moves to a neighbouring patch with room, or
// slips away into its burrow for good. A forester's new wood fills up again once its trees are half
// grown. Deer come back only where the patches round one hold DEER_TREES trees between them.
// Every animal keeps to its home: a hare hops about within HARE_LEASH of it, a deer within DEER_LEASH.
import { T_ROCK, T_SNOW } from './defs';
import type { Game } from './game';
import type { Animal } from './types';
import type { World } from './world';

export const CELL = 8;
/** grown trees a patch needs for each hare it holds */
export const HARE_TREES = 6;
/** most hares a patch holds */
export const HARE_MAX = 4;
/** grown trees the 3 × 3 patches round a deer's home need between them for deer to come back */
export const DEER_TREES = 90;
/** seconds between two rounds of breeding and moving out */
export const WILD_TICK = 10;
/** chance a patch with room gets a hare in a round: BREED + BREED_EACH for every hare already there */
const BREED = 0.025, BREED_EACH = 0.02;
const HARE_LEASH = 5, DEER_LEASH = 10;
/** how long a hare takes to vanish into its burrow */
export const BURROW_TIME = 1.2;

export const hareCap = (trees: number) => Math.min(HARE_MAX, Math.floor(trees / HARE_TREES));

const cells = (w: World) => ({ n: Math.ceil(w.W / CELL), m: Math.ceil(w.H / CELL) });
export const cellOf = (w: World, i: number) => Math.floor(w.ny(i) / CELL) * Math.ceil(w.W / CELL) + Math.floor(w.nx(i) / CELL);

/** Grown (half grown or more, not being felled) trees in each patch. */
export function habitat(g: Game): Int16Array {
  const w = g.world, { n, m } = cells(w);
  const c = new Int16Array(n * m);
  for (const t of g.trees.values()) {
    if (t.state === 'falling' || t.state === 'fallen' || t.growth < 0.5) continue;
    c[cellOf(w, t.node)]++;
  }
  return c;
}

/** Game a hunter could go after: alive, not already his quarry and not on its way out. */
export const huntable = (a: Animal) => a.alive && !a.reserved && !a.leave;

/** Hares and deer within r of (x, z), on the landmass of node `door`. */
export function gameNear(g: Game, x: number, z: number, r: number, door: number) {
  const w = g.world;
  let hares = 0, deer = 0;
  for (const a of g.animals.values()) {
    if (!a.alive || a.leave || w.region[a.node] !== w.region[door]) continue;
    if ((a.x - x) ** 2 + (a.z - z) ** 2 > r * r) continue;
    if (a.kind === 'hare') hares++;
    else deer++;
  }
  return { hares, deer };
}

/** Trees on node i and round it: how shaded it is (within 1) and how wooded (within 4). */
function cover(w: World, i: number) {
  const x = w.nx(i), y = w.ny(i);
  let shade = 0, wood = 0;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    if (dx * dx + dy * dy > 16 || !w.inBounds(x + dx, y + dy) || !w.tree[w.idx(x + dx, y + dy)]) continue;
    wood++;
    if (dx * dx + dy * dy <= 2) shade++;
  }
  return { shade, wood };
}

/** somewhere a hare could sit in patch `c`: walkable, no building, by the trees; out from under
 * the crowns if it can be (hares keep to the edges and the clearings of a wood) */
function spotIn(g: Game, c: number, tries: number): number {
  const w = g.world, { n } = cells(w);
  const x0 = (c % n) * CELL, y0 = Math.floor(c / n) * CELL;
  let best = -1, bs = Infinity;
  for (let k = 0; k < tries; k++) {
    const x = x0 + g.rng.int(0, CELL), y = y0 + g.rng.int(0, CELL);
    if (!w.inBounds(x, y)) continue;
    const i = w.idx(x, y);
    if (!w.walkable(i) || w.building[i]) continue;
    const { shade, wood } = cover(w, i);
    if (!wood) continue;
    if (shade < bs) { bs = shade; best = i; }
    if (!shade) break;
  }
  return best;
}

/** Hares up to what each wood holds, at the start of a game; none right by a start. */
export function populateWild(g: Game, starts: { x: number; y: number }[]) {
  const w = g.world;
  const hab = habitat(g);
  for (let c = 0; c < hab.length; c++) {
    const cap = hareCap(hab[c]);
    for (let k = 0; k < cap; k++) {
      const i = spotIn(g, c, 12);
      if (i < 0) break;
      if (starts.some((s) => Math.hypot(w.nx(i) - s.x, w.ny(i) - s.y) < 7)) continue;
      g.addAnimal(i, 0, 'hare');
    }
  }
}

/** A short run of hops from `from` towards `to`, stopping at anything in the way. */
function hops(w: World, from: number, to: number, max: number): number[] {
  const out: number[] = [];
  let x = w.nx(from), y = w.ny(from);
  const tx = w.nx(to), ty = w.ny(to);
  while (out.length < max && (x !== tx || y !== ty)) {
    x += Math.sign(tx - x);
    y += Math.sign(ty - y);
    const i = w.idx(x, y);
    if (!w.walkable(i) || w.building[i]) break;
    out.push(i);
  }
  return out;
}

const near = (w: World, a: number, b: number, r: number) => (w.nx(a) - w.nx(b)) ** 2 + (w.ny(a) - w.ny(b)) ** 2 <= r * r;

/** Where an animal standing still goes next: a hop or two about its home, or back to it. */
export function wander(g: Game, a: Animal) {
  const w = g.world;
  const hare = a.kind === 'hare';
  const leash = hare ? HARE_LEASH : DEER_LEASH;
  if (!near(w, a.node, a.home, leash + 2)) {
    // strayed (or moved to a new wood): back home the long way round
    const p = g.path.find(a.node, a.home, false, hare ? 600 : 1200);
    if (p && p.length) { a.path = p; a.pathI = 0; }
    else a.home = a.node;
    return;
  }
  const x = w.nx(a.node), y = w.ny(a.node);
  const R = hare ? 3 : 4;
  let fallback: number[] | null = null;
  for (let k = 0; k < 6; k++) {
    const tx = x + g.rng.int(-R, R + 1), ty = y + g.rng.int(-R, R + 1);
    if (!w.inBounds(tx, ty)) continue;
    const ti = w.idx(tx, ty);
    if (!w.walkable(ti) || !near(w, ti, a.home, leash)) continue;
    const p = hare ? hops(w, a.node, ti, R) : g.path.find(a.node, ti, false, 400);
    if (!p || !p.length) continue;
    // a hare would rather stop out from under the trees
    if (hare && cover(w, p[p.length - 1]).shade) { fallback ??= p; continue; }
    a.path = p;
    a.pathI = 0;
    return;
  }
  if (fallback) { a.path = fallback; a.pathI = 0; }
}

/** A round of breeding and moving out, every WILD_TICK seconds; deer come back every 45. */
export function updateWild(g: Game, dt: number) {
  g.wildT -= dt;
  if (g.wildT <= 0) {
    g.wildT = WILD_TICK;
    breed(g);
  }
  g.deerT -= dt;
  if (g.deerT <= 0) {
    g.deerT = 45;
    deerBack(g);
  }
  for (const a of g.animals.values()) if (a.leave && g.time - a.leave > BURROW_TIME) g.animals.delete(a.id);
}

function breed(g: Game) {
  const w = g.world, { n, m } = cells(w);
  const hab = habitat(g);
  const count = new Int16Array(n * m);
  const first = new Map<number, Animal[]>();
  for (const a of g.animals.values()) {
    if (a.kind !== 'hare' || !a.alive || a.leave) continue;
    const c = cellOf(w, a.home);
    count[c]++;
    let l = first.get(c);
    if (!l) first.set(c, (l = []));
    l.push(a);
  }
  for (let c = 0; c < hab.length; c++) {
    const cap = hareCap(hab[c]), k = count[c];
    if (k > cap) {
      // the wood is going: one hare moves to the neighbouring patch with most room, else leaves
      const a = first.get(c)!.find((h) => !h.reserved);
      if (!a) continue;
      const cx = c % n, cy = Math.floor(c / n);
      let to = -1, room = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy;
        if ((!dx && !dy) || x < 0 || y < 0 || x >= n || y >= m) continue;
        const d = y * n + x, r = hareCap(hab[d]) - count[d];
        if (r > room) { room = r; to = d; }
      }
      const i = to >= 0 ? spotIn(g, to, 10) : -1;
      const p = i >= 0 ? g.path.find(a.node, i, false, 800) : null;
      if (p) {
        a.home = i;
        a.path = p;
        a.pathI = 0;
        count[c]--;
        count[to]++;
      } else {
        a.leave = g.time;
        a.path = null;
      }
    } else if (k < cap && g.rng.chance(BREED + BREED_EACH * k)) {
      // a leveret by one of the hares there, or a newcomer under the trees
      const l = first.get(c);
      const i = l && l.length ? l[g.rng.int(0, l.length)].node : spotIn(g, c, 10);
      if (i >= 0) g.addAnimal(i, 0, 'hare');
    }
  }
}

function deerBack(g: Game) {
  let alive = 0;
  for (const a of g.animals.values()) if (a.kind === 'deer' && a.alive) alive++;
  if (alive >= g.deerTarget) return;
  const w = g.world, { n, m } = cells(w);
  const hab = habitat(g);
  const woods: number[] = [];
  for (let cy = 1; cy < m - 1; cy++) for (let cx = 1; cx < n - 1; cx++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += hab[(cy + dy) * n + cx + dx];
    if (s >= DEER_TREES) woods.push(cy * n + cx);
  }
  if (!woods.length) return;
  const i = spotIn(g, woods[g.rng.int(0, woods.length)], 12);
  if (i < 0) return;
  const t = w.terrain[i];
  if (t === T_ROCK || t === T_SNOW) return;
  const k = g.rng.int(1, 3), herd = 999 + g.rng.int(0, 1000);
  for (let j = 0; j < k; j++) g.addAnimal(i, herd, 'deer');
}
