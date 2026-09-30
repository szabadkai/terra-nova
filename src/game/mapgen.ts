// Procedural map generation: island continent with hills, mountains, lakes, forests, rock outcrops,
// ore veins and fish, in phases (the starts, their resource anchors, the height field, the islands,
// the land bridges, smoothing, then what grows on the heights). A recipe (a designed map for the
// campaign, recipes.ts) steps into the phases: its own starts and anchors, carving on the height
// field, sheer rock nobody can cross; free play never takes a recipe's branch, so its maps are the
// same for every seed as they always were.
import { Simplex } from '../core/noise';
import { RNG, clamp, smoothstep } from '../core/rng';
import {
  ORE_COAL, ORE_GOLD, ORE_IRON, ORE_STONE,
  T_DIRT, T_FOREST, T_GRASS, T_MEADOW, T_ROCK, T_SAND, T_SNOW, T_SWAMP,
} from './defs';
import { DX8, DY8, WATER_LEVEL, World } from './world';
import { atan2, cos, hypot, sin, sq } from '../core/fmath';

export interface MapGenResult {
  starts: { x: number; y: number }[];
  trees: { node: number; species: number; growth: number }[];
  stones: { node: number; amount: number }[];
  deer: { node: number; herd: number }[];
  isles: { x: number; y: number; r: number }[];
}

export interface MapOptions {
  size: number;
  seed: number;
  players: number;
  islands?: boolean; // offshore islands (default on)
  /** a designed map (the campaign's): see MapRecipe */
  recipe?: MapRecipe;
}

// ------------------------------------------------------------------ recipes
export type Pt = [number, number];

/** A round patch: a forest, a rock field, a mountain, a lake (map nodes). */
export interface Blob { x: number; y: number; r: number }

/**
 * Carving on the height field, applied in order after the noise and before the islands. Heights are
 * above the water line (0 is the shore, 1.3 the flattened ground round a start, 8 snow).
 */
export type Carve =
  /** a mountain range along a line; with `wall`, its spine is sheer rock that nobody can cross */
  | { op: 'range'; path: Pt[]; width: number; height: number; wall?: boolean }
  /** a saddle through a range: the ground is let down to `height` (default 1.6) and the wall opened, over `r` */
  | { op: 'gap'; at: Pt; r: number; height?: number }
  /** a road cut along a line through whatever is there: level with its ends' surroundings, the wall opened */
  | { op: 'road'; path: Pt[]; width: number; height?: number }
  /** a road that climbs: from `from` above the water at its start to `to` at its end, the wall opened (the one way up a plateau) */
  | { op: 'ramp'; path: Pt[]; width: number; from: number; to: number }
  /** raised flat ground (a table mountain); with `wall`, its rim is a cliff */
  | { op: 'plateau'; at: Pt; r: number; height: number; wall?: boolean }
  /** a lake or bay: the ground let down below the water line */
  | { op: 'water'; at: Pt; r: number; depth?: number }
  /** a channel of water along a line: a strait, an estuary, a moat */
  | { op: 'channel'; path: Pt[]; width: number; depth?: number }
  /** land raised out of the water, to at least `height` (default 0.9) */
  | { op: 'land'; at: Pt; r: number; height?: number }
  /** level ground at `height` (default 1.3), for a town */
  | { op: 'flat'; at: Pt; r: number; height?: number };

export interface MapRecipe {
  id: string;
  size: number;
  /** the start of each player, in slot order */
  starts: Pt[];
  /**
   * The land's frame: 'continent' is free play's island in the sea; 'land' runs the land to the map's
   * edges (an inland region, walled or not by the recipe's own ranges); 'sea' is open water, the
   * recipe raising its own islands out of it (`land` ops).
   */
  frame?: 'continent' | 'land' | 'sea';
  /** the noise's own lakes and mountains (default on); the carving comes on top */
  lakes?: boolean;
  mountains?: boolean;
  /** free play's veins by noise in every mountain (default off: a designed map has only its `ore`) */
  veins?: boolean;
  /** free play's sand in dry lowlands far from the starts (default off) */
  desert?: boolean;
  /** free play's forests, rocks, mountain and lake round every start (default off: the recipe places its own) */
  anchors?: boolean;
  forests?: Blob[];
  rocks?: Blob[];
  /** mountains that are only heights: the anchors' kind, with ore laid on them by `ore` */
  peaks?: Blob[];
  lakeBlobs?: Blob[];
  carve?: Carve[];
  /** offshore islands: free play's rule (default off for a recipe), or none */
  islands?: boolean;
  /** land bridges between the starts when the sea parts them (default on) */
  connect?: boolean;
  /** veins laid on rock: kind, and the amount per node */
  ore?: { at: Pt; r: number; kind: number; amt: [number, number] }[];
  /** no trees or rocks here (a battlefield, a road) */
  clear?: Blob[];
  /** the islands the recipe raises (its `land` ops) that are free to settle: the game's isles, for colonies and the computer's expeditions */
  isles?: Blob[];
}

