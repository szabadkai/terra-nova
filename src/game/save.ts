// Saved games. A snapshot is plain, structured-clone friendly data: every entity record, the
// world's typed arrays, each scalar of the simulation and the random generator's state, so a
// restored game carries on exactly where the saved one stood.
//
// Settler plans are closures and cannot be saved. Loading a game interrupts every settler instead:
// `settle` releases whatever the plans had reserved (goods on their way, trees and rocks marked for
// cutting, a worker's or soldier's place in a building) and hands the errands that must not be
// forgotten — voyages, geologists' tours, recruits in training, goods in hand — fresh plans. Everyone
// else simply picks up their next job. A new kind of plan that reserves something must be released
// there too.
import { BUILDINGS, GOODS, Good, emptyStock } from './defs';
import { Game, type GameOptions, type PlayerState } from './game';
import { populateWild } from './wildlife';
import { AIController } from './ai';
import type { Animal, Building, Field, Settler, Ship, Sign, Stone, Tree } from './types';
import { plan } from './settlers';
import { isSoldier } from './military';
import { resumeTraining, storeCarried } from './economy';
import { returnHome } from './work';
import { resumeVoyage } from './sea';
import { shipFields } from './naval';
import { resumeTour } from './geology';
import { reconcileLoads, resumeDonkey } from './trade';
import { magicOf, packFile, unpackFile, type TypedArray } from '../core/pack';

export const SAVE_FORMAT = 'terra-nova-save';
export const SAVE_VERSION = 1;

export type SettlerData = Omit<Settler, 'actions' | 'onAbort' | 'path'>;
export type BuildingData = Omit<Building, 'def'>;

export interface SaveData {
  format: typeof SAVE_FORMAT;
  version: number;
  opts: GameOptions;
  rng: number;
  /** Every other field of the Game: clocks, counters, id sequence, pending spells… */
  scalars: Record<string, unknown>;
  world: { arrays: Record<string, TypedArray>; seaSize: number[]; regionSize: number[] };
  players: PlayerState[];
  buildings: BuildingData[];
  settlers: SettlerData[];
  trees: Tree[];
  stones: Stone[];
  fields: Field[];
  animals: Animal[];
  ships: Ship[];
  signs: Sign[];
  ai: Record<string, unknown>[];
  /** Interface state (camera, objectives…) that the game itself does not need. */
  ui?: Record<string, unknown>;
}

/** A short description of a save for slot lists, readable without loading the game. */
export interface SaveMeta {
  savedAt: number; // Date.now()
  time: number; // game seconds played
  seed: number;
  size: number;
  players: number;
  aiLevel: number;
  pop: number;
  soldiers: number;
  buildings: number;
  over: boolean;
  won: boolean;
  /** the campaign mission being played, by id */
  mission?: string;
  /** the name of the map of the players' own the game is on (map.ts), if it is on one */
  map?: string;
  thumb?: string; // small data URL
}

/** Game fields saved on their own (or never: `events` is per frame, the cache, `spots` and the exploration's
 *  memory of what it revealed rebuild themselves). */
const OWN = new Set([
  'world', 'path', 'rng', 'opts', 'players', 'buildings', 'settlers', 'trees', 'stones', 'fields',
  'animals', 'ships', 'signs', 'ai', 'events', 'storageRegionCache', 'spots',
  'revealedB', 'revealedS', 'revealedSh', 'revealPass',
]);

const isPlain = (v: unknown): boolean => {
  if (v === null || typeof v !== 'object') return typeof v !== 'function';
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === Array.prototype;
};

// ------------------------------------------------------------------ snapshot
/**
 * The game as a save. `detach` (the default) deep-copies it, so it stays as it was while the game
 * runs on; without it the save shares the game's own records and arrays, which is only right for a
 * writer that copies it before the game moves again (IndexedDB's `put` does, as it is called).
 */
export function snapshot(g: Game, ui?: Record<string, unknown>, detach = true): SaveData {
  const w = g.world;
  const arrays: Record<string, TypedArray> = {};
  for (const [k, v] of Object.entries(w)) {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) arrays[k] = v as TypedArray;
  }
  const scalars: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) {
    if (OWN.has(k)) continue;
    if (isPlain(v)) scalars[k] = v;
    else console.warn(`save: Game.${k} is not plain data and is not saved`);
  }
  const ai = g.ai.map((c) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c)) {
      if (k === 'g') continue;
      out[k] = v instanceof Map ? { $map: [...v] } : v;
    }
    return out;
  });
  const data: SaveData = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    opts: g.opts,
    rng: g.rng.state,
    scalars,
    world: { arrays, seaSize: w.seaSize, regionSize: w.regionSize },
    players: g.players,
    buildings: [...g.buildings.values()].map(({ def: _def, ...b }) => b),
    settlers: [...g.settlers.values()].map(({ actions: _a, onAbort: _o, path: _p, ...s }) => s),
    trees: [...g.trees.values()],
    stones: [...g.stones.values()],
    fields: [...g.fields.values()],
    animals: [...g.animals.values()],
    ships: [...g.ships.values()],
    signs: [...g.signs.values()],
    ai,
    ui,
  };
  // one deep copy detaches the snapshot from the live game
  return detach ? structuredClone(data) : data;
}

