// Geologists: ore lies hidden until one probes the rock. He walks to the chosen mountain, knocks
// samples out of several spots and leaves a sign at each, showing what lies beneath and how much.
import { MINE_ORE, ORE_NAMES } from './defs';
import type { Game } from './game';
import { A, claim, plan } from './settlers';
import type { Settler, Sign } from './types';
import { sq } from '../core/fmath';

export const PROBES = 8;
export const PROBE_RADIUS = 4.5;
const SIGN_LIFE = 480;

function mountainNodes(g: Game, x: number, z: number, r = PROBE_RADIUS): number[] {
  const w = g.world;
  const out: number[] = [];
  w.forRadius(x, z, r, (i) => { if (w.isMountain(i) && !w.isWater(i) && !w.cliff[i] && !w.building[i]) out.push(i); });
  return out;
}

/** Why a geologist can't be sent to (x, z), or null. */
export function prospectError(g: Game, owner: number, x: number, z: number): string | null {
  const w = g.world;
  const xi = Math.round(x), zi = Math.round(z);
  if (!w.inBounds(xi, zi)) return 'Out of bounds';
  const i = w.idx(xi, zi);
  if (w.owner[i] !== owner) return 'Geologists only work inside your borders';
  if (mountainNodes(g, x, z).length < 4) return 'Geologists search the mountains for ore — pick a rocky slope';
  if (!g.nearestStorage(owner, x, z, w.regionAt(i))) return 'No storehouse on this land';
  return null;
}

/** Busy geologists of a player (walking out or probing). */
export function geologistsAtWork(g: Game, owner: number): number {
  let n = 0;
  for (const s of g.settlers.values()) if (s.owner === owner && !s.dead && s.task.startsWith('Prospect')) n++;
  return n;
}

/** Send a geologist to probe around (x, z). Returns an error message or null. */
export function sendGeologist(g: Game, owner: number, x: number, z: number): string | null {
  const err = prospectError(g, owner, x, z);
  if (err) return err;
  const w = g.world;
  const region = w.regionAt(w.idx(Math.round(x), Math.round(z)));
  // an idle geologist first
  let best: Settler | null = null, bd = Infinity;
  for (const s of g.settlers.values()) {
    if (s.owner !== owner || s.job !== 'geologist' || s.dead || s.home || s.voyage || s.aboard || s.task.startsWith('Prospect')) continue;
    if (w.region[s.node] !== region) continue;
    const d = sq(s.x - x) + sq(s.z - z);
    if (d < bd) { bd = d; best = s; }
  }
  if (best) {
    claim(g, best);
    tour(g, best, x, z);
    return null;
  }
  // otherwise a free carrier takes up the trade (a geologist needs only his little sample hammer)
  let c: Settler | null = null;
  bd = Infinity;
  for (const s of g.settlers.values()) {
    if (s.owner !== owner || s.job !== 'carrier' || !s.idle || s.dead || s.home || s.voyage || s.aboard || w.region[s.node] !== region) continue;
    const d = sq(s.x - x) + sq(s.z - z);
    if (d < bd) { bd = d; c = s; }
  }
  if (!c) return 'No free settler to become a geologist';
  claim(g, c);
  c.job = 'geologist';
  g.emit({ type: 'equip', x: c.x, z: c.z, owner: c.owner });
  tour(g, c, x, z);
  return null;
}

function tour(g: Game, s: Settler, x: number, z: number) {
  // the destination is kept on the settler so a saved game can send him out again
  s.target = g.world.idx(Math.round(x), Math.round(z));
  plan(s, tourActions(g, s, x, z), () => { s.task = ''; s.target = 0; });
}

/** A geologist whose tour was cut short by loading a game sets out for the same mountain again. */
export function resumeTour(g: Game, s: Settler) {
  const w = g.world;
  const x = w.nx(s.target), z = w.ny(s.target);
  if (prospectError(g, s.owner, x, z)) { s.task = ''; s.target = 0; return; }
  tour(g, s, x, z);
}

