// The campaign framework: what a mission is, which buildings and tools it grants, the state the game
// keeps for it, and the helpers a mission's setup uses to raise a camp, plant a rebel fort or send a
// raid. Pure data and rules, no DOM; the missions themselves are in missions.ts. Everything here runs
// inside the game (the constructor and the step), so it is deterministic and travels in saves.
import { BUILDINGS, ORE_COAL, ORE_IRON, emptyStock, type BuildingType, type Good, type Job } from './defs';
import type { Game } from './game';
import type { Building, GameEvent, Settler, Ship, ShipKind } from './types';
import { atan2, cos, hypot, sin, sq } from '../core/fmath';
import { orderAttack } from './orders';
import { nearestNavigable } from './sea';
import { shipFields } from './naval';
import { MISSIONS } from './missions';

/** Interface tools a mission can hold back (buildings are held back by `unlocks`). */
export type Tool = 'geologist' | 'pioneer' | 'spells' | 'warships';
export type RivalMode = 'dormant' | 'builder' | 'ai';

/** What "Show me" on a goal does. */
export interface FocusSpec {
  /** open the Build tab on the building's category and pulse its card until it is picked */
  build?: BuildingType;
  /** pulse the Geologist or Pioneer card, the Faith tab, or the shipyard's warship toggle */
  tool?: Tool;
  /** take the view there and pulse a ring on the ground (r in nodes, default 3) */
  spot?: (g: Game) => { x: number; z: number; r?: number } | null;
  /** take the view to one of the player's buildings and select it (0 = none yet) */
  building?: (g: Game) => number;
}

export interface Goal {
  id: string;
  text: string;
  hint: string;
  done: (g: Game) => boolean;
  progress?: (g: Game) => string;
  /** never holds the mission up; listed as "(optional)" */
  optional?: boolean;
  focus?: FocusSpec;
  /** headless only (scripts/campaign.ts): put the game into a state where `done` holds */
  satisfy?: (g: Game) => void;
}

/** A word from the quaestor the first time something happens in this mission. */
export interface Tip {
  id: string;
  /** the event type that raises it ('produced', 'built', 'attack', …); other players' events are ignored */
  on: string;
  when?: (g: Game, e: GameEvent) => boolean;
  title: string;
  detail: string;
  focus?: FocusSpec;
}

export interface RivalRule {
  /** dormant: no controller, no economy, its garrisons stay put but strongholds still defend themselves;
   *  builder: a full computer economy that never launches an attack or a bombardment; ai: as in free play */
  mode: RivalMode;
  /** 0 easy .. 2 hard; default the map's aiLevel */
  level?: number;
  /** its name in messages and panels */
  name?: string;
  /** dormant only: its carriers, builders and diggers are sent away at the start, so the far camp stands quiet */
  noPeople?: boolean;
}

export interface Raid {
  /** game seconds */
  t: number;
  /** the rival the raiders belong to, default 1 */
  rival?: number;
  /** edge: on free land 28-36 from the target on the far side from the player's headquarters; rival: at the rival's headquarters */
  from: 'edge' | 'rival';
  men: { sword: number; bow: number; hp?: number };
  /** nearest-tower: the player's manned stronghold (not the headquarters) nearest the rival, else the headquarters */
  target: 'nearest-tower' | 'hq';
}

export interface MissionRules {
  /** rivals[p - 1] for players 1..n-1; missing entries play as in free play */
  rivals?: RivalRule[];
  /** computer rivals launch no attack and no bombardment before this game second */
  truce?: number;
  /** computer rivals never yield: they are fought to the last stronghold */
  noYield?: boolean;
  /** strongholds: every rival stronghold shows through the fog from the start; all: the whole map */
  reveal?: 'none' | 'strongholds' | 'all';
  raids?: Raid[];
}

export interface Mission {
  /** stable id kept in saves and progress ('castra', 'domus', …): never renamed */
  id: string;
  title: string;
  subtitle: string;
  briefing: string[];
  debrief: string;
  hook: string;
  map: { size: number; seed: number; players: number; aiLevel: number; islands?: boolean };
  /** buildings this mission grants; what earlier missions granted stays */
  unlocks: BuildingType[];
  tools?: Tool[];
  rules?: MissionRules;
  /** runs once on a fresh game, after the standard start; never on a loaded save */
  setup?: (g: Game) => void;
  goals: Goal[];
  tips?: Tip[];
  /** more of the quaestor's lines, by the event that calls for them ('raid', 'truceover'…): spoken as `<id>.<key>` */
  voice?: Record<string, string>;
  /** headless only: why this map cannot serve the goals, or null */
  probe?: (g: Game) => string | null;
}

