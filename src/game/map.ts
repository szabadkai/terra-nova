// Maps of the players' own making: the map format a game can be started from, and the API the map
// editor and user scripts shape one with. A map is plain data - the world's height, material, ore
// and fish per node, where each player starts, every tree, rock and deer - and starting a game on it
// is deterministic: the same map makes the same game on every machine (`applyMap`), so it can be
// saved, sent and played with a friend like a seed. The generator's maps can be captured into the
// format (`generatedMap`) and worked on from there.
//
// `MapBuilder` is the API (see MAPS.md): brushes that raise, lower, flatten and smooth the ground,
// paint materials and ore, stock fish, plant and clear woods, scatter rocks, set herds and the
// players' starts, composed features (an island, a mountain, a lake, a river, rolling hills), a
// material pass that dresses the land from its shape (`autoTerrain`), land bridges between the
// starts (`connect`) and `validate`, which says what would stop a game on the map from being fair
// or from starting at all. Every operation is deterministic for the builder's seed. No DOM here:
// scripts/mapedit.ts drives it headless.
import { Simplex } from '../core/noise';
import { RNG, clamp, smoothstep } from '../core/rng';
import { cos, hypot, sin, sq } from '../core/fmath';
import { magicOf, packFile, unpackFile } from '../core/pack';
import {
  ORE_COAL, ORE_GOLD, ORE_IRON, ORE_STONE,
  T_DIRT, T_FOREST, T_GRASS, T_MEADOW, T_ROCK, T_SAND, T_SNOW, T_SWAMP,
} from './defs';
import { generateMap } from './mapgen';
import { DX8, DY8, WATER_LEVEL, World } from './world';

export const MAP_FORMAT = 'terra-nova-map';
export const MAP_VERSION = 1;
/** the map sizes the game is tuned for (the free-play menu's Small, Medium and Large) */
export const MAP_SIZES = [128, 160, 208];
export const MIN_MAP = 64;
export const MAX_MAP = 256;
export const MAX_PLAYERS = 4;

export interface Start { x: number; y: number }
export interface MapTree { node: number; species: number; growth: number }
export interface MapStone { node: number; amount: number }
export interface MapDeer { node: number; herd: number }
export interface Isle { x: number; y: number; r: number }

/** A map as it is saved, sent and started from. */
export interface MapData {
  format: typeof MAP_FORMAT;
  version: number;
  name: string;
  author?: string;
  description?: string;
  /** nodes a side (the world is square) */
  size: number;
  h: Float32Array;
  terrain: Uint8Array;
  ore: Uint8Array;
  oreAmt: Uint8Array;
  fish: Uint8Array;
  /** where each player's headquarters stands (its centre), the first player first */
  starts: Start[];
  trees: MapTree[];
  stones: MapStone[];
  deer: MapDeer[];
  /** offshore islands worth an expedition, for the computer kingdoms */
  isles: Isle[];
}

