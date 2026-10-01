// Core game state + orchestration of all simulation systems.
import { RNG } from '../core/rng';
import {
  BUILDINGS, BuildingType, FOODS, Good, GOODS, Job, MINE_ORE, PLAYER_COLORS, PLAYER_NAMES,
  T_DIRT, T_ROCK, T_SNOW, TOOLS, emptyStock,
} from './defs';
import { generateMap } from './mapgen';
import { applyMap, type MapData } from './map';
import { recipeById } from './recipes';
import type { Carry } from './campaign';
import { PathFinder } from './path';
import { populateWild, updateWild, wander } from './wildlife';
import type { Animal, Building, Expedition, Field, GameEvent, Projectile, SeaOrder, Settler, Ship, Sign, Stone, TradeOrder, Tree } from './types';
import { WATER_LEVEL, World } from './world';
import { abortPlan, markSpots, Spots, updateSettler } from './settlers';
import { updateEconomy, updateBuilding, onBuildingComplete } from './economy';
import { updateMilitary, recomputeTerritory, updateProjectiles } from './military';
import { AIController } from './ai';
import { updateFaith } from './faith';
import { cancelVoyage, findDock, sinkFleet, updateSea } from './sea';
import { updateSigns } from './geology';
import { updateTrade } from './trade';
import { sampleFlow, type FlowSample } from './flow';
import { atan2, sq } from '../core/fmath';
import { allowedTools, allowedTypes, beginMission, missionById, missionStep, rivalRule, tallyEvent, type Mission, type MissionState, type RivalMode, type Tool } from './campaign';

export interface PlayerState {
  id: number;
  name: string;
  color: number;
  ai: boolean;
  alive: boolean;
  swordRatio: number;
  toolPrio: Record<string, number>;
  dispatchT: number;
  militaryT: number;
  morale: number;
  produced: Record<Good, number>;
  /** goods used up: inputs taken, materials built into sites, tools and weapons handed out (flow.ts) */
  used: Record<Good, number>;
  /** produced and used so far, sampled once a minute */
  flow: FlowSample[];
  history: { t: number; pop: number; soldiers: number; buildings: number; goods: number }[];
  hq: number;
  mana: number;
  spellCd: number;
  spellsCast: number;
  traded: number; // goods delivered by donkey caravans
  /** its headquarters has fallen: its strongholds show through everyone's fog, and a computer kingdom yields once it is down to its last few */
  fallen: boolean;
}

export interface GameOptions {
  size: number;
  seed: number;
  players: number;
  aiLevel: number; // 0 easy .. 2 hard
  islands?: boolean;
  /** how many of the players are people (the first slots); the rest are computer kingdoms. Default 1. */
  humans?: number;
  /** the player this machine plays (its fog, its messages); default 0 */
  local?: number;
  /** the campaign mission this game plays (missions.ts), by id; none in free play */
  mission?: string;
  /** a map of the players' own (map.ts) in place of the generator's: its size wins, and `players` may not exceed its starts */
  map?: MapData;
  /** a campaign region: the column that marched in from the last one (veterans and wagons, campaign.ts), added to the start */
  carry?: Carry;
  /** a campaign region: the campaign's difficulty (0 easy .. 2 hard; Normal as written), and how often Varro has fortified it (more men in his forts, bigger raids) */
  difficulty?: 0 | 1 | 2;
  fortified?: number;
}

export const OUT_CAP = 8;
/** A computer kingdom that has lost its headquarters yields once it holds this many strongholds or fewer and no castle,
 *  so the end of a won war isn't a hunt for the last watchtower or a harbour across the sea. */
export const YIELD_FORTS = 3;
/** One step of the game as it is played: sixty a second whatever the display does, the same on every machine (src/net/lockstep.ts). */
export const TICK = 1 / 60;

/** Only a building that still wants something can be put first: a site, or a finished one that takes goods in. */
export function canPrioritise(b: Building): boolean {
  if (b.state === 'burning') return false;
  if (b.state !== 'done') return true;
  return !!b.def.inputs || !!b.seaWant;
}

export class Game {
  world: World;
  path: PathFinder;
  /** the path finder's expansions when this step began (SOLDIER_PATH_BUDGET in settlers.ts) */
  pathMark = 0;
  /** who stands where, so idle settlers each find a spot of their own; rebuilt every step */
  spots: Spots;
  rng: RNG;
  opts: GameOptions;
  players: PlayerState[] = [];
  buildings = new Map<number, Building>();
  settlers = new Map<number, Settler>();
  trees = new Map<number, Tree>();
  stones = new Map<number, Stone>();
  fields = new Map<number, Field>();
  animals = new Map<number, Animal>();
  ships = new Map<number, Ship>();
  signs = new Map<number, Sign>();
  signsVersion = 1;
  seaOrders: SeaOrder[] = [];
  expeditions: Expedition[] = [];
  seaT = 0;
  /** overland trade between markets, carried by donkeys */
  tradeOrders: TradeOrder[] = [];
  tradeT = 0;
  isles: { x: number; y: number; r: number }[] = [];
  projectiles: Projectile[] = [];
  /** melee blows landing a moment after the swing */
  hits: { at: number; a: number; v: number; dmg: number }[] = [];
  towerT = 0;
  events: GameEvent[] = [];
  ai: AIController[] = [];
  time = 0;
  nextId = 1;
  local = 0;
  treesVersion = 1;
  stonesVersion = 1;
  fieldsVersion = 1;
  territoryDirty = true;
  ownerVersion = 0;
  exploreT = 0;
  checkT = 0;
  deerT = 0;
  deerTarget = 0;
  /** until the next round of hares breeding and moving out (wildlife.ts) */
  wildT = 0;
  winner = -1;
  over = false;
  starts: { x: number; y: number }[] = [];
  /** the campaign mission's state (campaign.ts): plain data, so it is saved like any other field; null in free play */
  ms: MissionState | null = null;