function tourActions(g: Game, s: Settler, x: number, z: number) {
  const w = g.world;
  const tx = Math.round(x), tz = Math.round(z);
  s.idle = false;
  s.task = 'Prospecting: walking to the mountain';
  const done = new Set<number>();
  const acts = [A.walk(w.idx(tx, tz), true)];
  for (let k = 0; k < PROBES; k++) {
    acts.push(A.do(() => {
      const node = pickProbe(g, s.owner, x, z, done);
      if (node < 0) return;
      done.add(node);
      s.task = `Prospecting (${done.size}/${PROBES})`;
      s.actions.unshift(
        A.walk(node, true),
        A.anim('pick', 2.6, node, (t) => { if (Math.floor(t / 0.65) !== Math.floor((t - 0.05) / 0.65)) g.emit({ type: 'stonehit', x: w.nx(node), z: w.ny(node) }); }),
        A.do(() => { placeSign(g, s.owner, node); }),
      );
    }));
  }
  acts.push(A.do(() => {
    s.task = '';
    s.target = 0;
    const st = g.nearestStorage(s.owner, s.x, s.z, w.region[s.node]);
    if (st) s.actions.push(A.walk(st.door));
    g.message(s.owner, 'A geologist has finished prospecting', x, z, 'good');
  }));
  return acts;
}

/** Next spot to sample: rock that nobody has probed yet, spread out over the area. */
function pickProbe(g: Game, owner: number, x: number, z: number, done: Set<number>): number {
  const w = g.world;
  let best = -1, bs = -Infinity;
  for (const i of mountainNodes(g, x, z)) {
    if (!w.walkable(i)) continue;
    let s = g.rng.next() * 2;
    if (!w.known(i, owner)) s += 3;
    for (const d of done) s -= Math.max(0, 3 - w.dist(i, d)) * 2;
    for (const sg of g.signs.values()) if (sg.owner === owner && w.dist(sg.node, i) < 1.5) s -= 4;
    if (s > bs) { bs = s; best = i; }
  }
  return best;
}

/** Leave a sign and learn what lies around the spot. */
export function placeSign(g: Game, owner: number, node: number): Sign {
  const w = g.world;
  // the dominant vein in the sample
  const tally = [0, 0, 0, 0, 0];
  w.forRadius(w.nx(node), w.ny(node), 1.5, (i) => { if (w.ore[i]) tally[w.ore[i]] += w.oreAmt[i]; });
  let ore = 0, amt = 0;
  for (let k = 1; k < tally.length; k++) if (tally[k] > amt) { amt = tally[k]; ore = k; }
  for (const sg of [...g.signs.values()]) if (sg.node === node && sg.owner === owner) g.signs.delete(sg.id);
  const sg: Sign = { id: g.id(), node, owner, ore, amt, t: g.time };
  g.signs.set(sg.id, sg);
  g.signsVersion++;
  const bit = 1 << owner;
  w.forRadius(w.nx(node), w.ny(node), 2.3, (i) => { w.prospected[i] |= bit; });
  w.oreDirty = true;
  g.emit({ type: 'sign', x: w.nx(node), z: w.ny(node), owner, kind: ORE_NAMES[ore], s: ore });
  return sg;
}

export function updateSigns(g: Game) {
  for (const sg of [...g.signs.values()]) {
    if (g.time - sg.t > SIGN_LIFE) { g.signs.delete(sg.id); g.signsVersion++; }
  }
}

/** Ore of a mine's kind this player knows of around a spot (for placement hints and the AI). */
export function knownOre(g: Game, owner: number, mine: string, x: number, z: number, r = 3.5): { known: number; amount: number } {
  const w = g.world;
  const ore = MINE_ORE[mine];
  let known = 0, amount = 0;
  w.forRadius(x, z, r, (i) => {
    if (!w.known(i, owner)) return;
    known++;
    if (w.ore[i] === ore) amount += w.oreAmt[i];
  });
  return { known, amount };
}

export const signLife = SIGN_LIFE;