// ------------------------------------------------------------------ the generator's state between phases
interface Isle { x: number; y: number; r: number; mtn: Blob | null }
interface Gen {
  world: World;
  W: number;
  H: number;
  S: number;
  opt: MapOptions;
  recipe: MapRecipe | null;
  rng: RNG;
  nBase: Simplex; nMount: Simplex; nMoist: Simplex; nDetail: Simplex; nOre: Simplex; nLake: Simplex;
  starts: { x: number; y: number }[];
  /** the anchors round the starts (free play) and the recipe's own */
  mountains: Blob[]; forests: Blob[]; rocks: Blob[]; lakes: Blob[];
  /** the mountains that get the guaranteed deposits (the starts' own) */
  startMountains: Blob[];
  mountainness: Float32Array;
  moist: Float32Array;
  /** a recipe's sheer rock, 0..1 before it is marked on the world (see cliffs) */
  wall: Float32Array | null;
  isles: Isle[];
  landings: { x: number; y: number }[];
  occupied: Uint8Array;
}

export function generateMap(world: World, opt: MapOptions): MapGenResult {
  const g = begin(world, opt);
  placeStarts(g);
  placeAnchors(g);
  shapeHeights(g);
  if (g.recipe) carve(g, g.recipe);
  raiseIslands(g);
  // ensure land connectivity between starts: carve land bridges if needed
  if (g.recipe?.connect !== false) ensureConnectivity(world, g.starts);
  smooth(g);
  if (g.recipe) cliffs(g);
  classify(g);
  seedOre(g);
  seedFish(g);
  const trees = plantTrees(g);
  const stones = scatterStones(g);
  const deer = placeDeer(g);
  clearYards(g);
  world.computeRegions();
  const isles = g.isles.map((I) => ({ x: I.x, y: I.y, r: I.r }));
  for (const I of g.recipe?.isles ?? []) isles.push({ x: I.x, y: I.y, r: I.r });
  return { starts: g.starts, trees, stones, deer, isles };
}

function begin(world: World, opt: MapOptions): Gen {
  const seed = opt.seed;
  return {
    world, W: world.W, H: world.H, S: world.W, opt, recipe: opt.recipe ?? null,
    rng: new RNG(seed),
    nBase: new Simplex(seed * 7 + 1),
    nMount: new Simplex(seed * 7 + 2),
    nMoist: new Simplex(seed * 7 + 3),
    nDetail: new Simplex(seed * 7 + 4),
    nOre: new Simplex(seed * 7 + 5),
    nLake: new Simplex(seed * 7 + 6),
    starts: [], mountains: [], forests: [], rocks: [], lakes: [], startMountains: [],
    mountainness: new Float32Array(world.N),
    moist: new Float32Array(world.N),
    wall: opt.recipe ? new Float32Array(world.N) : null,
    isles: [], landings: [],
    occupied: new Uint8Array(world.N),
  };
}

const blobF = (b: Blob, x: number, y: number, jitter: Simplex) => {
  const dx = x - b.x, dy = y - b.y;
  const d = Math.sqrt(dx * dx + dy * dy) / b.r;
  const n = jitter.noise(x * 0.15, y * 0.15) * 0.3;
  return 1 - smoothstep(0.55, 1.0, d + n);
};

const startInfluence = (g: Gen, x: number, y: number, r0: number, r1: number) => {
  let m = 0;
  for (const s of g.starts) {
    const d = hypot(x - s.x, y - s.y);
    m = Math.max(m, 1 - smoothstep(r0, r1, d));
  }
  return m;
};

const nearLanding = (g: Gen, x: number, y: number) => g.landings.some((L) => hypot(x - L.x, y - L.y) < 3.6);

// ------------------------------------------------------------------ phases
/** Start positions around a circle, or where the recipe puts them. */
function placeStarts(g: Gen) {
  const { S, opt, rng } = g;
  if (g.recipe) {
    for (const [x, y] of g.recipe.starts.slice(0, opt.players)) g.starts.push({ x: Math.round(x), y: Math.round(y) });
    return;
  }
  const baseAng = rng.range(0, Math.PI * 2);
  const R = S * (opt.players > 2 ? 0.3 : 0.31);
  for (let p = 0; p < opt.players; p++) {
    const a = baseAng + (p / opt.players) * Math.PI * 2 + rng.range(-0.15, 0.15);
    g.starts.push({
      x: Math.round(S / 2 + cos(a) * R),
      y: Math.round(S / 2 + sin(a) * R * 0.92),
    });
  }
}