/** What the game keeps of a mission: plain data, saved as a Game scalar (`g.ms`), null in free play. */
export interface MissionState {
  /** buildings and ships the setup placed, for goals ("capture the first fort") */
  forts: number[];
  ships: number[];
  /** the landmass of the player's headquarters */
  home: number;
  /** the next raid to fire */
  raid: number;
  truceOver: boolean;
  won: boolean;
  /** the local player's events so far: 'captured', 'captured:<building>', 'spell:harvest', 'produced:board', 'sinking:<ship>' … */
  tally: Record<string, number>;
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
export const numeralOf = (i: number) => ROMAN[i] ?? String(i + 1);

// ------------------------------------------------------------------ lookups
export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}
export function missionIndex(id: string): number {
  return MISSIONS.findIndex((m) => m.id === id);
}
/** The first mission not yet done, or undefined once the campaign is finished. */
export function nextMission(done: Record<string, unknown>): Mission | undefined {
  return MISSIONS.find((m) => !done[m.id]);
}

const allowedCache = new Map<string, Set<BuildingType>>();
const toolCache = new Map<string, Set<Tool>>();
/** Every building granted by this mission and the ones before it. */
export function allowedTypes(m: Mission): ReadonlySet<BuildingType> {
  let set = allowedCache.get(m.id);
  if (!set) {
    set = new Set<BuildingType>();
    for (const x of MISSIONS) {
      for (const t of x.unlocks) set.add(t);
      if (x === m) break;
    }
    allowedCache.set(m.id, set);
  }
  return set;
}
export function allowedTools(m: Mission): ReadonlySet<Tool> {
  let set = toolCache.get(m.id);
  if (!set) {
    set = new Set<Tool>();
    for (const x of MISSIONS) {
      for (const t of x.tools ?? []) set.add(t);
      if (x === m) break;
    }
    toolCache.set(m.id, set);
  }
  return set;
}
/** The mission that first grants a building, for the "later" note on its card. */
export function unlockedIn(type: BuildingType): Mission | undefined {
  return MISSIONS.find((m) => m.unlocks.includes(type));
}
export function toolUnlockedIn(tool: Tool): Mission | undefined {
  return MISSIONS.find((m) => m.tools?.includes(tool));
}
export function rivalRule(m: Mission | null, p: number): RivalRule | undefined {
  return p > 0 ? m?.rules?.rivals?.[p - 1] : undefined;
}

// ------------------------------------------------------------------ the game's side
export const hqOf = (g: Game, owner = g.local): Building => g.buildings.get(g.players[owner].hq)!;

/** Called by the Game constructor once the standard start stands: the mission's state, its rules and its setup. */
export function beginMission(g: Game) {
  const m = g.mission;
  if (!m) return;
  const w = g.world;
  g.ms = { forts: [], ships: [], home: w.region[hqOf(g).door], raid: 0, truceOver: false, won: false, tally: {} };
  const rules = m.rules;
  for (const p of g.players) {
    const rule = rivalRule(m, p.id);
    if (!rule) continue;
    if (rule.name) p.name = rule.name;
    if (rule.mode === 'dormant' && rule.noPeople) dormantize(g, p.id);
  }
  if (rules?.reveal === 'all') {
    w.seen.fill(0xff);
    w.explored.fill(1);
    w.exploredDirty = true;
  }
  m.setup?.(g);
}