  /** The campaign mission this game plays, from its options (a getter: never saved, always current after a load). */
  get mission(): Mission | null {
    let m = missionOf.get(this);
    if (m === undefined) {
      m = this.opts.mission ? missionById(this.opts.mission) ?? null : null;
      missionOf.set(this, m);
    }
    return m;
  }

  /** How a computer kingdom plays in this mission: as in free play unless the mission says otherwise. */
  rivalMode(p: number): RivalMode {
    return rivalRule(this.mission, p)?.mode ?? 'ai';
  }

  /** Whether the Senate has granted the player this building yet (free play: everything, always). */
  canBuildType(owner: number, type: BuildingType) {
    const m = this.mission;
    return !m || owner !== this.local || allowedTypes(m).has(type);
  }
  canUseTool(owner: number, tool: Tool) {
    const m = this.mission;
    return !m || owner !== this.local || allowedTools(m).has(tool);
  }

  /** `generate = false` leaves an empty world and no players, for restoring a saved game into. */
  constructor(opts: GameOptions, generate = true) {
    this.opts = opts;
    this.local = opts.local ?? 0;
    this.rng = new RNG(opts.seed ^ 0x5bd1e995);
    if (opts.map) {
      if (opts.map.size !== opts.size) opts.size = opts.map.size;
      if (opts.players > opts.map.starts.length) throw new Error(`The map ${opts.map.name ? `"${opts.map.name}" ` : ''}has starts for ${opts.map.starts.length} player${opts.map.starts.length === 1 ? '' : 's'}, not ${opts.players}`);
    }
    this.world = new World(opts.size, opts.size);
    this.path = new PathFinder(this.world);
    this.spots = new Spots(this.world.N);
    if (!generate) return;
    if (opts.map) {
      // a map of the players' own: laid in as data, the trees, rocks and deer in its order
      const laid = applyMap(this, opts.map);
      this.starts = laid.starts;
      this.isles = laid.isles;
      this.deerTarget = laid.deer;
    } else {
      // (a campaign region's map is designed: its recipe steps into the generator's phases)
      const gen = generateMap(this.world, { size: opts.size, seed: opts.seed, players: opts.players, islands: opts.islands, recipe: recipeById(this.mission?.map.recipe) });
      this.starts = gen.starts;
      this.isles = gen.isles;
      for (const t of gen.trees) this.addTree(t.node, t.species, t.growth);
      for (const s of gen.stones) this.addStone(s.node, s.amount);
      for (const d of gen.deer) this.addAnimal(d.node, d.herd);
      this.deerTarget = gen.deer.length;
    }
    populateWild(this, this.starts);

    for (let p = 0; p < opts.players; p++) {
      this.players.push(this.newPlayer(p));
      this.setupStart(p, this.starts[p].x, this.starts[p].y);
      if (this.isHuman(p)) continue;
      // a mission may leave a rival without a mind (dormant), or with one that never marches (builder)
      const rule = rivalRule(this.mission, p);
      if (rule?.mode === 'dormant') continue;
      const a = new AIController(this, p, rule?.level ?? opts.aiLevel);
      if (rule?.mode === 'builder') a.mode = 'builder';
      this.ai.push(a);
    }
    recomputeTerritory(this);
    this.updateExplored(true);
    beginMission(this);
  }

  id() {
    return this.nextId++;
  }

  /** Whether slot `p` is played by a person (the first `opts.humans` slots are). */
  isHuman(p: number) {
    return p < (this.opts.humans ?? 1);
  }

  newPlayer(p: number): PlayerState {
    const toolPrio: Record<string, number> = {};
    for (const t of TOOLS) toolPrio[t] = 1;
    return {
      id: p, name: PLAYER_NAMES[p], color: PLAYER_COLORS[p], ai: !this.isHuman(p), alive: true,
      swordRatio: 0.65, toolPrio, dispatchT: p * 0.07, militaryT: p * 0.11, morale: 0,
      produced: emptyStock(), used: emptyStock(), flow: [], history: [], hq: 0, mana: 0, spellCd: 0, spellsCast: 0, traded: 0, fallen: false,
    };
  }

  emit(e: GameEvent) {
    this.events.push(e);
    if (this.events.length > 2000) this.events.splice(0, 1000);
    if (this.ms) tallyEvent(this, e);
  }

  /** A message for the local player; `b`, a building a click on it opens. */
  message(owner: number, text: string, x?: number, z?: number, kind = 'info', b?: number) {
    if (owner === this.local) this.emit({ type: 'msg', text, x, z, owner, kind, b });
  }