/** Resource "anchors" near each start so every player has a fair economy; a recipe's own on top. */
function placeAnchors(g: Gen) {
  const { S, rng } = g;
  if (!g.recipe || g.recipe.anchors) {
    for (const s of g.starts) {
      const toCenter = atan2(S / 2 - s.y, S / 2 - s.x);
      const aM = toCenter + Math.PI + rng.range(-1.2, 1.2); // mountain behind player (towards edge-ish)
      g.mountains.push({ x: s.x + cos(aM) * 22, y: s.y + sin(aM) * 22, r: 8.5 });
      const aF = aM + rng.range(1.4, 2.0);
      g.forests.push({ x: s.x + cos(aF) * 13, y: s.y + sin(aF) * 13, r: 6.5 });
      const aF2 = aM - rng.range(1.4, 2.2);
      g.forests.push({ x: s.x + cos(aF2) * 17, y: s.y + sin(aF2) * 17, r: 5.5 });
      const aR = aF + rng.range(1.0, 1.6);
      g.rocks.push({ x: s.x + cos(aR) * 11, y: s.y + sin(aR) * 11, r: 2.6 });
      const aL = aF2 - rng.range(0.9, 1.4);
      g.lakes.push({ x: s.x + cos(aL) * 19, y: s.y + sin(aL) * 19, r: 5.5 });
    }
    g.startMountains.push(...g.mountains);
  }
  const r = g.recipe;
  if (r) {
    g.mountains.push(...(r.peaks ?? []));
    g.forests.push(...(r.forests ?? []));
    g.rocks.push(...(r.rocks ?? []));
    g.lakes.push(...(r.lakeBlobs ?? []));
  }
}

/** The height field from noise: the land's frame, lakes, hills, mountains, the starts flattened. */
function shapeHeights(g: Gen) {
  const { world, W, H, S, nBase, nMount, nMoist, nDetail, nLake } = g;
  const r = g.recipe;
  const land = r?.frame === 'land';
  const noLakes = r?.lakes === false, noMountains = r?.mountains === false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / S, v = y / S;
      const dx = u - 0.5, dy = v - 0.5;
      let d = Math.sqrt(dx * dx + dy * dy) * 2;
      d += nBase.fbm(u * 3, v * 3, 4) * 0.22;
      // (an inland frame keeps the land to the edges, and only a trace of the sea at the corners)
      const mask = land ? 1 - smoothstep(1.3, 1.6, d) : r?.frame === 'sea' ? 0 : 1 - smoothstep(0.7, 0.98, d);
      const e = 0.5 + 0.5 * nBase.fbm(u * 4.5 + 10, v * 4.5 + 10, 5);
      let c = mask * (0.55 + 0.45 * e) - 0.32;

      // lakes
      if (!noLakes) {
        const lk = nLake.fbm(u * 5, v * 5, 3);
        const lakeCarve = smoothstep(0.32, 0.55, lk) * 0.55;
        c -= lakeCarve * (1 - startInfluence(g, x, y, 10, 18));
      }
      for (const L of g.lakes) c -= blobF(L, x, y, nDetail) * 0.6;

      let h: number;
      if (c > 0) h = WATER_LEVEL + 0.05 + c * 4.5;
      else h = WATER_LEVEL + c * 9;

      // rolling hills
      h += nDetail.fbm(u * 14, v * 14, 3) * 0.55 * mask;

      // mountains
      const mm = noMountains ? 0 : smoothstep(0.18, 0.42, nMount.fbm(u * 2.6 + 3.3, v * 2.6 + 7.1, 3));
      let mt = mm * (1 - startInfluence(g, x, y, 13, 24));
      for (const M of g.mountains) mt = Math.max(mt, blobF(M, x, y, nMount));
      mt *= mask;
      const ridge = nMount.ridged(u * 7, v * 7, 5);
      const mh = mt * (1.5 + ridge * 7.5 + nDetail.noise(u * 20, v * 20) * 0.6);
      h += mh;
      g.mountainness[i] = mt * (0.4 + ridge);

      // flatten around starts
      const fl = startInfluence(g, x, y, 9, 15);
      h = h * (1 - fl) + (WATER_LEVEL + 1.3 + nDetail.noise(u * 20, v * 20) * 0.15) * fl;

      world.h[i] = h;
      g.moist[i] = nMoist.fbm(u * 6, v * 6, 4);
    }
  }
}