/** A short description of a map, readable without the map. */
export interface MapMeta {
  name: string;
  author?: string;
  description?: string;
  size: number;
  players: number;
  savedAt: number;
  thumb?: string;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export type MapChange = 'h' | 'terrain' | 'ore' | 'fish' | 'trees' | 'stones' | 'deer' | 'starts';

export interface MapProblem {
  /** an error stops the game from starting; a warning is a fairness note */
  level: 'error' | 'warn';
  text: string;
  x?: number;
  y?: number;
}

export const TERRAIN_NAMES = ['Grass', 'Meadow', 'Forest floor', 'Bare earth', 'Sand', 'Rock', 'Snow', 'Swamp'];
export const SPECIES_NAMES = ['Oak', 'Pine', 'Birch', 'Palm', 'Fruit tree'];
export const MAX_ORE = 22;
export const MAX_FISH = 12;

const isMountain = (t: number) => t === T_ROCK || t === T_SNOW;

/** Why `data` is not a map that can be played, or null. */
export function mapError(data: unknown): string | null {
  const d = data as MapData | null;
  if (!d || typeof d !== 'object' || d.format !== MAP_FORMAT) return 'This is not a Terra Nova map';
  if (typeof d.version !== 'number' || d.version > MAP_VERSION) return 'This map was made by a newer version of Terra Nova';
  const S = d.size;
  if (!Number.isInteger(S) || S < MIN_MAP || S > MAX_MAP) return `A map is ${MIN_MAP} to ${MAX_MAP} nodes a side`;
  const N = S * S;
  if (!(d.h instanceof Float32Array) || d.h.length !== N) return 'The map\'s heights are missing or the wrong size';
  for (const k of ['terrain', 'ore', 'oreAmt', 'fish'] as const) {
    if (!(d[k] instanceof Uint8Array) || d[k].length !== N) return `The map's ${k} is missing or the wrong size`;
  }
  if (!Array.isArray(d.starts) || !d.starts.length) return 'The map has no starting position';
  if (d.starts.length > MAX_PLAYERS) return `A map holds up to ${MAX_PLAYERS} players`;
  for (const s of d.starts) if (!Number.isInteger(s?.x) || !Number.isInteger(s?.y) || s.x < 0 || s.y < 0 || s.x >= S || s.y >= S) return 'A starting position is off the map';
  for (const k of ['trees', 'stones', 'deer', 'isles'] as const) if (!Array.isArray(d[k])) return `The map's ${k} are missing`;
  return null;
}

/** What starting a game on a map needs of the game. */
export interface MapHost {
  world: World;
  addTree(node: number, species: number, growth: number): unknown;
  addStone(node: number, amount: number): unknown;
  addAnimal(node: number, herd: number): unknown;
}

/**
 * Lay a map into a fresh game's world: the arrays, then every tree, rock and deer in the map's
 * order (each draws from the game's random generator, so the order is part of the map). Returns
 * what the generator would have: the starts and the islands.
 */
export function applyMap(g: MapHost, data: MapData): { starts: Start[]; isles: Isle[]; deer: number } {
  const err = mapError(data);
  if (err) throw new Error(err);
  const w = g.world;
  if (w.W !== data.size || w.H !== data.size) throw new Error(`The game's world is ${w.W} nodes a side, the map ${data.size}`);
  w.h.set(data.h);
  w.terrain.set(data.terrain);
  w.ore.set(data.ore);
  w.oreAmt.set(data.oreAmt);
  w.fish.set(data.fish);
  for (const t of data.trees) if (t.node >= 0 && t.node < w.N && !w.tree[t.node]) g.addTree(t.node, t.species | 0, clamp(t.growth, 0.05, 1));
  for (const s of data.stones) if (s.node >= 0 && s.node < w.N && !w.tree[s.node] && !w.stone[s.node]) g.addStone(s.node, clamp(s.amount | 0, 1, 40));
  let deer = 0;
  for (const d of data.deer) if (d.node >= 0 && d.node < w.N && !w.isWater(d.node)) { g.addAnimal(d.node, d.herd | 0); deer++; }
  w.computeRegions();
  return { starts: data.starts.map((s) => ({ x: s.x, y: s.y })), isles: data.isles.map((I) => ({ x: I.x, y: I.y, r: I.r })), deer };
}

/** The generator's map for these settings, as data (what free play shapes from a seed). */
export function generatedMap(size: number, seed: number, players: number, islands = true): MapData {
  const b = MapBuilder.generate(size, seed, players, islands);
  b.name = `World ${seed}`;
  return b.toData();
}

/** What a game keeps of the map it plays, for the save list. */
export function mapMeta(d: MapData, savedAt = Date.now()): MapMeta {
  return { name: d.name, author: d.author, description: d.description, size: d.size, players: d.starts.length, savedAt };
}

/** The nodes a headquarters takes: its 4×4 footprint at (x-1, y-1) and the door below it, as the game places it. */
export function hqNodes(S: number, s: Start): number[] {
  const out: number[] = [];
  for (let yy = s.y - 1; yy < s.y + 3; yy++) for (let xx = s.x - 1; xx < s.x + 3; xx++) out.push(yy * S + xx);
  out.push((s.y + 3) * S + s.x); // the door (doorOf: below the footprint, left of centre)
  return out;
}

/** A piece of a map, cut out to be put back (undo) or stamped elsewhere. */
export interface MapPatch {
  rect: Rect;
  h: Float32Array;
  terrain: Uint8Array;
  ore: Uint8Array;
  oreAmt: Uint8Array;
  fish: Uint8Array;
  trees: MapTree[];
  stones: MapStone[];
  deer: MapDeer[];
  starts: Start[];
}

const rectOf = (S: number, x: number, y: number, r: number): Rect => ({
  x0: Math.max(0, Math.floor(x - r)), y0: Math.max(0, Math.floor(y - r)),
  x1: Math.min(S - 1, Math.ceil(x + r)), y1: Math.min(S - 1, Math.ceil(y + r)),
});
const growRect = (a: Rect, b: Rect): Rect => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/**
 * A map being made. Coordinates are nodes: x to the right, y down the map, both from 0 to size-1;
 * a "circle" takes a centre and a radius in nodes. Heights are the world's: the sea lies at
 * WATER_LEVEL (2), the shore a little above it, a mountain 5 to 10 higher. Every brush has a soft
 * edge: `hard` is the part of the radius that gets the full effect (0 all soft, 1 a hard edge).
 */
export class MapBuilder {
  readonly size: number;
  readonly N: number;
  h: Float32Array;
  terrain: Uint8Array;
  ore: Uint8Array;
  oreAmt: Uint8Array;
  fish: Uint8Array;
  /** by node */
  trees = new Map<number, { species: number; growth: number }>();
  /** by node: stone left in the rock */
  stones = new Map<number, number>();
  deer: MapDeer[] = [];
  /** by player slot; a slot not yet placed is null */
  starts: (Start | null)[] = [];
  isles: Isle[] = [];
  name = 'Untitled map';
  author?: string;
  description?: string;
  /** the random draws of the scatter brushes; reseed for another scatter of the same map */
  rng: RNG;
  private nextHerd = 1;
  private noiseSeed: number;
  /** told of every change and the nodes it touched (the editor redraws them) */
  onChange: ((rect: Rect, what: MapChange) => void) | null = null;

  constructor(size: number, seed = 1) {
    if (!Number.isInteger(size) || size < MIN_MAP || size > MAX_MAP) throw new Error(`A map is ${MIN_MAP} to ${MAX_MAP} nodes a side`);
    this.size = size;
    this.N = size * size;
    this.h = new Float32Array(this.N);
    this.terrain = new Uint8Array(this.N);
    this.ore = new Uint8Array(this.N);
    this.oreAmt = new Uint8Array(this.N);
    this.fish = new Uint8Array(this.N);
    this.rng = new RNG(seed);
    this.noiseSeed = seed;
  }

  // ------------------------------------------------------------------ making one
  /** An empty map: open sea (`'sea'`), or flat grassland with the sea round its edge (`'land'`). */
  static blank(size: number, kind: 'sea' | 'land' = 'sea', seed = 1): MapBuilder {
    const b = new MapBuilder(size, seed);
    if (kind === 'sea') {
      b.h.fill(WATER_LEVEL - 2.5);
      b.terrain.fill(T_SAND);
    } else {
      b.h.fill(WATER_LEVEL + 1.3);
      b.terrain.fill(T_GRASS);
      b.coast(Math.round(size * 0.09));
    }
    return b;
  }