  // ------------------------------------------------------------ setup
  setupStart(p: number, sx: number, sy: number) {
    const x = sx - 1, y = sy - 1;
    // clear objects under hq
    const w = this.world;
    for (let yy = y - 2; yy <= y + 6; yy++)
      for (let xx = x - 2; xx <= x + 5; xx++) {
        if (!w.inBounds(xx, yy)) continue;
        const i = w.idx(xx, yy);
        if (w.tree[i]) this.removeTree(this.trees.get(w.tree[i])!);
        if (w.stone[i]) this.removeStone(this.stones.get(w.stone[i])!);
      }
    const hq = this.addBuilding('hq', p, x, y, true);
    this.players[p].hq = hq.id;
    const st = hq.stock;
    const init: Partial<Record<Good, number>> = {
      log: 10, board: 40, stone: 30, fish: 6, bread: 8, meat: 6, coal: 4, iron: 4, water: 4,
      axe: 4, pickaxe: 4, saw: 2, hammer: 3, shovel: 3, scythe: 2, rod: 2, bow: 2, sword: 2,
    };
    for (const g in init) st[g as Good] = init[g as Good]!;
    const door = hq.door;
    const spawn = (job: Job, n: number) => {
      for (let k = 0; k < n; k++) {
        const s = this.addSettler(p, job, door);
        s.hidden = false;
      }
    };
    spawn('carrier', 22);
    spawn('builder', 4);
    spawn('digger', 3);
    // soldiers garrisoned in HQ
    for (let k = 0; k < 7; k++) {
      const s = this.addSettler(p, k < 5 ? 'swordsman' : 'bowman', door);
      s.hidden = true;
      s.inside = hq.id;
      s.sstate = 'garrison';
      s.home = hq.id;
      hq.garrison.push(s.id);
    }
    hq.occupied = true;
    // scatter carriers around hq, each on a spot of his own
    const used = new Set<number>();
    for (const s of this.settlers.values()) {
      if (s.owner !== p || s.hidden) continue;
      const tries = 20;
      for (let k = 0; k < tries; k++) {
        const nx = sx + this.rng.int(-5, 7), ny = sy + this.rng.int(-3, 8);
        if (!w.inBounds(nx, ny)) continue;
        const i = w.idx(nx, ny);
        if (w.walkable(i) && !w.reserve[i] && !w.tree[i] && !used.has(i)) {
          s.node = i;
          used.add(i);
          break;
        }
      }
      this.syncPos(s);
    }
  }

  // ------------------------------------------------------------ entities
  addTree(node: number, species: number, growth: number): Tree {
    const t: Tree = {
      id: this.id(), node, species, growth, state: growth >= 1 ? 'mature' : 'grow', timer: 0,
      reserved: false, fallDir: 0, rot: this.rng.range(0, Math.PI * 2), scale: this.rng.range(0.8, 1.2),
    };
    this.trees.set(t.id, t);
    this.world.tree[node] = t.id;
    this.treesVersion++;
    return t;
  }
  removeTree(t: Tree) {
    if (!this.trees.has(t.id)) return;
    this.trees.delete(t.id);
    if (this.world.tree[t.node] === t.id) this.world.tree[t.node] = 0;
    this.treesVersion++;
  }
  addStone(node: number, amount: number): Stone {
    const s: Stone = { id: this.id(), node, amount, max: amount, reserved: 0, variant: this.rng.int(0, 3), rot: this.rng.range(0, 6.28) };
    this.stones.set(s.id, s);
    this.world.stone[node] = s.id;
    this.world.blocked[node] = 1;
    this.world.walkVersion++;
    this.stonesVersion++;
    return s;
  }
  removeStone(s: Stone) {
    if (!this.stones.has(s.id)) return;
    this.stones.delete(s.id);
    this.world.stone[s.node] = 0;
    if (!this.world.building[s.node]) this.world.blocked[s.node] = 0;
    this.world.walkVersion++;
    this.stonesVersion++;
  }
  addField(node: number, owner: number, farm: number, kind: Field['kind'] = 'grain'): Field {
    const f: Field = { id: this.id(), node, owner, farm, kind, growth: 0, reserved: false };
    this.fields.set(f.id, f);
    this.world.field[node] = f.id;
    this.fieldsVersion++;
    this.world.splatDirty = true;
    return f;
  }
  removeField(f: Field) {
    if (!this.fields.has(f.id)) return;
    this.fields.delete(f.id);
    if (this.world.field[f.node] === f.id) this.world.field[f.node] = 0;
    this.fieldsVersion++;
  }
  addAnimal(node: number, herd: number, kind: Animal['kind'] = 'deer'): Animal {
    const a: Animal = {
      id: this.id(), kind, node, next: -1, t: 0, stepDur: 1, path: null, pathI: 0,
      x: this.world.nx(node), z: this.world.ny(node), heading: this.rng.range(0, 6.28), reserved: false,
      alive: true, deadT: 0, wanderT: this.rng.range(0, 8), herd, home: node, leave: 0,
    };
    this.animals.set(a.id, a);
    return a;
  }

  addSettler(owner: number, job: Job, node: number): Settler {
    const w = this.world;
    const s: Settler = {
      id: this.id(), owner, job, node, next: -1, t: 0, stepDur: 0.5, path: null, pathI: 0,
      x: w.nx(node), z: w.ny(node), heading: this.rng.range(0, 6.28), hidden: false, inside: 0,
      anim: 'idle', animT: this.rng.range(0, 10), carrying: null, actions: [], onAbort: null, idle: true,
      home: 0, task: '', hp: 100, maxHp: 100, level: 0, sstate: 'idle', target: 0, targetB: 0, engaged: 0,
      cooldown: 0, scanT: this.rng.range(0, 0.3), dead: false, deadT: 0, wanderT: this.rng.range(0, 6),
      seed: this.rng.next(), blessUntil: 0, frozenUntil: 0, voyage: 0, voyageFrom: 0, aboard: 0, order: -1, fails: 0, pack: null,
      drill: 'line', firm: false, face: null, pace: 1,
    };
    if (job === 'bowman') { s.hp = s.maxHp = 80; }
    this.settlers.set(s.id, s);
    return s;
  }