/** Offshore islands: rich, unclaimed land reachable only by ship. */
function raiseIslands(g: Gen) {
  const { world, W, H, S, opt, rng, nDetail, nMount } = g;
  const { isles, landings } = g;
  const wantIsles = g.recipe ? (g.recipe.islands ? (S >= 200 ? 4 : S >= 150 ? 3 : 2) : 0) : opt.islands === false ? 0 : S >= 200 ? 4 : S >= 150 ? 3 : 2;
  for (let tries = 0; tries < 400 && isles.length < wantIsles; tries++) {
    // big ones first; later tries settle for smaller isles that fit the corners
    const r = S * rng.range(0.042, tries < 200 ? 0.07 : 0.05);
    const a = rng.range(0, Math.PI * 2);
    const D = S * rng.range(0.38, 0.72);
    const x = S / 2 + cos(a) * D, y = S / 2 + sin(a) * D;
    if (x - r < 5 || y - r < 5 || x + r > W - 6 || y + r > H - 6) continue;
    if (g.starts.some((st) => hypot(st.x - x, st.y - y) < r + 24)) continue;
    if (isles.some((o) => hypot(o.x - x, o.y - y) < o.r + r + 10)) continue;
    // open sea all around, with a channel to the mainland wide enough to sail
    let deep = 0, n = 0, ring = 0, ringDeep = 0;
    world.forRadius(x, y, r + 4.5, (i, _x, _y, d2) => {
      const dp = world.h[i] < WATER_LEVEL - 0.35;
      n++;
      if (dp) deep++;
      if (d2 > sq(r * 1.3)) { ring++; if (dp) ringDeep++; }
    });
    if (deep < n * 0.9 || ringDeep < ring * 0.985) continue;
    // the mountain sits on the seaward side, away from the landing
    const ma = atan2(y - S / 2, x - S / 2) + rng.range(-0.9, 0.9);
    const mtn = rng.chance(0.85) ? { x: x + cos(ma) * r * 0.35, y: y + sin(ma) * r * 0.35, r: r * 0.5 } : null;
    isles.push({ x, y, r, mtn });
  }
  for (const I of isles) {
    world.forRadius(I.x, I.y, I.r * 1.5, (i, x, y) => {
      const u = x / S, v = y / S;
      const dd = hypot(x - I.x, y - I.y) / I.r + nDetail.noise(x * 0.12 + 17, y * 0.12 + 5) * 0.3;
      let h = world.h[i];
      if (dd < 1) {
        const land = WATER_LEVEL + 0.12 + (1 - smoothstep(0.55, 1.0, dd)) * 1.3 + Math.max(0, nDetail.fbm(u * 14, v * 14, 3)) * 0.5;
        h = Math.max(h, land);
        if (I.mtn) {
          const mt = blobF(I.mtn, x, y, nMount);
          const ridge = nMount.ridged(u * 7, v * 7, 5);
          h += mt * (1.4 + ridge * 5.5);
          g.mountainness[i] = Math.max(g.mountainness[i], mt * (0.5 + ridge));
        }
      } else if (dd < 1.5) {
        h = Math.max(h, WATER_LEVEL - 0.15 - ((dd - 1) / 0.5) * 3.2);
      }
      world.h[i] = h;
    });
    // a sheltered landing facing the mainland: flat, open meadow by deep water
    const ta = atan2(S / 2 - I.y, S / 2 - I.x) + rng.range(-0.5, 0.5);
    const lx = I.x + cos(ta) * I.r * 0.72, ly = I.y + sin(ta) * I.r * 0.72;
    landings.push({ x: lx, y: ly });
    world.forRadius(lx, ly, 3.4, (i, x, y, d2) => {
      if (world.h[i] < WATER_LEVEL - 0.1) return;
      const k = 1 - smoothstep(2.2, 3.4, Math.sqrt(d2));
      world.h[i] = world.h[i] * (1 - k) + (WATER_LEVEL + 0.45) * k;
      g.mountainness[i] *= 1 - k;
      void x; void y;
    });
    const fa = ta + Math.PI + rng.range(-1.2, 1.2);
    g.forests.push({ x: I.x + cos(fa) * I.r * 0.4, y: I.y + sin(fa) * I.r * 0.4, r: I.r * 0.42 });
    g.rocks.push({ x: I.x + cos(fa + 1.6) * I.r * 0.45, y: I.y + sin(fa + 1.6) * I.r * 0.45, r: 1.8 });
  }
  void H;
}

/** A slight smoothing pass to remove single-node spikes. */
function smooth(g: Gen) {
  const { world, W, H } = g;
  const tmp = new Float32Array(world.h);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let s = 0;
      for (let d = 0; d < 8; d++) s += world.h[i + DX8[d] + DY8[d] * W];
      tmp[i] = world.h[i] * 0.5 + (s / 8) * 0.5;
    }
  }
  world.h.set(tmp);
}