export function describe(g: Game): SaveMeta {
  const pop = g.population(g.local);
  return {
    savedAt: Date.now(), time: g.time, seed: g.opts.seed, size: g.opts.size, players: g.players.length,
    aiLevel: g.ai[0]?.level ?? g.opts.aiLevel, pop: pop.total, soldiers: pop.soldiers,
    buildings: g.countBuildings(g.local, undefined, false), over: g.over, won: (g.over && g.winner === g.local) || !!g.ms?.won,
    mission: g.opts.mission, map: g.opts.map?.name,
  };
}

// ------------------------------------------------------------------ restore
const stockOf = (r: Record<Good, number> | undefined) => {
  const s = emptyStock();
  if (r) for (const gd of GOODS) if (typeof r[gd] === 'number') s[gd] = r[gd];
  return s;
};

/** Why `data` cannot be loaded, or null. */
export function saveError(data: unknown): string | null {
  const d = data as SaveData | null;
  if (!d || typeof d !== 'object' || d.format !== SAVE_FORMAT) return 'This is not a Terra Nova saved game';
  if (typeof d.version !== 'number' || d.version > SAVE_VERSION) return 'This game was saved by a newer version of Terra Nova';
  return null;
}

export function restore(saved: SaveData): Game {
  const err = saveError(saved);
  if (err) throw new Error(err);
  const d = structuredClone(saved);
  const g = new Game(d.opts, false);
  const w = g.world;
  // arrays the save lacks (added to the game later) keep their fresh defaults
  for (const [k, arr] of Object.entries(d.world.arrays)) {
    const cur = (w as unknown as Record<string, unknown>)[k];
    if (ArrayBuffer.isView(cur) && (cur as TypedArray).length === arr.length && cur.constructor === arr.constructor) (cur as TypedArray).set(arr);
  }
  w.seaSize = d.world.seaSize;
  w.regionSize = d.world.regionSize;
  w.oreDirty = w.splatDirty = w.ownerDirty = w.exploredDirty = true;
  w.heightDirty = null;

  // records are laid over freshly made ones, so fields added since the save get their defaults
  g.players = d.players.map((p, i) => {
    const fresh = g.newPlayer(p.id ?? i);
    return Object.assign(fresh, p, { produced: stockOf(p.produced), used: stockOf(p.used), flow: p.flow ?? [], toolPrio: { ...fresh.toolPrio, ...p.toolPrio } });
  });
  for (const b of d.buildings) {
    const nb = Object.assign(g.newBuilding(b.id, b.type, b.owner, b.x, b.y), b);
    nb.def = BUILDINGS[nb.type];
    nb.stock = stockOf(b.stock);
    nb.incoming = stockOf(b.incoming);
    nb.outgoing = stockOf(b.outgoing);
    if (b.seaWant) nb.seaWant = stockOf(b.seaWant);
    g.buildings.set(nb.id, nb);
  }
  for (const s of d.settlers) {
    const ns = g.addSettler(s.owner, s.job, s.node);
    g.settlers.delete(ns.id);
    Object.assign(ns, s);
    g.settlers.set(ns.id, ns);
  }
  for (const t of d.trees) g.trees.set(t.id, t);
  for (const s of d.stones) g.stones.set(s.id, s);
  for (const f of d.fields) g.fields.set(f.id, f);
  // saves from before hares: every animal a deer, at home where it stands
  for (const a of d.animals) g.animals.set(a.id, { ...a, kind: a.kind ?? 'deer', home: a.home ?? a.node, leave: a.leave ?? 0 });
  for (const sh of d.ships) g.ships.set(sh.id, { ...shipFields(sh.kind ?? 'trade'), ...sh, cargo: stockOf(sh.cargo) });
  for (const s of d.signs) g.signs.set(s.id, s);
  g.ai = d.ai.map((o) => {
    const c = new AIController(g, o.p as number, o.level as number);
    for (const [k, v] of Object.entries(o)) {
      const m = v && typeof v === 'object' && '$map' in v ? new Map((v as { $map: [unknown, unknown][] }).$map) : v;
      (c as unknown as Record<string, unknown>)[k] = m;
    }
    return c;
  });
  // counters last: making the records above drew ids and random numbers
  Object.assign(g, d.scalars);
  g.rng.state = d.rng;
  // a game saved before each player's view was kept: the local player's fog is what they had seen
  if (!('seen' in d.world.arrays)) for (let i = 0; i < w.N; i++) w.seen[i] = w.explored[i] ? 1 << g.local : 0;
  // a game saved before there were hares: the woods fill up with them as in a new game
  if (!('wildT' in d.scalars)) populateWild(g, g.starts);
  settle(g);
  return g;
}