/** Every event of the local player's doing goes on the tally the goals read. */
export function tallyEvent(g: Game, e: GameEvent) {
  const ms = g.ms;
  if (!ms) return;
  const bump = (k: string) => { ms.tally[k] = (ms.tally[k] ?? 0) + 1; };
  // a ship going down is counted by the ship, whoever sank it
  if (e.type === 'sinking' && e.s) bump(`sinking:${e.s}`);
  // whose doing: the event's owner, else the owner of the building it names
  let owner = e.owner;
  if (owner === undefined && e.b) owner = g.buildings.get(e.b)?.owner;
  if (owner !== g.local) return;
  bump(e.type);
  if (e.b) bump(`${e.type}:${e.b}`);
  if (e.kind) bump(`${e.type}:${e.kind}`);
  if (e.kind && e.b) bump(`${e.type}:${e.kind}:${e.b}`);
  if (e.good) bump(`${e.type}:${e.good}`);
}

/** Once a step: the raids that are due, the end of the truce, and the mission won. */
export function missionStep(g: Game) {
  const m = g.mission, ms = g.ms;
  if (!m || !ms) return;
  const rules = m.rules;
  if (rules?.raids) while (ms.raid < rules.raids.length && g.time >= rules.raids[ms.raid].t) fireRaid(g, rules.raids[ms.raid++]);
  if (rules?.truce && !ms.truceOver && g.time >= rules.truce) {
    ms.truceOver = true;
    g.emit({ type: 'truceover', owner: g.local });
    g.message(g.local, 'The truce is over: the enemy may march at any time', undefined, undefined, 'bad');
  }
  if (!ms.won && m.goals.every((goal) => goal.optional || goal.done(g))) {
    ms.won = true;
    g.emit({ type: 'missionwon', owner: g.local });
  }
}

/** Whether a computer rival is truced: no attack, no bombardment yet. */
export function truced(g: Game) {
  const t = g.mission?.rules?.truce;
  return !!t && g.time < t;
}

export const allRivalsDefeated = (g: Game) => g.players.every((p) => p.id === g.local || !p.alive);

// ------------------------------------------------------------------ setup helpers
/** The placeable anchor for `type` nearest (x, z), within rMax. `unclaimed` = on nobody's land (a rival's fort). */
export function placeNear(g: Game, owner: number, type: BuildingType, x: number, z: number, rMax = 9, unclaimed = false): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  g.world.forRadius(x, z, rMax, (_i, nx, ny, d2) => {
    if (d2 >= bd) return;
    const a = g.anchorFor(type, nx, ny);
    if (g.placeError(type, owner, a.x, a.y, unclaimed) !== null) return;
    bd = d2;
    best = a;
  });
  return best;
}

/** A finished building of the player's near a spot, or an error: the mission's map is not fit for its setup. */
export function prebuilt(g: Game, type: BuildingType, x: number, z: number, rMax = 9, owner = g.local): Building {
  const a = placeNear(g, owner, type, x, z, rMax);
  if (!a) throw new Error(`campaign: no room for a ${type} near ${x.toFixed(0)},${z.toFixed(0)}`);
  const b = g.addBuilding(type, owner, a.x, a.y, true);
  if (b.def.mine) knowOre(g, owner, b.cx, b.cz, (b.def.radius ?? 3) + 1);
  return b;
}

/** Goods in the headquarters' store. */
export function stockUp(g: Game, goods: Partial<Record<Good, number>>, owner = g.local) {
  Object.assign(hqOf(g, owner).stock, goods);
}

/** A residence with its people already moved in. */
export function fillResidence(g: Game, b: Building, n = b.def.residence ?? 0) {
  b.spawned = n;
  for (let k = 0; k < n; k++) {
    const s = g.addSettler(b.owner, 'carrier', b.door);
    g.syncPos(s);
  }
}

/** So many of the player's free carriers go home: the camp starts short-handed. */
export function fewerCarriers(g: Game, n: number, owner = g.local) {
  for (const s of [...g.settlers.values()]) {
    if (n <= 0) break;
    if (s.owner === owner && s.job === 'carrier' && !s.inside && !s.actions.length) { g.removeSettler(s); n--; }
  }
}

/** A rival's working people leave; its soldiers stay in their garrisons. */
export function dormantize(g: Game, owner: number) {
  for (const s of [...g.settlers.values()]) {
    if (s.owner !== owner || s.job === 'swordsman' || s.job === 'bowman') continue;
    g.removeSettler(s);
  }
}

/** The player knows the ore around a spot (as a geologist's signs would tell).*/
export function knowOre(g: Game, owner: number, x: number, z: number, r: number) {
  const w = g.world, bit = 1 << owner;
  w.forRadius(x, z, r, (i) => { w.prospected[i] |= bit; });
}