  /** The generator's map for a seed, to be worked on. */
  static generate(size: number, seed: number, players: number, islands = true): MapBuilder {
    const w = new World(size, size);
    const gen = generateMap(w, { size, seed, players, islands });
    const b = new MapBuilder(size, seed);
    b.h.set(w.h);
    b.terrain.set(w.terrain);
    b.ore.set(w.ore);
    b.oreAmt.set(w.oreAmt);
    b.fish.set(w.fish);
    for (const t of gen.trees) b.trees.set(t.node, { species: t.species, growth: t.growth });
    for (const s of gen.stones) b.stones.set(s.node, s.amount);
    b.deer = gen.deer.map((d) => ({ node: d.node, herd: d.herd }));
    b.nextHerd = b.deer.reduce((m, d) => Math.max(m, d.herd), 0) + 1;
    b.starts = gen.starts.map((s) => ({ x: s.x, y: s.y }));
    b.isles = gen.isles.map((I) => ({ x: I.x, y: I.y, r: I.r }));
    b.name = `World ${seed}`;
    return b;
  }

  static from(data: MapData, seed = 1): MapBuilder {
    const err = mapError(data);
    if (err) throw new Error(err);
    const b = new MapBuilder(data.size, seed);
    b.h.set(data.h);
    b.terrain.set(data.terrain);
    b.ore.set(data.ore);
    b.oreAmt.set(data.oreAmt);
    b.fish.set(data.fish);
    for (const t of data.trees) b.trees.set(t.node, { species: t.species, growth: t.growth });
    for (const s of data.stones) b.stones.set(s.node, s.amount);
    b.deer = data.deer.map((d) => ({ node: d.node, herd: d.herd }));
    b.nextHerd = b.deer.reduce((m, d) => Math.max(m, d.herd), 0) + 1;
    b.starts = data.starts.map((s) => ({ x: s.x, y: s.y }));
    b.isles = data.isles.map((I) => ({ ...I }));
    b.name = data.name;
    b.author = data.author;
    b.description = data.description;
    return b;
  }

  /** The map as data: the arrays copied, the trees and rocks in node order (so the same map is the same data however it was made), the deer herd by herd. */
  toData(): MapData {
    const trees = [...this.trees].map(([node, t]) => ({ node, species: t.species, growth: t.growth })).sort((a, b) => a.node - b.node);
    const stones = [...this.stones].map(([node, amount]) => ({ node, amount })).sort((a, b) => a.node - b.node);
    const deer = this.deer.map((d) => ({ ...d }));
    return {
      format: MAP_FORMAT, version: MAP_VERSION, name: this.name, author: this.author, description: this.description,
      size: this.size, h: new Float32Array(this.h), terrain: new Uint8Array(this.terrain), ore: new Uint8Array(this.ore),
      oreAmt: new Uint8Array(this.oreAmt), fish: new Uint8Array(this.fish),
      starts: this.starts.filter((s): s is Start => !!s).map((s) => ({ x: s.x, y: s.y })),
      trees, stones, deer, isles: this.isles.map((I) => ({ ...I })),
    };
  }

  // ------------------------------------------------------------------ nodes
  idx(x: number, y: number) { return y * this.size + x; }
  nx(i: number) { return i % this.size; }
  ny(i: number) { return (i / this.size) | 0; }
  inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  isWater(i: number) { return this.h[i] < WATER_LEVEL - 0.02; }
  /** land a tree or a rock can stand on */
  isLand(i: number) { return this.h[i] >= WATER_LEVEL + 0.15; }
  isMountain(i: number) { return isMountain(this.terrain[i]); }
  heightAt(x: number, y: number) { return this.inBounds(x, y) ? this.h[this.idx(x, y)] : WATER_LEVEL - 2.5; }
  slopeAt(i: number) {
    const S = this.size, x = this.nx(i), y = this.ny(i);
    const hl = x > 0 ? this.h[i - 1] : this.h[i], hr = x < S - 1 ? this.h[i + 1] : this.h[i];
    const hu = y > 0 ? this.h[i - S] : this.h[i], hd = y < S - 1 ? this.h[i + S] : this.h[i];
    return Math.max(Math.abs(hr - hl), Math.abs(hd - hu)) * 0.5;
  }
  /** the players placed so far */
  get players() { return this.starts.filter((s) => !!s).length; }

  private changed(rect: Rect, what: MapChange) { this.onChange?.(rect, what); }

  /** Every node within `r` of (x, y) with its soft weight `k` (1 inside `hard`·r, falling to 0 at r). */
  forCircle(x: number, y: number, r: number, hard: number, fn: (i: number, x: number, y: number, k: number) => void): Rect {
    const rect = rectOf(this.size, x, y, r);
    const r2 = r * r, inner = Math.max(0, Math.min(1, hard)) * r;
    for (let yy = rect.y0; yy <= rect.y1; yy++) {
      for (let xx = rect.x0; xx <= rect.x1; xx++) {
        const dx = xx - x, dy = yy - y, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        const k = r <= inner ? 1 : 1 - smoothstep(inner, r, d);
        if (k > 0) fn(yy * this.size + xx, xx, yy, k);
      }
    }
    return rect;
  }

  // ------------------------------------------------------------------ the ground
  /** Raise the ground in a circle by up to `amount` (negative lowers it). */
  raise(x: number, y: number, r: number, amount: number, hard = 0.4): this {
    const rect = this.forCircle(x, y, r, hard, (i, _x, _y, k) => { this.h[i] += amount * k; });
    this.changed(rect, 'h');
    return this;
  }
  lower(x: number, y: number, r: number, amount: number, hard = 0.4): this { return this.raise(x, y, r, -amount, hard); }

  /** Pull the ground in a circle towards one height (the centre's, unless given), by `strength` (1 all the way). */
  flatten(x: number, y: number, r: number, target?: number, strength = 1, hard = 0.4): this {
    const to = target ?? this.heightAt(Math.round(x), Math.round(y));
    const rect = this.forCircle(x, y, r, hard, (i, _x, _y, k) => { this.h[i] += (to - this.h[i]) * k * strength; });
    this.changed(rect, 'h');
    return this;
  }