/** Terrain materials from the heights, the slope, the moisture and the mountains. */
function classify(g: Gen) {
  const { world, W, H, S, nDetail, nMoist, moist, mountainness } = g;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const h = world.h[i];
      const hh = h - WATER_LEVEL;
      const slope = world.slopeAt(i);
      const m = moist[i];
      const mnt = mountainness[i];
      let t = T_GRASS;
      if (hh < -0.02) t = hh < -1.2 ? T_SAND : T_SAND;
      else if (hh < 0.3) t = m > 0.35 && slope < 0.15 && startInfluence(g, x, y, 12, 16) < 0.5 ? T_SWAMP : T_SAND;
      else if (mnt > 0.55 || slope > 0.85) t = hh > 8.2 + nDetail.noise(x * 0.1, y * 0.1) * 0.8 ? T_SNOW : T_ROCK;
      else if (mnt > 0.35 && slope > 0.4) t = T_ROCK;
      else if (m > 0.22) t = T_FOREST;
      else if (m < -0.28) t = T_MEADOW;
      else t = T_GRASS;
      // desert patches in dry lowlands far from starts
      const dry = nMoist.fbm(x / S * 2.2 + 40, y / S * 2.2 + 40, 3);
      if (t !== T_ROCK && t !== T_SNOW && hh > 0 && dry > 0.42 && startInfluence(g, x, y, 22, 32) < 0.1 && (!g.recipe || g.recipe.desert)) t = T_SAND;
      for (const F of g.forests) if (blobF(F, x, y, nMoist) > 0.3 && hh > 0.3 && t !== T_ROCK) t = T_FOREST;
      // sheer rock is rock whatever grows round it
      if (world.cliff[i] && t !== T_SNOW) t = hh > 8.2 + nDetail.noise(x * 0.1, y * 0.1) * 0.8 ? T_SNOW : T_ROCK;
      world.terrain[i] = t;
    }
  }
}

/** Ores in mountains: veins by noise, guaranteed deposits on each start mountain, the islands' riches, a recipe's own. */
function seedOre(g: Gen) {
  const { world, S, rng, nOre } = g;
  const veins = !g.recipe || g.recipe.veins;
  for (let i = 0; veins && i < world.N; i++) {
    const t = world.terrain[i];
    if (t !== T_ROCK && t !== T_SNOW) continue;
    const x = world.nx(i), y = world.ny(i);
    const u = x / S, v = y / S;
    const coal = nOre.noise(u * 18, v * 18) + 0.15;
    const iron = nOre.noise(u * 18 + 50, v * 18 + 50);
    const gold = nOre.noise(u * 22 + 90, v * 22 + 90) - 0.25;
    const stone = nOre.noise(u * 16 + 130, v * 16 + 130) - 0.05;
    let best = 0, bv = 0.12;
    if (coal > bv) { bv = coal; best = ORE_COAL; }
    if (iron > bv) { bv = iron; best = ORE_IRON; }
    if (gold > bv) { bv = gold; best = ORE_GOLD; }
    if (stone > bv) { bv = stone; best = ORE_STONE; }
    if (best) {
      world.ore[i] = best;
      world.oreAmt[i] = clamp(Math.round(4 + (bv - 0.12) * 40 + rng.range(0, 4)), 2, 22);
    }
  }
  // guaranteed deposits on each start mountain
  for (const M of g.startMountains) {
    const kinds = [ORE_COAL, ORE_IRON, ORE_COAL, ORE_GOLD, ORE_STONE];
    for (let k = 0; k < kinds.length; k++) {
      const a = (k / kinds.length) * Math.PI * 2 + rng.range(0, 0.6);
      const cx = M.x + cos(a) * M.r * 0.45, cy = M.y + sin(a) * M.r * 0.45;
      world.forRadius(cx, cy, 3.2, (i) => {
        if (world.terrain[i] === T_ROCK || world.terrain[i] === T_SNOW) {
          world.ore[i] = kinds[k];
          world.oreAmt[i] = rng.int(10, 20);
        }
      });
    }
  }

  // island mountains hold the richest veins: gold and iron
  for (const I of g.isles) {
    if (!I.mtn) continue;
    const kinds = [ORE_GOLD, ORE_IRON, ORE_GOLD, ORE_COAL];
    for (let k = 0; k < kinds.length; k++) {
      const a = (k / kinds.length) * Math.PI * 2 + rng.range(0, 0.8);
      world.forRadius(I.mtn.x + cos(a) * I.mtn.r * 0.4, I.mtn.y + sin(a) * I.mtn.r * 0.4, 2.4, (i) => {
        if (world.terrain[i] === T_ROCK || world.terrain[i] === T_SNOW) {
          world.ore[i] = kinds[k];
          world.oreAmt[i] = rng.int(12, 22);
        }
      });
    }
  }

  // a recipe's veins, on the rock under them (not the sheer rock: no mine can stand there)
  for (const v of g.recipe?.ore ?? []) {
    world.forRadius(v.at[0], v.at[1], v.r, (i) => {
      if ((world.terrain[i] === T_ROCK || world.terrain[i] === T_SNOW) && !world.cliff[i]) {
        world.ore[i] = v.kind;
        world.oreAmt[i] = rng.int(v.amt[0], v.amt[1] + 1);
      }
    });
  }
}

function seedFish(g: Gen) {
  const { world, rng } = g;
  for (let i = 0; i < world.N; i++) {
    const hh = world.h[i] - WATER_LEVEL;
    if (hh < -0.2 && hh > -4.5) world.fish[i] = rng.chance(0.6) ? rng.int(2, 8) : 0;
  }
}