// ------------------------------------------------------------------ settle
/** Put a freshly restored game, whose settlers have no plans, into a consistent state. */
function settle(g: Game) {
  const w = g.world;
  // reservations: every one of these is held by a plan
  for (const t of [...g.trees.values()]) {
    // a woodcutter was felling it; like an interrupted plan, the trunk is lost
    if (t.state === 'falling') g.removeTree(t);
    else t.reserved = false;
  }
  for (const s of g.stones.values()) s.reserved = 0;
  for (const f of g.fields.values()) f.reserved = false;
  for (const a of g.animals.values()) if (a.alive) a.reserved = false;
  for (const b of g.buildings.values()) {
    b.incoming = emptyStock();
    b.outgoing = emptyStock();
    b.workerIncoming = 0;
    b.soldiersIncoming = 0;
    // material a builder had picked up but not yet hammered in goes back on the pile
    b.used = Math.min(b.used, b.buildWork);
  }

  for (const s of g.settlers.values()) {
    s.actions = [];
    s.onAbort = null;
    s.path = null;
    s.pathI = 0;
    if (s.aboard) continue; // the ship carries them
    if (s.next >= 0) {
      if (s.t >= 0.5 && w.walkable(s.next)) s.node = s.next;
      s.next = -1;
      s.t = 0;
    }
    g.syncPos(s);
    if (s.dead) continue;
    s.anim = 'idle';
    const home = s.inside ? g.buildings.get(s.inside) : undefined;
    const tour = s.job === 'geologist' && s.task.startsWith('Prospect') && s.target > 0;
    s.task = '';
    if (!isSoldier(s) && !tour && s.job !== 'donkey') s.target = 0;

    if (s.voyage) { resumeVoyage(g, s); continue; }
    if (s.job === 'donkey') { resumeDonkey(g, s); continue; }
    if (isSoldier(s)) {
      // soldiers marching to a garrison set out again from where they stand
      if (s.sstate === 'moving' || s.sstate === 'ship' || (s.sstate === 'garrison' && !s.inside)) s.sstate = 'idle';
      continue;
    }
    if (s.job === 'carrier' && home?.type === 'barracks' && (s.carrying === 'sword' || s.carrying === 'bow')) {
      s.idle = false;
      resumeTraining(g, s, home);
      continue;
    }
    if (tour) { s.idle = false; resumeTour(g, s); continue; }

    // a worker keeps his post only if the building counts him as its worker
    const post = s.home ? g.buildings.get(s.home) : undefined;
    if (post && post.def.worker === s.job && post.state === 'done' && post.worker !== s.id) s.home = 0;
    if (s.job === 'carrier') s.idle = true;

    const gd = s.carrying;
    if (!gd) continue;
    const work = s.home ? g.buildings.get(s.home) : undefined;
    if (work && work.state === 'done' && work.worker === s.id && work.owner === s.owner) {
      if (work.def.outputs?.includes(gd)) {
        // a gatherer on his way home with the catch
        plan(s, returnHome(g, s, work, true), () => { s.carrying = null; });
        continue;
      }
      if (work.type === 'shipyard' && (gd === 'board' || gd === 'iron')) { work.stock[gd]++; s.carrying = null; continue; }
    }
    if (s.job === 'carrier') { s.idle = false; storeCarried(g, s); continue; }
    s.carrying = s.pack = null;
  }
  reconcileLoads(g);
}

// ------------------------------------------------------------------ files
// A save file is the packed form of src/core/pack.ts under the magic "TNSV".
const MAGIC = magicOf('TNSV');
const NOT_A_SAVE = 'This is not a Terra Nova saved game';

export async function encodeSave(data: SaveData): Promise<Uint8Array> {
  return packFile(data, MAGIC);
}

export async function decodeSave(file: Uint8Array): Promise<SaveData> {
  const data = await unpackFile(file, MAGIC, NOT_A_SAVE, 'The saved game is damaged');
  const err = saveError(data);
  if (err) throw new Error(err);
  return data as SaveData;
}