/** The fog lifts around a spot for the local player. */
export function revealAround(g: Game, x: number, z: number, r: number) {
  const w = g.world, bit = 1 << g.local;
  w.forRadius(x, z, r, (i) => { w.seen[i] |= bit; w.explored[i] = 1; });
  w.exploredDirty = true;
}

/** Soldiers inside a stronghold, so it stands manned (and, for a rival's, keeps its land). */
export function garrison(g: Game, b: Building, men: { sword: number; bow: number; hp?: number }) {
  const add = (job: Job, n: number) => {
    for (let k = 0; k < n; k++) {
      const s = g.addSettler(b.owner, job, b.door);
      s.hidden = true;
      s.inside = b.id;
      s.sstate = 'garrison';
      s.home = b.id;
      if (men.hp) s.hp = s.maxHp = men.hp;
      b.garrison.push(s.id);
    }
  };
  add('swordsman', men.sword);
  add('bowman', men.bow);
  b.occupied = true;
  b.desiredSoldiers = Math.max(1, b.garrison.length);
  g.territoryDirty = true;
}

export interface FortOpts {
  type: 'tower_s' | 'tower_l' | 'castle' | 'harbour';
  owner: number;
  /** distance from the player's headquarters (or `of`), and the way to look first */
  near: { of?: { x: number; z: number }; dist: [number, number]; toward?: 'rival' | 'centre' | number; spread?: number };
  garrison: { sword: number; bow: number; hp?: number };
  /** navigable sea within reach of a ship's stones */
  coastal?: boolean;
}

/** A rival's manned stronghold on free land at a distance from the player's headquarters, reachable on foot. */
export function fort(g: Game, o: FortOpts): Building {
  const w = g.world;
  const hq = hqOf(g);
  const ox = o.near.of?.x ?? hq.cx, oz = o.near.of?.z ?? hq.cz;
  let a0: number;
  if (typeof o.near.toward === 'number') a0 = o.near.toward;
  else if (o.near.toward === 'centre' || g.players.length < 2) a0 = atan2(w.H / 2 - oz, w.W / 2 - ox);
  else { const r = hqOf(g, o.owner); a0 = atan2(r.cz - oz, r.cx - ox); }
  const spread = o.near.spread ?? Math.PI / 2;
  const size = BUILDINGS[o.type].size;
  const home = w.region[hq.door];
  for (let d = o.near.dist[0]; d <= o.near.dist[1]; d++) {
    for (let k = 0; k * 0.3 <= spread; k++) {
      for (const da of k ? [k * 0.3, -k * 0.3] : [0]) {
        const cx = ox + cos(a0 + da) * d, cz = oz + sin(a0 + da) * d;
        let found: Building | null = null;
        for (let r = 0; r <= 4 && !found; r++) {
          w.forRadius(cx, cz, r, (_i, x, y) => {
            if (found) return;
            const an = g.anchorFor(o.type, x, y);
            if (g.placeError(o.type, o.owner, an.x, an.y, true) !== null) return;
            const door = g.doorOf(size, an.x, an.y);
            if (w.region[door] !== home) return;
            if (o.coastal && seaNear(g, an.x + size / 2, an.y + size / 2, 6) < 0) return;
            if (!g.path.find(hq.door, door, true, 12000)) return;
            found = g.addBuilding(o.type, o.owner, an.x, an.y, true);
          });
        }
        if (found) {
          const b: Building = found;
          garrison(g, b, o.garrison);
          g.ms?.forts.push(b.id);
          return b;
        }
      }
    }
  }
  throw new Error(`campaign: no room for a ${o.type} of player ${o.owner} at ${o.near.dist.join('-')} from the headquarters`);
}

const REBEL_SHIPS = ['Corvus', 'Aquila', 'Ursa', 'Draco', 'Lupa'];

/** The navigable water nearest a spot within `r`, -1 if none (any sea, or the one given). */
export function seaNear(g: Game, x: number, z: number, r = 30, sea = 0): number {
  const w = g.world;
  const close = nearestNavigable(g, x, z, sea);
  if (close >= 0) return close;
  let best = -1, bd = Infinity;
  w.forRadius(x, z, r, (i, _x, _y, d2) => {
    if (d2 >= bd || !w.navigable(i) || (sea && w.sea[i] !== sea)) return;
    bd = d2;
    best = i;
  });
  return best;
}