/** Is the node kept bare by the recipe (sheer rock, a cleared patch)? */
const bare = (g: Gen, i: number, x: number, y: number) =>
  !!g.recipe && (g.world.cliff[i] !== 0 || (g.recipe.clear ?? []).some((c) => hypot(x - c.x, y - c.y) < c.r));

function plantTrees(g: Gen): MapGenResult['trees'] {
  const { world, W, H, rng, nMoist, moist, occupied } = g;
  const trees: MapGenResult['trees'] = [];
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      const t = world.terrain[i];
      const hh = world.h[i] - WATER_LEVEL;
      if (hh < 0.15) continue;
      const nearStart = startInfluence(g, x, y, 6.5, 8.5);
      if (nearStart > 0.01 || nearLanding(g, x, y)) continue;
      if (bare(g, i, x, y)) continue;
      let p = 0;
      if (t === T_FOREST) p = 0.36 + moist[i] * 0.35;
      else if (t === T_GRASS) p = 0.035;
      else if (t === T_MEADOW) p = 0.012;
      else if (t === T_SAND) p = hh < 1.0 ? 0.03 : 0.006;
      else if (t === T_SWAMP) p = 0.05;
      else if (t === T_ROCK) p = world.slopeAt(i) < 0.6 && hh < 6 ? 0.03 : 0;
      for (const F of g.forests) if (blobF(F, x, y, nMoist) > 0.2) p = Math.max(p, 0.5);
      if (!rng.chance(p)) continue;
      let species: number;
      if (t === T_SAND) species = 3; // palm
      else if (t === T_ROCK || hh > 3.4) species = 1; // pine
      else if (t === T_MEADOW && rng.chance(0.4)) species = 4; // fruit tree
      else {
        const r = rng.next();
        species = r < 0.48 ? 0 : r < 0.75 ? 1 : 2;
      }
      trees.push({ node: i, species, growth: rng.chance(0.12) ? rng.range(0.3, 0.9) : 1 });
      occupied[i] = 1;
    }
  }
  return trees;
}

/** Rock outcrops. */
function scatterStones(g: Gen): MapGenResult['stones'] {
  const { world, W, H, rng, opt, occupied } = g;
  const stones: MapGenResult['stones'] = [];
  const nStone = new Simplex(opt.seed * 7 + 9);
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const i = y * W + x;
      if (occupied[i]) continue;
      const hh = world.h[i] - WATER_LEVEL;
      if (hh < 0.3) continue;
      if (startInfluence(g, x, y, 6.5, 8.5) > 0.01 || nearLanding(g, x, y)) continue;
      if (bare(g, i, x, y)) continue;
      const t = world.terrain[i];
      let p = 0;
      const sn = nStone.noise(x * 0.09, y * 0.09);
      if (sn > 0.66 && t !== T_SWAMP) p = 0.24;
      if ((t === T_ROCK) && world.slopeAt(i) < 0.7 && sn > 0.3) p = Math.max(p, 0.05);
      for (const Rk of g.rocks) if (hypot(x - Rk.x, y - Rk.y) < Rk.r) p = 0.55;
      if (!rng.chance(p)) continue;
      stones.push({ node: i, amount: rng.int(6, 11) });
      occupied[i] = 1;
    }
  }
  return stones;
}

function placeDeer(g: Gen): MapGenResult['deer'] {
  const { world, W, H, S, rng, occupied } = g;
  const deer: MapGenResult['deer'] = [];
  const herds = Math.round((S * S) / 2600);
  let herdId = 1;
  for (let k = 0; k < herds * 4 && deer.length < herds * 4; k++) {
    const x = rng.int(8, W - 8), y = rng.int(8, H - 8);
    const i = y * W + x;
    const t = world.terrain[i];
    if (world.isWater(i) || (t !== T_GRASS && t !== T_FOREST && t !== T_MEADOW)) continue;
    if (startInfluence(g, x, y, 14, 18) > 0) continue;
    const n = rng.int(2, 5);
    for (let j = 0; j < n; j++) {
      const xx = x + rng.int(-2, 3), yy = y + rng.int(-2, 3);
      if (!world.inBounds(xx, yy)) continue;
      const ii = yy * W + xx;
      if (world.isWater(ii) || occupied[ii] || world.cliff[ii]) continue;
      deer.push({ node: ii, herd: herdId });
    }
    herdId++;
  }
  for (const I of g.isles) {
    for (let k = 0; k < 4; k++) {
      const xx = Math.round(I.x + rng.range(-I.r, I.r) * 0.5), yy = Math.round(I.y + rng.range(-I.r, I.r) * 0.5);
      if (!world.inBounds(xx, yy)) continue;
      const ii = yy * W + xx;
      if (world.isWater(ii) || occupied[ii] || world.terrain[ii] === T_ROCK || world.terrain[ii] === T_SNOW) continue;
      deer.push({ node: ii, herd: herdId });
    }
    herdId++;
  }
  return deer;
}