  /** Smooth the ground in a circle towards the average of each node's neighbours. */
  smooth(x: number, y: number, r: number, strength = 0.5, hard = 0.4): this {
    const S = this.size, src = new Float32Array(this.h);
    const rect = this.forCircle(x, y, r, hard, (i, xx, yy, k) => {
      let s = 0, n = 0;
      for (let d = 0; d < 8; d++) {
        const nx = xx + DX8[d], ny = yy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        s += src[ny * S + nx];
        n++;
      }
      if (n) this.h[i] += (s / n - src[i]) * k * strength;
    });
    this.changed(rect, 'h');
    return this;
  }

  /** Roughen the ground in a circle with noise: `amount` high, `scale` nodes wide. */
  roughen(x: number, y: number, r: number, amount = 0.6, scale = 8, hard = 0.4): this {
    const n = new Simplex(this.noiseSeed * 7 + 11 + Math.round(this.rng.next() * 1e6));
    const rect = this.forCircle(x, y, r, hard, (i, xx, yy, k) => { this.h[i] += n.fbm(xx / scale, yy / scale, 3) * amount * k; });
    this.changed(rect, 'h');
    return this;
  }

  /** Set every node's height (the whole map). */
  fill(height: number): this {
    this.h.fill(height);
    this.changed(this.all(), 'h');
    return this;
  }