/** A rival's ship at sea near a spot: a trade ship waits there, a warship stands guard. */
export function ship(g: Game, o: { kind: ShipKind; owner: number; x: number; z: number; r?: number }): Ship {
  const w = g.world;
  const i = seaNear(g, o.x, o.z, o.r ?? 30);
  if (i < 0) throw new Error(`campaign: no sea near ${o.x.toFixed(0)},${o.z.toFixed(0)} for a ship`);
  const x = w.nx(i), z = w.ny(i);
  const sh: Ship = {
    id: g.id(), owner: o.owner, name: REBEL_SHIPS[g.ships.size % REBEL_SHIPS.length],
    x, z, heading: 0, speed: 0,
    route: null, routeS: 0, routeLen: 0, state: o.kind === 'war' ? 'guard' : 'idle', at: 0, from: 0, to: 0, timer: 0,
    cargo: emptyStock(), lots: [], passengers: [], expedition: 0, berth: 0, born: g.time, wait: 0,
    ...shipFields(o.kind),
  };
  if (o.kind === 'war') { sh.postX = x; sh.postZ = z; }
  g.ships.set(sh.id, sh);
  g.ms?.ships.push(sh.id);
  return sh;
}

/** The player's manned stronghold (not the headquarters) nearest a point, else the headquarters. */
function nearestTower(g: Game, x: number, z: number): Building {
  let best: Building | null = null, bd = Infinity;
  for (const b of g.buildings.values()) {
    if (b.owner !== g.local || !b.def.military || b.type === 'hq' || b.state !== 'done' || !b.occupied) continue;
    const d = sq(b.cx - x) + sq(b.cz - z);
    if (d < bd) { bd = d; best = b; }
  }
  return best ?? hqOf(g);
}

/** Free walkable land 28-36 from the target on the far side from the player's headquarters, from where raiders can reach it. */
function edgeSpot(g: Game, target: Building, dMin: number, dMax: number): number {
  const w = g.world, hq = hqOf(g);
  const region = w.region[target.door];
  const ax = target.cx - hq.cx, az = target.cz - hq.cz;
  const spots: { i: number; score: number }[] = [];
  w.forRadius(target.cx, target.cz, dMax, (i, x, y, d2) => {
    if (d2 < sq(dMin) || !w.walkable(i) || w.owner[i] >= 0 || w.region[i] !== region) return;
    if (x < 3 || y < 3 || x >= w.W - 3 || y >= w.H - 3) return;
    const dx = x - target.cx, dz = y - target.cz;
    // on the far side: away from the player's headquarters
    const dot = dx * ax + dz * az;
    spots.push({ i, score: dot + d2 * 0.1 });
  });
  spots.sort((a, b) => b.score - a.score);
  for (const s of spots.slice(0, 12)) if (g.path.find(s.i, target.door, true, 12000)) return s.i;
  return spots[0]?.i ?? hqOf(g, 1).door;
}

/** A band of a rival's soldiers appears and marches on the player. */
export function fireRaid(g: Game, r: Raid): Settler[] {
  const w = g.world;
  const rival = r.rival ?? 1;
  if (!g.players[rival]?.alive) return [];
  const rhq = hqOf(g, rival);
  const target = r.target === 'hq' ? hqOf(g) : nearestTower(g, rhq.cx, rhq.cz);
  const at = r.from === 'rival' ? rhq.door : edgeSpot(g, target, 28, 36);
  const men: Settler[] = [];
  const add = (job: Job, n: number) => {
    for (let k = 0; k < n; k++) {
      // each man on his own node near the spot
      let node = at;
      w.forRadius(w.nx(at), w.ny(at), 2.5, (i) => { if (node === at && i !== at && w.walkable(i) && !men.some((m) => m.node === i)) node = i; });
      const s = g.addSettler(rival, job, men.length ? node : at);
      g.syncPos(s);
      if (r.men.hp) s.hp = s.maxHp = r.men.hp;
      men.push(s);
    }
  };
  add('swordsman', r.men.sword);
  add('bowman', r.men.bow);
  orderAttack(g, rival, men.map((s) => s.id), target);
  g.emit({ type: 'raid', owner: rival, x: w.nx(at), z: w.ny(at), b: target.id });
  return men;
}