/** The yard round each start's headquarters is bare earth. */
function clearYards(g: Gen) {
  const { world } = g;
  for (const s of g.starts) {
    world.forRadius(s.x + 0.5, s.y + 0.5, 3.2, (i) => {
      world.terrain[i] = T_DIRT;
    });
  }
}

// ------------------------------------------------------------------ a recipe's carving
/** Distance from (x, y) to a polyline, and how far along it (0..1) the nearest point lies. */
function toPath(path: Pt[], x: number, y: number): { d: number; t: number } {
  let best = Infinity, bt = 0, run = 0, total = 0;
  const lens: number[] = [];
  for (let k = 0; k + 1 < path.length; k++) { const l = Math.sqrt(sq(path[k + 1][0] - path[k][0]) + sq(path[k + 1][1] - path[k][1])); lens.push(l); total += l; }
  if (path.length === 1) return { d: Math.sqrt(sq(x - path[0][0]) + sq(y - path[0][1])), t: 0 };
  for (let k = 0; k + 1 < path.length; k++) {
    const [ax, ay] = path[k], [bx, by] = path[k + 1];
    const vx = bx - ax, vy = by - ay;
    const l2 = vx * vx + vy * vy;
    const s = l2 > 0 ? clamp(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1) : 0;
    const d = Math.sqrt(sq(x - (ax + vx * s)) + sq(y - (ay + vy * s)));
    if (d < best) { best = d; bt = total > 0 ? (run + lens[k] * s) / total : 0; }
    run += lens[k];
  }
  return { d: best, t: bt };
}

/** The bounding box of a path widened by `pad`, clipped to the map. */
function around(g: Gen, pts: Pt[], pad: number, fn: (i: number, x: number, y: number) => void) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const xa = Math.max(0, Math.floor(x0 - pad)), xb = Math.min(g.W - 1, Math.ceil(x1 + pad));
  const ya = Math.max(0, Math.floor(y0 - pad)), yb = Math.min(g.H - 1, Math.ceil(y1 + pad));
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) fn(y * g.W + x, x, y);
}