  /** Sink the map's edge into the sea over `width` nodes, so the land ends in water all round. */
  coast(width: number, depth = 2.5): this {
    const S = this.size;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.min(x, y, S - 1 - x, S - 1 - y);
        if (d >= width) continue;
        const k = 1 - smoothstep(0, width, d + 0.5);
        const i = y * S + x;
        const sea = WATER_LEVEL - depth;
        this.h[i] = Math.min(this.h[i], this.h[i] + (sea - this.h[i]) * k);
        if (this.h[i] < WATER_LEVEL + 0.3) this.terrain[i] = T_SAND;
      }
    }
    const all = this.all();
    this.changed(all, 'h');
    this.changed(all, 'terrain');
    return this;
  }

  // ------------------------------------------------------------------ features
  /** An island: land rising to `height` above the shore at its middle, its edge broken by noise, shallows round it. */
  island(x: number, y: number, r: number, height = 1.3): this {
    const n = new Simplex(this.noiseSeed * 7 + 17 + Math.round(this.rng.next() * 1e6));
    const rect = this.forCircle(x, y, r * 1.5, 1, (i, xx, yy) => {
      const dd = hypot(xx - x, yy - y) / r + n.noise(xx * 0.12, yy * 0.12) * 0.3;
      let h = this.h[i];
      if (dd < 1) h = Math.max(h, WATER_LEVEL + 0.12 + (1 - smoothstep(0.55, 1.0, dd)) * height + Math.max(0, n.fbm(xx / 11, yy / 11, 3)) * 0.5);
      else if (dd < 1.5) h = Math.max(h, WATER_LEVEL - 0.15 - ((dd - 1) / 0.5) * 3.2);
      this.h[i] = h;
    });
    this.changed(rect, 'h');
    return this;
  }

  /** A mountain: a ridged massif `height` high, its rock painted, its top snowed. */
  mountain(x: number, y: number, r: number, height = 7): this {
    const n = new Simplex(this.noiseSeed * 7 + 23 + Math.round(this.rng.next() * 1e6));
    const rect = this.forCircle(x, y, r * 1.15, 1, (i, xx, yy) => {
      const d = hypot(xx - x, yy - y) / r + n.noise(xx * 0.15, yy * 0.15) * 0.3;
      const mt = 1 - smoothstep(0.55, 1.0, d);
      if (mt <= 0) return;
      const ridge = n.ridged(xx / 23, yy / 23, 5);
      this.h[i] += mt * height * (0.25 + ridge) + n.noise(xx / 8, yy / 8) * 0.4 * mt;
      const m = mt * (0.4 + ridge);
      if (m > 0.35 && this.h[i] > WATER_LEVEL + 0.5) this.terrain[i] = this.h[i] - WATER_LEVEL > 8.2 + n.noise(xx * 0.1, yy * 0.1) * 0.8 ? T_SNOW : T_ROCK;
    });
    this.changed(rect, 'h');
    this.changed(rect, 'terrain');
    return this;
  }

  /** A lake: the ground sunk `depth` below the water, its edge broken by noise, sand round it. */
  lake(x: number, y: number, r: number, depth = 1.5): this {
    const n = new Simplex(this.noiseSeed * 7 + 29 + Math.round(this.rng.next() * 1e6));
    const rect = this.forCircle(x, y, r * 1.3, 1, (i, xx, yy) => {
      const d = hypot(xx - x, yy - y) / r + n.noise(xx * 0.15, yy * 0.15) * 0.3;
      const k = 1 - smoothstep(0.5, 1.0, d);
      if (k <= 0) return;
      const floor = WATER_LEVEL - depth;
      this.h[i] = Math.min(this.h[i], this.h[i] + (floor - this.h[i]) * k * 1.2);
      if (this.h[i] < WATER_LEVEL + 0.3 && !this.isMountain(i)) this.terrain[i] = T_SAND;
    });
    this.changed(rect, 'h');
    this.changed(rect, 'terrain');
    return this;
  }

  /** Rolling hills over a circle: noise `amount` high, `scale` nodes wide. */
  hills(x: number, y: number, r: number, amount = 0.6, scale = 12): this { return this.roughen(x, y, r, amount, scale, 0.6); }

  /** A river or a valley: the ground carved `depth` deep and `width` wide along a line of points (a river once it dips below the sea level). */
  carve(points: Start[], width = 3, depth = 2.6): this {
    if (points.length < 2) return this;
    let rect: Rect | null = null;
    const done = new Set<number>();
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1], b = points[k];
      const steps = Math.max(1, Math.ceil(hypot(b.x - a.x, b.y - a.y)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, cx = a.x + (b.x - a.x) * t, cy = a.y + (b.y - a.y) * t;
        const rr = this.forCircle(cx, cy, width, 0.3, (i, _x, _y, kk) => {
          if (done.has(i)) return;
          done.add(i);
          this.h[i] = Math.min(this.h[i], this.h[i] - depth * kk);
          if (this.h[i] < WATER_LEVEL + 0.3 && !this.isMountain(i)) this.terrain[i] = T_SAND;
        });
        rect = rect ? growRect(rect, rr) : rr;
      }
    }
    if (rect) { this.changed(rect, 'h'); this.changed(rect, 'terrain'); }
    return this;
  }

  // ------------------------------------------------------------------ materials, ore, fish
  /** Paint a material (T_GRASS … T_SWAMP from defs) over a circle; a soft edge paints its nodes by chance. */
  paint(x: number, y: number, r: number, terrain: number, hard = 1): this {
    const t = clamp(terrain | 0, 0, 7);
    const rect = this.forCircle(x, y, r, hard, (i, _x, _y, k) => { if (k >= 1 || this.rng.chance(k)) this.terrain[i] = t; });
    this.changed(rect, 'terrain');
    return this;
  }

  /**
   * Lay ore (ORE_COAL, ORE_IRON, ORE_GOLD, ORE_STONE) `amount` deep under the rock in a circle; 0 clears it.
   * Only rock and snow hold ore: mines stand on mountains. A geologist's signs find it.
   */
  paintOre(x: number, y: number, r: number, ore: number, amount = 14, hard = 0.8): this {
    const o = clamp(ore | 0, 0, ORE_STONE), a = clamp(Math.round(amount), 0, MAX_ORE);
    const rect = this.forCircle(x, y, r, hard, (i, _x, _y, k) => {
      if (!this.isMountain(i) && o) return;
      if (k < 1 && !this.rng.chance(k)) return;
      this.ore[i] = o && a ? o : 0;
      this.oreAmt[i] = o && a ? clamp(Math.round(a * (0.7 + 0.3 * k) + this.rng.range(-1, 2)), 2, MAX_ORE) : 0;
    });
    this.changed(rect, 'ore');
    return this;
  }

  /** Stock the water in a circle with `amount` fish a node (0 empties it). */
  stockFish(x: number, y: number, r: number, amount = 5, hard = 0.8): this {
    const a = clamp(Math.round(amount), 0, MAX_FISH);
    const rect = this.forCircle(x, y, r, hard, (i, _x, _y, k) => {
      if (!this.isWater(i)) return;
      if (k < 1 && !this.rng.chance(k)) return;
      this.fish[i] = a ? clamp(Math.round(a + this.rng.range(-1, 2)), 1, MAX_FISH) : 0;
    });
    this.changed(rect, 'fish');
    return this;
  }

  /**
   * Dress the land from its shape, over a circle or the whole map: sand on the shore and under the
   * water, rock where it is steep (snow high up), and grass, meadow or woodland floor by a moisture
   * noise elsewhere. Rock and snow already painted on gentle ground are kept (a mountain's flanks).
   */
  autoTerrain(x?: number, y?: number, r?: number, hard = 1): this {
    const moist = new Simplex(this.noiseSeed * 7 + 3);
    const detail = new Simplex(this.noiseSeed * 7 + 4);
    const S = this.size;
    const one = (i: number, xx: number, yy: number) => {
      const hh = this.h[i] - WATER_LEVEL, slope = this.slopeAt(i), m = moist.fbm(xx / S * 6, yy / S * 6, 4);
      const was = this.terrain[i];
      let t: number;
      if (hh < -0.02) t = T_SAND;
      else if (hh < 0.3) t = m > 0.35 && slope < 0.15 ? T_SWAMP : T_SAND;
      else if (slope > 0.85 || (isMountain(was) && slope > 0.25)) t = hh > 8.2 + detail.noise(xx * 0.1, yy * 0.1) * 0.8 ? T_SNOW : T_ROCK;
      else if (m > 0.22) t = T_FOREST;
      else if (m < -0.28) t = T_MEADOW;
      else t = T_GRASS;
      this.terrain[i] = t;
    };
    let rect: Rect;
    if (x === undefined || y === undefined || r === undefined) {
      rect = this.all();
      for (let i = 0; i < this.N; i++) one(i, this.nx(i), this.ny(i));
    } else rect = this.forCircle(x, y, r, hard, (i, xx, yy, k) => { if (k >= 1 || this.rng.chance(k)) one(i, xx, yy); });
    this.changed(rect, 'terrain');
    return this;
  }

  // ------------------------------------------------------------------ woods, rocks, game
  /** The species a tree takes on this ground, as the generator picks it. */
  speciesFor(i: number): number {
    const t = this.terrain[i], hh = this.h[i] - WATER_LEVEL;
    if (t === T_SAND) return 3;
    if (t === T_ROCK || hh > 3.4) return 1;
    if (t === T_MEADOW && this.rng.chance(0.4)) return 4;
    const r = this.rng.next();
    return r < 0.48 ? 0 : r < 0.75 ? 1 : 2;
  }

  /** Plant trees over a circle: each free land node gets one with chance `density`; `species` 0–4 or -1 to suit the ground; `growth` 1 grown. */
  plant(x: number, y: number, r: number, density = 0.5, species = -1, growth = 1, hard = 0.6): this {
    const rect = this.forCircle(x, y, r, hard, (i, xx, yy, k) => {
      if (xx < 2 || yy < 2 || xx >= this.size - 2 || yy >= this.size - 2) return;
      if (!this.isLand(i) || this.trees.has(i) || this.stones.has(i) || this.underStart(xx, yy)) return;
      if (!this.rng.chance(density * k)) return;
      const sp = species >= 0 ? clamp(species | 0, 0, 4) : this.speciesFor(i);
      const g = growth >= 1 ? 1 : clamp(growth, 0.05, 1);
      this.trees.set(i, { species: sp, growth: g });
    });
    this.changed(rect, 'trees');
    return this;
  }

  clearTrees(x: number, y: number, r: number): this {
    const rect = this.forCircle(x, y, r, 1, (i) => { this.trees.delete(i); });
    this.changed(rect, 'trees');
    return this;
  }

  /** Scatter rocks over a circle: each free land node gets one with chance `density`, holding `amount` stone (± a little). */
  scatterStones(x: number, y: number, r: number, density = 0.35, amount = 8, hard = 0.6): this {
    const rect = this.forCircle(x, y, r, hard, (i, xx, yy, k) => {
      if (xx < 3 || yy < 3 || xx >= this.size - 3 || yy >= this.size - 3) return;
      if (!this.isLand(i) || this.trees.has(i) || this.stones.has(i) || this.underStart(xx, yy)) return;
      if (this.terrain[i] === T_SWAMP || !this.rng.chance(density * k)) return;
      this.stones.set(i, clamp(Math.round(amount + this.rng.range(-2, 3)), 1, 40));
    });
    this.changed(rect, 'stones');
    return this;
  }

  clearStones(x: number, y: number, r: number): this {
    const rect = this.forCircle(x, y, r, 1, (i) => { this.stones.delete(i); });
    this.changed(rect, 'stones');
    return this;
  }

  /** A herd of `n` deer about (x, y), on open land. */
  herd(x: number, y: number, n = 4): this {
    const id = this.nextHerd++;
    let placed = 0;
    for (let k = 0; k < n * 6 && placed < n; k++) {
      const xx = Math.round(x) + this.rng.int(-2, 3), yy = Math.round(y) + this.rng.int(-2, 3);
      if (!this.inBounds(xx, yy)) continue;
      const i = this.idx(xx, yy);
      if (!this.isLand(i) || this.trees.has(i) || this.stones.has(i) || this.isMountain(i)) continue;
      if (this.deer.some((d) => d.node === i)) continue;
      this.deer.push({ node: i, herd: id });
      placed++;
    }
    this.changed(rectOf(this.size, x, y, 3), 'deer');
    return this;
  }

  clearDeer(x: number, y: number, r: number): this {
    const r2 = r * r;
    this.deer = this.deer.filter((d) => sq(this.nx(d.node) - x) + sq(this.ny(d.node) - y) > r2);
    this.changed(rectOf(this.size, x, y, r), 'deer');
    return this;
  }

  // ------------------------------------------------------------------ the players
  /**
   * Where player `p` (0–3) starts: the centre of its headquarters. With `prepare` (the default) the
   * ground there is made ready as the generator makes it: levelled, cleared of trees and rocks, bare
   * earth in the yard. Returns the problem with the spot, if any (the start is set all the same).
   */
  setStart(p: number, x: number, y: number, prepare = true): string | null {
    if (!Number.isInteger(p) || p < 0 || p >= MAX_PLAYERS) throw new Error(`Players are 0 to ${MAX_PLAYERS - 1}`);
    x = Math.round(x); y = Math.round(y);
    const old = this.starts[p];
    while (this.starts.length <= p) this.starts.push(null);
    this.starts[p] = { x, y };
    if (prepare) this.prepareStart(x, y);
    if (old) this.changed(rectOf(this.size, old.x, old.y, 4), 'starts');
    this.changed(rectOf(this.size, x, y, 4), 'starts');
    return this.startProblem(p);
  }

  clearStart(p: number): this {
    const old = this.starts[p];
    if (!old) return this;
    this.starts[p] = null;
    while (this.starts.length && !this.starts[this.starts.length - 1]) this.starts.pop();
    this.changed(rectOf(this.size, old.x, old.y, 4), 'starts');
    return this;
  }

  /** Level and clear a headquarters' ground at (x, y), lifting it out of the water if it must. */
  prepareStart(x: number, y: number): this {
    const target = Math.max(WATER_LEVEL + 1.3, this.heightAt(x, y));
    this.flatten(x + 0.5, y + 0.5, 9, target, 1, 0.55);
    this.clearTrees(x + 0.5, y + 0.5, 8.5);
    this.clearStones(x + 0.5, y + 0.5, 8.5);
    this.clearDeer(x + 0.5, y + 0.5, 12);
    const rect = this.forCircle(x + 0.5, y + 0.5, 3.2, 1, (i) => { this.terrain[i] = T_DIRT; });
    // the ring round the yard is grass unless it is deliberately something else soft
    const ring = this.forCircle(x + 0.5, y + 0.5, 8, 1, (i) => { if (this.isMountain(i) || this.terrain[i] === T_SWAMP) this.terrain[i] = T_GRASS; if (this.ore[i]) { this.ore[i] = 0; this.oreAmt[i] = 0; } });
    this.changed(growRect(rect, ring), 'terrain');
    this.changed(ring, 'ore');
    return this;
  }

  /** Whether (x, y) lies where a headquarters or its yard stands. */
  private underStart(x: number, y: number) {
    for (const s of this.starts) if (s && Math.abs(x - s.x - 0.5) < 8.5 && Math.abs(y - s.y - 0.5) < 8.5 && hypot(x - s.x - 0.5, y - s.y - 0.5) < 8.5) return true;
    return false;
  }

  /** What is wrong with player `p`'s start, or null. */
  startProblem(p: number): string | null {
    const s = this.starts[p];
    if (!s) return 'not placed';
    const S = this.size;
    if (s.x < 3 || s.y < 3 || s.x + 5 >= S || s.y + 6 >= S) return 'too close to the edge of the map';
    for (const i of hqNodes(S, s)) {
      if (this.h[i] < WATER_LEVEL + 0.1) return 'in the water';
      if (this.isMountain(i)) return 'on a mountain';
    }
    return null;
  }

  /** The landmass each node belongs to (0 water), the game's way: land joined along four sides. */
  regions(): { region: Int32Array; sizes: number[] } {
    const S = this.size, region = new Int32Array(this.N), sizes = [0], stack: number[] = [];
    for (let seed = 0; seed < this.N; seed++) {
      if (region[seed] || this.isWater(seed)) continue;
      const id = sizes.length;
      let n = 0;
      region[seed] = id;
      stack.push(seed);
      while (stack.length) {
        const c = stack.pop()!;
        n++;
        const cx = c % S, cy = (c / S) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX8[d], ny = cy + DY8[d];
          if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
          const ni = ny * S + nx;
          if (region[ni] || this.isWater(ni)) continue;
          region[ni] = id;
          stack.push(ni);
        }
      }
      sizes.push(n);
    }
    return { region, sizes };
  }

  /** Raise land bridges until every start can be walked to from the first, as the generator does. Returns how many were needed. */
  connect(): number {
    const starts = this.starts.filter((s): s is Start => !!s);
    if (starts.length < 2) return 0;
    let bridges = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { region } = this.regions();
      const r0 = region[this.idx(starts[0].x, starts[0].y)];
      let ok = true;
      for (let p = 1; p < starts.length; p++) {
        if (region[this.idx(starts[p].x, starts[p].y)] === r0 && r0) continue;
        ok = false;
        bridges++;
        const a = starts[0], b = starts[p];
        const steps = Math.ceil(hypot(b.x - a.x, b.y - a.y));
        let rect: Rect | null = null;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const x = a.x + (b.x - a.x) * t + sin(t * Math.PI * 2) * 6;
          const y = a.y + (b.y - a.y) * t + cos(t * Math.PI * 3) * 4;
          const rr = this.forCircle(x, y, 3.5, 1, (i, _x, _y, _k) => {
            const d2 = sq(this.nx(i) - x) + sq(this.ny(i) - y);
            const target = WATER_LEVEL + 0.6 - d2 * 0.02;
            if (this.h[i] < target) { this.h[i] = target; if (this.terrain[i] !== T_GRASS) this.terrain[i] = T_SAND; }
          });
          rect = rect ? growRect(rect, rr) : rr;
        }
        if (rect) { this.changed(rect, 'h'); this.changed(rect, 'terrain'); }
      }
      if (ok) break;
    }
    return bridges;
  }

  // ------------------------------------------------------------------ checking
  /** What would stop a game on this map, or make it unfair. Errors first. */
  validate(): MapProblem[] {
    const out: MapProblem[] = [];
    const starts = this.starts.map((s, p) => ({ s, p })).filter((e): e is { s: Start; p: number } => !!e.s);
    if (!starts.length) out.push({ level: 'error', text: 'No player has a starting position: place at least one headquarters' });
    else if (starts.length < 2) out.push({ level: 'warn', text: 'Only one player can start here: a game with rivals needs a start for each' });
    for (let p = 0; p < this.starts.length; p++) {
      const s = this.starts[p];
      if (!s) { if (p < starts.length) out.push({ level: 'warn', text: `Player ${p + 1} has no start while a later player has: the players will be renumbered` }); continue; }
      const why = this.startProblem(p);
      if (why) out.push({ level: 'error', text: `Player ${p + 1}'s headquarters is ${why}`, x: s.x, y: s.y });
    }
    for (let a = 0; a < starts.length; a++) {
      for (let b = a + 1; b < starts.length; b++) {
        const d = hypot(starts[a].s.x - starts[b].s.x, starts[a].s.y - starts[b].s.y);
        if (d < 24) out.push({ level: d < 12 ? 'error' : 'warn', text: `Players ${starts[a].p + 1} and ${starts[b].p + 1} start ${Math.round(d)} nodes apart`, x: starts[b].s.x, y: starts[b].s.y });
      }
    }
    if (starts.length > 1) {
      const { region } = this.regions();
      const r0 = region[this.idx(starts[0].s.x, starts[0].s.y)];
      for (let k = 1; k < starts.length; k++) {
        const s = starts[k].s;
        if (region[this.idx(s.x, s.y)] !== r0) out.push({ level: 'warn', text: `Player ${starts[k].p + 1} is on another landmass than player ${starts[0].p + 1}: they meet only by sea (connect() raises a land bridge)`, x: s.x, y: s.y });
      }
    }
    // a fair economy within reach of each start: wood, stone, a mountain, water
    for (const { s, p } of starts) {
      const R = 30;
      let trees = 0, stone = 0, rock = 0, ore = 0, water = 0, land = 0;
      this.forCircle(s.x, s.y, R, 1, (i) => {
        if (this.trees.has(i) && this.trees.get(i)!.growth >= 1) trees++;
        stone += this.stones.get(i) ?? 0;
        if (this.isMountain(i)) rock++;
        if (this.ore[i]) ore++;
        if (this.isWater(i)) water++;
        else land++;
      });
      const who = `Player ${p + 1}`;
      if (trees < 25) out.push({ level: 'warn', text: `${who} has only ${trees} grown trees within ${R} nodes: little wood to start with`, x: s.x, y: s.y });
      if (stone < 30) out.push({ level: 'warn', text: `${who} has only ${stone} stone in the rocks within ${R} nodes`, x: s.x, y: s.y });
      if (rock < 20) out.push({ level: 'warn', text: `${who} has no mountain within ${R} nodes: nowhere to mine`, x: s.x, y: s.y });
      else if (!ore) out.push({ level: 'warn', text: `${who}'s mountains within ${R} nodes hold no ore`, x: s.x, y: s.y });
      if (!water) out.push({ level: 'warn', text: `${who} has no water within ${R} nodes: no fish, and the bakery's water carrier has far to go`, x: s.x, y: s.y });
      if (land < 900) out.push({ level: 'warn', text: `${who} has little land within ${R} nodes to build on`, x: s.x, y: s.y });
    }
    return out.sort((a, b) => Number(b.level === 'error') - Number(a.level === 'error'));
  }

  /** A map that a game can be started on: no errors from `validate`. */
  get playable() { return !this.validate().some((p) => p.level === 'error'); }

  // ------------------------------------------------------------------ patches
  all(): Rect { return { x0: 0, y0: 0, x1: this.size - 1, y1: this.size - 1 }; }

  /** Cut a copy of everything inside `rect` (the ground, what stands on it, any start there). */
  cut(rect: Rect): MapPatch {
    const r = { x0: Math.max(0, rect.x0), y0: Math.max(0, rect.y0), x1: Math.min(this.size - 1, rect.x1), y1: Math.min(this.size - 1, rect.y1) };
    const w = r.x1 - r.x0 + 1, hh = r.y1 - r.y0 + 1, n = Math.max(0, w * hh);
    const p: MapPatch = { rect: r, h: new Float32Array(n), terrain: new Uint8Array(n), ore: new Uint8Array(n), oreAmt: new Uint8Array(n), fish: new Uint8Array(n), trees: [], stones: [], deer: [], starts: [] };
    const inside = (i: number) => { const x = this.nx(i), y = this.ny(i); return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; };
    for (let y = r.y0, k = 0; y <= r.y1; y++) {
      const row = y * this.size + r.x0;
      p.h.set(this.h.subarray(row, row + w), k);
      p.terrain.set(this.terrain.subarray(row, row + w), k);
      p.ore.set(this.ore.subarray(row, row + w), k);
      p.oreAmt.set(this.oreAmt.subarray(row, row + w), k);
      p.fish.set(this.fish.subarray(row, row + w), k);
      k += w;
    }
    for (const [node, t] of this.trees) if (inside(node)) p.trees.push({ node, ...t });
    for (const [node, amount] of this.stones) if (inside(node)) p.stones.push({ node, amount });
    for (const d of this.deer) if (inside(d.node)) p.deer.push({ ...d });
    p.starts = this.starts.map((s) => (s ? { ...s } : null)) as Start[];
    return p;
  }

  /** Put a patch back where it was cut from (undo), replacing what is there now. */
  paste(p: MapPatch): this {
    const r = p.rect, w = r.x1 - r.x0 + 1;
    for (let y = r.y0, k = 0; y <= r.y1; y++) {
      const row = y * this.size + r.x0;
      this.h.set(p.h.subarray(k, k + w), row);
      this.terrain.set(p.terrain.subarray(k, k + w), row);
      this.ore.set(p.ore.subarray(k, k + w), row);
      this.oreAmt.set(p.oreAmt.subarray(k, k + w), row);
      this.fish.set(p.fish.subarray(k, k + w), row);
      k += w;
    }
    const inside = (i: number) => { const x = this.nx(i), y = this.ny(i); return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; };
    for (const node of [...this.trees.keys()]) if (inside(node)) this.trees.delete(node);
    for (const node of [...this.stones.keys()]) if (inside(node)) this.stones.delete(node);
    this.deer = this.deer.filter((d) => !inside(d.node));
    for (const t of p.trees) this.trees.set(t.node, { species: t.species, growth: t.growth });
    for (const s of p.stones) this.stones.set(s.node, s.amount);
    this.deer.push(...p.deer.map((d) => ({ ...d })));
    const oldStarts = this.starts;
    this.starts = (p.starts as (Start | null)[]).map((s) => (s ? { ...s } : null));
    for (const what of ['h', 'terrain', 'ore', 'fish', 'trees', 'stones', 'deer'] as const) this.changed(r, what);
    for (const s of [...oldStarts, ...this.starts]) if (s) this.changed(rectOf(this.size, s.x, s.y, 4), 'starts');
    return this;
  }

  // ------------------------------------------------------------------ figures
  /** What the map holds, in numbers. */
  stats() {
    let land = 0, water = 0, mountain = 0, fish = 0;
    const ore = [0, 0, 0, 0, 0];
    for (let i = 0; i < this.N; i++) {
      if (this.isWater(i)) { water++; fish += this.fish[i]; } else land++;
      if (this.isMountain(i)) mountain++;
      if (this.ore[i]) ore[this.ore[i]] += this.oreAmt[i];
    }
    let stone = 0;
    for (const a of this.stones.values()) stone += a;
    return { land, water, mountain, fish, trees: this.trees.size, stones: this.stones.size, stone, deer: this.deer.length, coal: ore[ORE_COAL], iron: ore[ORE_IRON], gold: ore[ORE_GOLD], granite: ore[ORE_STONE], players: this.players };
  }
}

// ------------------------------------------------------------------ files
// A map file (.tnmap) is the packed form of src/core/pack.ts under the magic "TNMP".
const MAGIC = magicOf('TNMP');
const NOT_A_MAP = 'This is not a Terra Nova map';

export async function encodeMap(data: MapData): Promise<Uint8Array> {
  return packFile(data, MAGIC);
}

export async function decodeMap(file: Uint8Array): Promise<MapData> {
  const data = await unpackFile(file, MAGIC, NOT_A_MAP, 'The map file is damaged');
  const err = mapError(data);
  if (err) throw new Error(err);
  return data as MapData;
}