  removeSettler(s: Settler) {
    abortPlan(this, s);
    this.settlers.delete(s.id);
  }

  syncPos(s: { node: number; next: number; t: number; x: number; z: number }) {
    const w = this.world;
    const ax = w.nx(s.node), az = w.ny(s.node);
    if (s.next >= 0) {
      const bx = w.nx(s.next), bz = w.ny(s.next);
      s.x = ax + (bx - ax) * s.t;
      s.z = az + (bz - az) * s.t;
    } else {
      s.x = ax;
      s.z = az;
    }
  }

  // ------------------------------------------------------------ buildings
  footprint(size: number, x: number, y: number): number[] {
    const out: number[] = [];
    for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) out.push(this.world.idx(xx, yy));
    return out;
  }
  doorOf(size: number, x: number, y: number) {
    return this.world.idx(x + (size >> 1), y + size);
  }
  anchorFor(type: BuildingType, hx: number, hy: number) {
    const size = BUILDINGS[type].size;
    const off = (size - 1) >> 1;
    return { x: hx - off, y: hy - off };
  }

  /** Returns null if placeable, otherwise a reason. `unclaimed` checks a colony site on no-one's land instead. */
  placeError(type: BuildingType, owner: number, x: number, y: number, unclaimed = false): string | null {
    if (!this.canBuildType(owner, type)) return 'The Senate has not granted this building yet';
    const def = BUILDINGS[type];
    const w = this.world;
    const size = def.size;
    if (x < 2 || y < 2 || x + size + 2 >= w.W || y + size + 2 >= w.H) return 'Out of bounds';
    let hmin = Infinity, hmax = -Infinity;
    const mine = !!def.mine;
    let mountainCount = 0;
    for (let yy = y; yy < y + size; yy++) {
      for (let xx = x; xx < x + size; xx++) {
        const i = w.idx(xx, yy);
        if (unclaimed ? w.owner[i] >= 0 : w.owner[i] !== owner) return 'Outside your territory';
        if (w.isWater(i)) return 'Cannot build on water';
        if (w.cliff[i]) return 'Sheer rock';
        if (w.building[i] || w.reserve[i]) return 'Occupied';
        if (w.stone[i]) return 'Rocks in the way';
        if (w.tree[i]) return 'Trees in the way';
        if (w.field[i]) return 'Fields in the way';
        const mtn = w.terrain[i] === T_ROCK || w.terrain[i] === T_SNOW;
        if (mtn) mountainCount++;
        if (!mine && mtn) return 'Only mines can be built on mountains';
        const h = w.h[i];
        if (h < hmin) hmin = h;
        if (h > hmax) hmax = h;
      }
    }
    if (mine && mountainCount < size * size * 0.6) return 'Mines must be built on mountains';
    const door = this.doorOf(size, x, y);
    if ((unclaimed ? w.owner[door] >= 0 : w.owner[door] !== owner) || !w.walkable(door) || w.building[door] || w.tree[door]) return 'Entrance blocked';
    const dh = w.h[door];
    hmin = Math.min(hmin, dh);
    hmax = Math.max(hmax, dh);
    // spacing ring
    for (let yy = y - 1; yy <= y + size; yy++) {
      for (let xx = x - 1; xx <= x + size; xx++) {
        if (xx >= x && xx < x + size && yy >= y && yy < y + size) continue;
        const i = w.idx(xx, yy);
        if (w.building[i]) return 'Too close to another building';
      }
    }
    const lim = mine ? 3.5 : size <= 2 ? 1.7 : size === 3 ? 1.4 : 1.2;
    if (hmax - hmin > lim) return 'Ground too steep';
    if (def.coastal && findDock(this, size, x, y) < 0) return 'Must be built on the coast, beside deep sea';
    // carriers never cross water: the land needs a storehouse (or a colony harbour going up)
    if (!unclaimed && !this.storageRegions(owner).has(w.region[door])) return 'Your settlers cannot reach this land — found a colony there from a harbour';
    return null;
  }

  private storageRegionCache = new Map<number, { t: number; n: number; set: Set<number> }>();
  /** Landmasses where a player has (or is building) a storehouse. */
  storageRegions(owner: number): Set<number> {
    const c = this.storageRegionCache.get(owner);
    if (c && c.t === this.time && c.n === this.buildings.size) return c.set;
    const set = new Set<number>();
    for (const b of this.buildings.values()) if (b.owner === owner && b.def.storage && b.state !== 'burning') set.add(this.world.region[b.door]);
    this.storageRegionCache.set(owner, { t: this.time, n: this.buildings.size, set });
    return set;
  }

  canPlace(type: BuildingType, owner: number, x: number, y: number) {
    return this.placeError(type, owner, x, y) === null;
  }

  addBuilding(type: BuildingType, owner: number, x: number, y: number, instant = false): Building {
    const def = BUILDINGS[type];
    const size = def.size;
    const w = this.world;
    const door = this.doorOf(size, x, y);
    const b = this.newBuilding(this.id(), type, owner, x, y);
    this.buildings.set(b.id, b);
    const fp = this.footprint(size, x, y);
    let sum = 0;
    for (const i of fp) {
      w.building[i] = b.id;
      sum += w.h[i];
      if (w.tree[i]) this.removeTree(this.trees.get(w.tree[i])!);
    }
    w.reserve[door] = b.id;
    // target height: average (mines keep the terrain)
    b.targetH = sum / fp.length;
    // bare-earth yard: footprint and the path in front of the door
    if (!def.mine) {
      const yard = [...fp, door];
      for (const i of yard) if (w.terrain[i] !== T_ROCK && w.terrain[i] !== T_SNOW) w.terrain[i] = T_DIRT;
    }
    w.splatDirty = true;
    if (def.mine) {
      b.levelTotal = 0;
      b.state = 'building';
      for (const i of fp) w.blocked[i] = 1;
      w.walkVersion++;
      this.evictAnimals(new Set(fp), door);
    } else {
      this.computeLevelWork(b);
      if (b.levelTotal < 0.05) this.finishLeveling(b);
    }
    if (instant) {
      if (b.state === 'leveling') this.finishLeveling(b);
      b.buildWork = b.buildTotal;
      b.state = 'done';
      onBuildingComplete(this, b, true);
    }
    return b;
  }

  /** A fresh construction site record, not yet placed in the world. */
  newBuilding(id: number, type: BuildingType, owner: number, x: number, y: number): Building {
    const def = BUILDINGS[type];
    const size = def.size;
    return {
      id, type, def, owner, x, y, size, door: this.doorOf(size, x, y),
      cx: x + (size - 1) / 2, cz: y + (size - 1) / 2,
      state: 'leveling', created: this.time, targetH: 0, levelWork: 0, levelTotal: 0,
      buildWork: 0, buildTotal: def.cost.board + def.cost.stone, delivered: { board: 0, stone: 0 }, used: 0,
      diggers: [], builders: [], stock: emptyStock(), incoming: emptyStock(), outgoing: emptyStock(),
      worker: 0, workerIncoming: 0, working: false, workT: 0, paused: false, status: '', stall: null, stallT: 0,
      garrison: [], soldiersIncoming: 0, desiredSoldiers: def.military?.capacity ?? 0, occupied: false,
      spawned: 0, spawnT: 0, burnT: 0, shootT: 0, prodCount: 0, lastProd: 0, toolChoice: 'auto',
      weaponRatio: 0.65, underAttackT: 0,
      dock: def.coastal ? findDock(this, size, x, y) : -1, colony: false, shipProgress: 0, seaWant: null, tradeTo: 0,
      priority: false, damage: 0, shipKind: 'trade', seaAuto: true,
    };
  }

  /** The building a player has put first in line for goods and crews, if any. */
  priorityOf(owner: number): Building | null {
    for (const b of this.buildings.values()) if (b.owner === owner && b.priority && b.state !== 'burning') return b;
    return null;
  }

  /** Player command: make `b` the one prioritised building (clearing the previous one), or take the priority off it. */
  setPriority(b: Building, on: boolean): boolean {
    if (on && !canPrioritise(b)) return false;
    for (const o of this.buildings.values()) if (o.owner === b.owner && o.priority) o.priority = false;
    b.priority = on;
    if (on) this.emit({ type: 'priority', b: b.id, x: b.cx, z: b.cz, owner: b.owner });
    return true;
  }

  computeLevelWork(b: Building) {
    const w = this.world;
    let total = 0;
    for (const i of this.footprint(b.size, b.x, b.y)) total += Math.abs(w.h[i] - b.targetH);
    const d = b.door;
    total += Math.abs(w.h[d] - b.targetH) * 0.5;
    b.levelTotal = total;
    return total;
  }

  finishLeveling(b: Building) {
    const w = this.world;
    const fp = this.footprint(b.size, b.x, b.y);
    for (const i of fp) {
      w.h[i] = b.targetH;
      w.blocked[i] = 1;
    }
    // soften door
    w.h[b.door] = w.h[b.door] * 0.3 + b.targetH * 0.7;
    w.walkVersion++;
    // nobody may stand inside the now solid footprint
    const fpSet = new Set(fp);
    for (const s of this.settlers.values()) {
      if (s.hidden) continue;
      if (fpSet.has(s.node) || (s.next >= 0 && fpSet.has(s.next))) {
        s.node = b.door;
        s.next = -1;
        s.path = null;
        s.t = 0;
        this.syncPos(s);
      }
    }
    this.evictAnimals(fpSet, b.door);
    w.markHeightDirty(b.x - 1, b.y - 1, b.x + b.size + 1, b.y + b.size + 1);
    b.state = 'building';
    b.levelTotal = 0;
  }

  /** Game standing in a footprint that has just turned solid steps out to the door: it could never hop out,
   *  and a hunter after it would search the whole landmass for a way in. */
  private evictAnimals(fp: Set<number>, door: number) {
    for (const a of this.animals.values()) {
      if (!a.alive || !(fp.has(a.node) || (a.next >= 0 && fp.has(a.next)))) continue;
      a.node = door;
      a.next = -1;
      a.path = null;
      a.t = 0;
      if (fp.has(a.home)) a.home = door;
      this.syncPos(a);
    }
  }

  /** Player command: place a construction site. */
  placeBuilding(type: BuildingType, owner: number, x: number, y: number): Building | null {
    if (!this.canPlace(type, owner, x, y)) return null;
    const b = this.addBuilding(type, owner, x, y);
    this.emit({ type: 'placed', b: b.id, x: b.cx, z: b.cz, owner });
    return b;
  }

  /** Remove a building. burn=true plays a burning animation first. */
  destroyBuilding(b: Building, burn = true) {
    if (!this.buildings.has(b.id)) return;
    if (b.state === 'burning') return;
    const w = this.world;
    // release people inside / assigned
    const releaseSettler = (id: number, asSoldier: boolean) => {
      const s = this.settlers.get(id);
      if (!s) return;
      if (s.inside === b.id) {
        s.inside = 0;
        s.hidden = false;
        s.node = b.door;
        s.next = -1;
        this.syncPos(s);
      }
      abortPlan(this, s);
      if (asSoldier) {
        s.sstate = 'idle';
        s.home = 0;
      } else if (s.home === b.id) {
        s.home = 0;
      }
    };
    if (b.worker) releaseSettler(b.worker, false);
    for (const id of b.garrison) releaseSettler(id, true);
    b.garrison = [];
    for (const s of this.settlers.values()) {
      if (s.aboard) continue;
      if (s.home === b.id || s.inside === b.id || s.targetB === b.id) releaseSettler(s.id, s.job === 'swordsman' || s.job === 'bowman');
      else if (s.voyageFrom === b.id) { abortPlan(this, s); cancelVoyage(this, s); }
    }
    b.seaWant = null;
    b.priority = false;
    // fields of farm
    if (b.type === 'farm' || b.type === 'vineyard') for (const f of [...this.fields.values()]) if (f.farm === b.id) this.removeField(f);
    b.worker = 0;
    b.stock = emptyStock();
    b.incoming = emptyStock();
    b.outgoing = emptyStock();
    b.delivered = { board: 0, stone: 0 };
    b.occupied = false;
    const wasMilitary = !!b.def.military;
    if (burn && b.state !== 'leveling') {
      b.state = 'burning';
      b.burnT = 0;
      this.emit({ type: 'burn', b: b.id, x: b.cx, z: b.cz });
    } else {
      this.finalRemove(b);
    }
    if (wasMilitary) this.territoryDirty = true;
    void w;
  }

  finalRemove(b: Building) {
    const w = this.world;
    for (const i of this.footprint(b.size, b.x, b.y)) {
      if (w.building[i] === b.id) w.building[i] = 0;
      w.blocked[i] = w.stone[i] ? 1 : 0;
    }
    w.walkVersion++;
    if (w.reserve[b.door] === b.id) w.reserve[b.door] = 0;
    this.buildings.delete(b.id);
    this.emit({ type: 'removed', b: b.id, x: b.cx, z: b.cz });
    if (b.def.military) this.territoryDirty = true;
  }

  // ------------------------------------------------------------ queries
  storages(owner: number): Building[] {
    const out: Building[] = [];
    for (const b of this.buildings.values()) if (b.owner === owner && b.def.storage && b.state === 'done') out.push(b);
    return out;
  }

  nearestStorage(owner: number, x: number, z: number, region = 0): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.buildings.values()) {
      if (b.owner !== owner || !b.def.storage || b.state !== 'done') continue;
      if (region && this.world.region[b.door] !== region) continue;
      const d = sq(b.cx - x) + sq(b.cz - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  totalStock(owner: number): Record<Good, number> {
    const r = emptyStock();
    for (const b of this.buildings.values()) {
      if (b.owner !== owner || b.state !== 'done') continue;
      if (b.def.storage || b.type === 'market') for (const g of GOODS) r[g] += b.stock[g];
      else if (b.def.outputs) for (const g of b.def.outputs) r[g] += b.stock[g];
    }
    return r;
  }

  countBuildings(owner: number, type?: BuildingType, includeSites = true) {
    let n = 0;
    for (const b of this.buildings.values()) {
      if (b.owner !== owner || b.state === 'burning') continue;
      if (type && b.type !== type) continue;
      if (!includeSites && b.state !== 'done') continue;
      n++;
    }
    return n;
  }

  population(owner: number) {
    const r = { total: 0, carriers: 0, idle: 0, soldiers: 0, builders: 0, diggers: 0, workers: 0, donkeys: 0, catapults: 0 };
    for (const s of this.settlers.values()) {
      if (s.owner !== owner || s.dead) continue;
      if (s.job === 'donkey') { r.donkeys++; continue; } // beasts of burden, not people
      if (s.job === 'catapult') { r.catapults++; continue; } // machines
      r.total++;
      if (s.job === 'carrier') { r.carriers++; if (s.idle) r.idle++; }
      else if (s.job === 'swordsman' || s.job === 'bowman') r.soldiers++;
      else if (s.job === 'builder') r.builders++;
      else if (s.job === 'digger') r.diggers++;
      else r.workers++;
    }
    return r;
  }

  mineOreLeft(b: Building): number {
    if (!b.def.mine) return 0;
    const ore = MINE_ORE[b.def.mine];
    const w = this.world;
    let total = 0;
    w.forRadius(b.cx, b.cz, (b.def.radius ?? 3) + 0.5, (i) => {
      if (w.ore[i] === ore) total += w.oreAmt[i];
    });
    return total;
  }

  isFood(g: Good) {
    return FOODS.includes(g);
  }

  // ------------------------------------------------------------ main update
  update(dt: number) {
    if (this.over) dt = dt; // keep simulating visuals after the end
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(0.05, remaining);
      this.step(step);
      remaining -= step;
    }
  }

  /** One fixed step, TICK long: what the lockstep driver runs. */
  tick() {
    this.step(TICK);
  }

  step(dt: number) {
    this.time += dt;
    this.pathMark = this.path.expansions;
    // trees growth
    this.updateNature(dt);
    // buildings
    for (const b of this.buildings.values()) updateBuilding(this, b, dt);
    // settlers
    markSpots(this);
    for (const s of this.settlers.values()) updateSettler(this, s, dt);
    // animals
    this.updateAnimals(dt);
    updateProjectiles(this, dt);
    updateFaith(this, dt);
    updateSea(this, dt);
    updateTrade(this, dt);
    // economy dispatch per player
    for (const p of this.players) {
      if (!p.alive) continue;
      // a mission's dormant rival runs no economy and sends no reinforcements; its strongholds still defend themselves
      const dormant = !!this.ms && p.ai && this.rivalMode(p.id) === 'dormant';
      p.dispatchT -= dt;
      if (p.dispatchT <= 0) {
        p.dispatchT = 0.3;
        if (!dormant) updateEconomy(this, p.id);
      }
      p.militaryT -= dt;
      if (p.militaryT <= 0) {
        p.militaryT = 0.5;
        updateMilitary(this, p.id, dormant);
      }
    }
    for (const ai of this.ai) ai.update(dt);
    if (this.territoryDirty) {
      this.territoryDirty = false;
      recomputeTerritory(this);
    }
    this.exploreT -= dt;
    if (this.exploreT <= 0) {
      this.exploreT = 0.5;
      this.updateExplored(false);
    }
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 2;
      this.checkVictory();
      if (this.ms) missionStep(this);
      this.recordHistory();
      sampleFlow(this);
      updateSigns(this);
    }
  }

  private natureT = 0;
  private updateNature(dt: number) {
    this.natureT -= dt;
    if (this.natureT > 0) return;
    const step = 0.5;
    this.natureT = step;
    for (const t of this.trees.values()) {
      if (t.state === 'grow') {
        t.growth += step / 150; // ~2.5 minutes to mature
        if (t.growth >= 1) {
          t.growth = 1;
          t.state = 'mature';
        }
        this.treesVersion++;
      }
    }
    for (const f of this.fields.values()) {
      if (f.growth < 1) {
        f.growth = Math.min(1, f.growth + step / (f.kind === 'vine' ? 110 : 90));
        this.fieldsVersion++;
      }
    }
    // footpaths: grass slowly recovers where nobody walks
    const w = this.world;
    const wear = w.wear;
    for (let i = 0; i < wear.length; i++) if (wear[i] > 0) wear[i] = wear[i] > 0.002 ? wear[i] * 0.9965 : 0;
    // fish regeneration (slow)
    for (let k = 0; k < 30; k++) {
      const i = this.rng.int(0, w.N);
      if (w.isWater(i) && w.h[i] > WATER_LEVEL - 4.5 && w.fish[i] < 6 && this.rng.chance(0.2)) w.fish[i]++;
    }
  }

  private updateAnimals(dt: number) {
    const w = this.world;
    for (const a of this.animals.values()) {
      if (!a.alive) {
        a.deadT += dt;
        if (a.deadT > 90) this.animals.delete(a.id);
        continue;
      }
      if (a.leave) continue;
      const hare = a.kind === 'hare';
      // movement
      if (a.next >= 0) {
        a.t += dt / a.stepDur;
        if (a.t >= 1) {
          a.node = a.next;
          a.next = -1;
          a.t = 0;
        }
      }
      if (a.next < 0 && a.path && a.pathI < a.path.length) {
        const n = a.path[a.pathI++];
        if (w.walkable(n)) {
          a.next = n;
          a.t = 0;
          const dx = w.nx(n) - w.nx(a.node), dz = w.ny(n) - w.ny(a.node);
          // a hare goes in quick hops, a deer at a walk
          a.stepDur = (dx && dz ? 1.41 : 1) * (hare ? 0.34 : 0.9);
          a.heading = atan2(dx, dz);
        } else a.path = null;
      }
      this.syncPos(a);
      a.wanderT -= dt;
      if (a.wanderT <= 0 && a.next < 0) {
        a.wanderT = hare ? this.rng.range(2, 8) : this.rng.range(4, 14);
        wander(this, a);
      }
    }
    updateWild(this, dt);
  }

  /** Where each building, settler and ship last revealed its disc (updateExplored), by id: `seen` and
   *  `explored` only ever grow, so the same disc revealed again for the same player changes nothing
   *  and is skipped. Derived state, never saved: a loaded game starts empty and reveals everything once. */
  private revealedB = new Map<number, number[]>();
  private revealedS = new Map<number, number[]>();
  private revealedSh = new Map<number, number[]>();
  private revealPass = 0;

  /** What each player has seen of the map (`world.seen`, a bit a player, the same on every machine), and the
   *  local player's fog (`world.explored`, this machine's view of the same). */
  updateExplored(force: boolean) {
    const w = this.world;
    let changed = false;
    const localBit = 1 << this.local;
    let bit = 1;
    const pass = ++this.revealPass;
    const reveal = (cx: number, cz: number, r: number) => {
      w.forRadius(cx, cz, r, (i) => {
        w.seen[i] |= bit;
        if (bit === localBit && !w.explored[i]) {
          w.explored[i] = 1;
          changed = true;
        }
      });
    };
    // (the disc of `id` in `m` unless it is the one it last revealed)
    const revealOnce = (m: Map<number, number[]>, id: number, cx: number, cz: number, r: number) => {
      let e = m.get(id);
      if (!e) m.set(id, (e = [NaN, 0, 0, 0, 0]));
      e[4] = pass;
      if (!force && e[0] === cx && e[1] === cz && e[2] === r && e[3] === bit) return;
      e[0] = cx; e[1] = cz; e[2] = r; e[3] = bit;
      reveal(cx, cz, r);
    };
    for (const p of this.players) {
      bit = 1 << p.id;
      for (const b of this.buildings.values()) {
        if (b.owner !== p.id) continue;
        const r = b.def.military && b.occupied ? b.def.military.radius + 4 : b.size + 5;
        if (!force && b.state !== 'done' && !b.def.military) { revealOnce(this.revealedB, b.id, b.cx, b.cz, b.size + 4); continue; }
        revealOnce(this.revealedB, b.id, b.cx, b.cz, r);
      }
      for (const s of this.settlers.values()) {
        if (s.owner !== p.id || s.hidden || s.dead) continue;
        revealOnce(this.revealedS, s.id, s.x, s.z, s.job === 'swordsman' || s.job === 'bowman' ? 7 : s.job === 'catapult' ? 6 : 4.5);
      }
      for (const sh of this.ships.values()) if (sh.owner === p.id) revealOnce(this.revealedSh, sh.id, sh.x, sh.z, 8);
      // a realm whose headquarters has fallen can hide its strongholds no longer (nor can any rival's in a mission that says so)
      const shown = this.mission?.rules?.reveal === 'strongholds';
      for (const b of this.buildings.values()) {
        if (b.owner === p.id || !b.def.military || b.state !== 'done' || !(shown || this.players[b.owner]?.fallen)) continue;
        reveal(b.cx, b.cz, b.size + 3);
      }
    }
    // (now and then, forget what is gone)
    if (pass % 64 === 0) for (const m of [this.revealedB, this.revealedS, this.revealedSh]) for (const [id, e] of m) if (e[4] !== pass) m.delete(id);
    if (changed) w.exploredDirty = true;
  }

  private checkVictory() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const forts = strongholdsOf(this, p.id);
      const hq = this.buildings.get(p.hq);
      const fallen = !(hq && hq.owner === p.id && hq.state === 'done');
      if (fallen && !p.fallen && forts.length) {
        // the others learn where the rest of the realm stands (see updateExplored)
        const me = this.buildings.get(this.players[this.local].hq);
        const near = nearestTo(forts, me?.cx ?? 0, me?.cz ?? 0);
        if (p.id !== this.local) this.message(this.local, `The headquarters of ${p.name} has fallen! Its ${forts.length} remaining stronghold${forts.length > 1 ? 's are' : ' is'} marked on the map.`, near.cx, near.cz, 'good', near.id);
      }
      p.fallen = fallen;
      // (a mission's scripted rivals never yield, nor any when the mission says so)
      const computer = this.ai.some((a) => a.p === p.id && a.mode === 'ai') && !this.mission?.rules?.noYield;
      const yields = fallen && forts.length > 0 && forts.length <= YIELD_FORTS && !forts.some((b) => b.type === 'castle') && computer;
      if (!forts.length || yields) {
        p.alive = false;
        this.emit({ type: 'defeated', owner: p.id, text: yields ? `${p.name} yields! Its last stronghold${forts.length > 1 ? 's lay' : ' lays'} down their arms.` : `${p.name} has been defeated!` });
        // their settlers wander leaderless; soldiers die off
        for (const s of this.settlers.values()) if (s.owner === p.id) { s.dead = true; s.anim = 'die'; s.deadT = 0; abortPlan(this, s); }
        for (const b of this.buildings.values()) if (b.owner === p.id) this.destroyBuilding(b, true);
        sinkFleet(this, p.id);
        this.tradeOrders = this.tradeOrders.filter((o) => o.owner !== p.id);
      }
    }
    if (!this.over) {
      const alive = this.players.filter((p) => p.alive);
      // over when no person is left standing (each learns of their own fall from the `defeated` event), or one realm is
      if (!alive.some((p) => !p.ai)) {
        this.over = true;
        this.winner = alive.length ? alive[0].id : -1;
        this.emit({ type: 'gameover', owner: this.winner });
      } else if (alive.length === 1 && !this.mission) {
        // (a mission is won by its goals, and may have no rival at all)
        this.over = true;
        this.winner = alive[0].id;
        this.emit({ type: 'gameover', owner: this.winner });
      }
      // the winner's people cheer where they stand
      if (this.over && this.winner >= 0) {
        for (const s of this.settlers.values()) if (s.owner === this.winner && !s.hidden && !s.dead && s.actions.length === 0) { s.anim = 'cheer'; s.animT = 0; }
      }
    }
  }

  private recordHistory() {
    for (const p of this.players) {
      if (p.history.length && this.time - p.history[p.history.length - 1].t < 15) continue;
      const pop = this.population(p.id);
      const st = this.totalStock(p.id);
      let goods = 0;
      for (const g of GOODS) goods += st[g];
      p.history.push({ t: this.time, pop: pop.total, soldiers: pop.soldiers, buildings: this.countBuildings(p.id, undefined, false), goods });
    }
  }
}

/** the mission each game plays, looked up once (kept off the object, so saves never see it) */
const missionOf = new WeakMap<Game, Mission | null>();

/** A player's manned strongholds (military buildings, harbours included): what keeps the realm alive. */
export function strongholdsOf(g: Game, owner: number): Building[] {
  const out: Building[] = [];
  for (const b of g.buildings.values()) if (b.owner === owner && b.def.military && b.state === 'done' && b.occupied) out.push(b);
  return out;
}

function nearestTo(list: Building[], x: number, z: number): Building {
  let best = list[0], bd = Infinity;
  for (const b of list) { const d = sq(b.cx - x) + sq(b.cz - z); if (d < bd) { bd = d; best = b; } }
  return best;
}