function carve(g: Gen, r: MapRecipe) {
  const { world, S, nMount, nDetail, mountainness } = g;
  const wall = g.wall!;
  const h = world.h;
  const WL = WATER_LEVEL;
  for (const op of r.carve ?? []) {
    switch (op.op) {
      case 'range': {
        // the crest over `width`, and foothills rolling out half as far again
        around(g, op.path, op.width * 1.6, (i, x, y) => {
          const { d } = toPath(op.path, x, y);
          if (d > op.width * 1.6) return;
          const u = x / S, v = y / S;
          const jag = nDetail.noise(u * 30 + 4, v * 30 + 8) * 0.18;
          const k = 1 - smoothstep(0, 1, d / op.width + jag);
          const f = 1 - smoothstep(0.7, 1.6, d / op.width);
          const ridge = nMount.ridged(u * 9, v * 9, 4);
          // peaks and saddles along the crest, so the snow lies on summits rather than on a table
          const peak = 0.62 + 0.62 * nMount.ridged(u * 11 + 1.7, v * 11 + 4.3, 3);
          const rise = op.height * k * k * peak * (0.7 + 0.3 * ridge) + (1.4 + nDetail.fbm(u * 16 + 2, v * 16 + 6, 3) * 1.1) * f;
          h[i] = Math.max(h[i], WL + 0.6 + rise);
          mountainness[i] = Math.max(mountainness[i], k * 1.3);
          if (op.wall && d / op.width + jag < 0.4) wall[i] = 1;
        });
        break;
      }
      case 'gap': {
        const target = WL + (op.height ?? 1.6);
        world.forRadius(op.at[0], op.at[1], op.r, (i, _x, _y, d2) => {
          const k = 1 - smoothstep(op.r * 0.55, op.r, Math.sqrt(d2));
          h[i] = h[i] * (1 - k) + Math.min(h[i], target) * k;
          mountainness[i] *= 1 - k;
          if (k > 0.35) wall[i] = 0;
        });
        break;
      }
      case 'road': {
        const target = WL + (op.height ?? 1.4);
        around(g, op.path, op.width, (i, x, y) => {
          const { d } = toPath(op.path, x, y);
          if (d > op.width) return;
          const k = 1 - smoothstep(op.width * 0.5, op.width, d);
          h[i] = h[i] * (1 - k) + target * k;
          mountainness[i] *= 1 - k;
          if (k > 0.3) wall[i] = 0;
        });
        break;
      }
      case 'ramp': {
        around(g, op.path, op.width, (i, x, y) => {
          const { d, t } = toPath(op.path, x, y);
          if (d > op.width) return;
          const k = 1 - smoothstep(op.width * 0.5, op.width, d);
          const target = WL + op.from + (op.to - op.from) * smoothstep(0, 1, t);
          h[i] = h[i] * (1 - k) + target * k;
          mountainness[i] *= 1 - k;
          if (k > 0.3) wall[i] = 0;
        });
        break;
      }
      case 'plateau': {
        const top = WL + op.height;
        world.forRadius(op.at[0], op.at[1], op.r + 3, (i, x, y, d2) => {
          const d = Math.sqrt(d2) + nDetail.noise(x * 0.18, y * 0.18) * 1.2;
          if (d < op.r) {
            h[i] = top + nDetail.noise(x * 0.3 + 5, y * 0.3 + 9) * 0.12;
            mountainness[i] = 0;
            wall[i] = 0;
          } else if (d < op.r + 3) {
            // the rim falls away steeply
            const k = 1 - (d - op.r) / 3;
            h[i] = Math.max(h[i], WL + 1 + (top - WL - 1) * k * k);
            mountainness[i] = Math.max(mountainness[i], 0.7);
            if (op.wall && d < op.r + 2.2) wall[i] = 1;
          }
        });
        break;
      }
      case 'water': {
        const floor = WL - (op.depth ?? 2.5);
        world.forRadius(op.at[0], op.at[1], op.r + 2, (i, x, y, d2) => {
          const d = Math.sqrt(d2) + nDetail.noise(x * 0.2 + 3, y * 0.2 + 7) * 1.1;
          const k = 1 - smoothstep(op.r - 1.5, op.r + 1.5, d);
          if (k <= 0) return;
          h[i] = h[i] * (1 - k) + Math.min(h[i], floor) * k;
          mountainness[i] *= 1 - k;
          if (k > 0.3) wall[i] = 0;
        });
        break;
      }
      case 'channel': {
        const floor = WL - (op.depth ?? 2.5);
        around(g, op.path, op.width + 2, (i, x, y) => {
          const { d } = toPath(op.path, x, y);
          const dj = d + nDetail.noise(x * 0.2 + 11, y * 0.2 + 13) * 0.9;
          const k = 1 - smoothstep(op.width - 1.5, op.width + 1.5, dj);
          if (k <= 0) return;
          h[i] = h[i] * (1 - k) + Math.min(h[i], floor) * k;
          mountainness[i] *= 1 - k;
          if (k > 0.3) wall[i] = 0;
        });
        break;
      }
      case 'land': {
        const top = WL + (op.height ?? 0.9);
        world.forRadius(op.at[0], op.at[1], op.r + 2, (i, x, y, d2) => {
          const d = Math.sqrt(d2) + nDetail.noise(x * 0.15 + 21, y * 0.15 + 2) * 1.4;
          const k = 1 - smoothstep(op.r - 1, op.r + 2, d);
          if (k <= 0) return;
          h[i] = Math.max(h[i], h[i] * (1 - k) + top * k);
        });
        break;
      }
      case 'flat': {
        const top = WL + (op.height ?? 1.3);
        world.forRadius(op.at[0], op.at[1], op.r + 3, (i, x, y, d2) => {
          const k = 1 - smoothstep(op.r, op.r + 3, Math.sqrt(d2));
          h[i] = h[i] * (1 - k) + (top + nDetail.noise(x * 0.25, y * 0.25) * 0.12) * k;
          mountainness[i] *= 1 - k;
          if (k > 0.3) wall[i] = 0;
        });
        break;
      }
    }
  }
}

/** A recipe's sheer rock goes onto the world once the heights are final: nobody walks or builds there. */
function cliffs(g: Gen) {
  const { world } = g;
  const wall = g.wall!;
  for (let i = 0; i < world.N; i++) if (wall[i] >= 0.5 && !world.isWater(i)) world.cliff[i] = 1;
}

function ensureConnectivity(world: World, starts: { x: number; y: number }[]) {
  const { W, H } = world;
  for (let attempt = 0; attempt < 4; attempt++) {
    const seen = new Uint8Array(world.N);
    const q: number[] = [];
    const s0 = world.idx(starts[0].x, starts[0].y);
    q.push(s0);
    seen[s0] = 1;
    while (q.length) {
      const c = q.pop()!;
      const cx = c % W, cy = (c / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (seen[ni] || world.h[ni] < WATER_LEVEL + 0.1) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    let ok = true;
    for (let p = 1; p < starts.length; p++) {
      if (!seen[world.idx(starts[p].x, starts[p].y)]) {
        ok = false;
        // raise a land bridge between start 0 and p
        const a = starts[0], b = starts[p];
        const steps = Math.ceil(hypot(b.x - a.x, b.y - a.y));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const x = a.x + (b.x - a.x) * t + sin(t * Math.PI * 2) * 6;
          const y = a.y + (b.y - a.y) * t + cos(t * Math.PI * 3) * 4;
          world.forRadius(x, y, 3.5, (i, _x, _y, d2) => {
            const target = WATER_LEVEL + 0.6 - d2 * 0.02;
            if (world.h[i] < target) world.h[i] = target;
          });
        }
      }
    }
    if (ok) return;
  }
}