// ------------------------------------------------------------------ spots a goal can point at
/** The nearest grown tree to the headquarters beyond its yard. */
export function nearestTrees(g: Game): { x: number; z: number; r?: number } | null {
  const w = g.world, hq = hqOf(g);
  let best: number | null = null, bd = Infinity;
  for (const t of g.trees.values()) {
    if (t.growth < 0.8) continue;
    const d = sq(w.nx(t.node) - hq.cx) + sq(w.ny(t.node) - hq.cz);
    if (d < sq(7) || d >= bd) continue;
    bd = d;
    best = t.node;
  }
  return best === null ? null : { x: w.nx(best), z: w.ny(best), r: 3.5 };
}
/** The nearest rocks to the headquarters. */
export function nearestRock(g: Game): { x: number; z: number; r?: number } | null {
  const w = g.world, hq = hqOf(g);
  let best: number | null = null, bd = Infinity;
  for (const s of g.stones.values()) {
    const d = sq(w.nx(s.node) - hq.cx) + sq(w.ny(s.node) - hq.cz);
    if (d >= bd) continue;
    bd = d;
    best = s.node;
  }
  return best === null ? null : { x: w.nx(best), z: w.ny(best), r: 2.5 };
}
/** The nearest water with fish in it. */
export function nearestFish(g: Game): { x: number; z: number; r?: number } | null {
  const w = g.world, hq = hqOf(g);
  let best = -1, bd = Infinity;
  w.forRadius(hq.cx, hq.cz, 24, (i, x, y, d2) => {
    if (!w.fish[i] || d2 >= bd) return;
    bd = d2;
    best = i;
    void x; void y;
  });
  return best < 0 ? null : { x: w.nx(best), z: w.ny(best), r: 3 };
}
/** The middle of the mountain by the start. */
export function mountainCentre(g: Game): { x: number; z: number; r?: number } | null {
  const w = g.world, hq = hqOf(g);
  let sx = 0, sz = 0, n = 0;
  w.forRadius(hq.cx, hq.cz, 32, (i, x, y) => { if (w.isMountain(i)) { sx += x; sz += y; n++; } });
  return n ? { x: sx / n, z: sz / n, r: 6 } : null;
}
/** A point on the player's border on the way to a spot. */
export function borderToward(g: Game, to: { x: number; z: number } | null, dist = 13): { x: number; z: number; r?: number } | null {
  if (!to) return null;
  const hq = hqOf(g);
  const dx = to.x - hq.cx, dz = to.z - hq.cz, l = hypot(dx, dz) || 1;
  return { x: hq.cx + (dx / l) * dist, z: hq.cz + (dz / l) * dist, r: 3 };
}

// ------------------------------------------------------------------ predicates the missions share
export const has = (g: Game, t: BuildingType, n = 1) => g.countBuildings(g.local, t, false) >= n;
export const mine = (g: Game) => [...g.buildings.values()].filter((b) => b.owner === g.local && b.state !== 'burning');
export const me = (g: Game) => g.players[g.local];
export const stock = (g: Game) => g.totalStock(g.local);
export const pop = (g: Game) => g.population(g.local);
export const tally = (g: Game, k: string) => g.ms?.tally[k] ?? 0;
/** Rock the player owns that holds ore. */
export function ownedOre(g: Game) {
  const w = g.world;
  let n = 0;
  for (let i = 0; i < w.N; i++) if (w.owner[i] === g.local && w.ore[i]) n++;
  return n;
}
/** Ore of a kind the player has found (signs fade, the knowledge stays). */
export function knownOreNodes(g: Game, ore: number) {
  const w = g.world;
  let n = 0;
  for (let i = 0; i < w.N; i++) if (w.ore[i] === ore && w.known(i, g.local)) n++;
  return n;
}
export const knowsCoalAndIron = (g: Game) => knownOreNodes(g, ORE_COAL) > 0 && knownOreNodes(g, ORE_IRON) > 0;
