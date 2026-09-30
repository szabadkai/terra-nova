// The campaign framework: what a mission is, which buildings and tools it grants, the state the game
// keeps for it, and the helpers a mission's setup uses to raise a camp, plant a rebel fort or send a
// raid. Pure data and rules, no DOM; the missions themselves are in missions.ts. Everything here runs
// inside the game (the constructor and the step), so it is deterministic and travels in saves.
import { BUILDINGS, MINE_ORE, ORE_COAL, ORE_IRON, T_DIRT, T_FOREST, T_GRASS, T_MEADOW, TOOLS, emptyStock, type BuildingType, type Good, type Job } from './defs';
import type { Game } from './game';
import type { Building, GameEvent, Settler, Ship, ShipKind } from './types';
import type { Pt } from './mapgen';
import { SPELLS, castError, castSpell, type SpellId } from './faith';
import { launchAttack, turnCoat } from './military';
import { afloat, bombardSpot, orderShipAttack, orderShipBombard, orderShipMove, seaOf } from './naval';
import { atan2, cos, hypot, sin, sq } from '../core/fmath';
import { orderAttack } from './orders';
import { SHIP_NAMES, WARSHIP_NAMES, findDock, nearestNavigable } from './sea';
import { shipFields } from './naval';
import { MISSIONS } from './missions';
import { REGIONS, defenceMission } from './regions';

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
  /** one of the province's peoples: once the campaign has made peace with it (`Carry.peace`), its raids and fleets stay home */
  people?: People;
}

/** The province's peoples besides Varro, who can be won over for the rest of the campaign (Collis, Litus). */
export type People = 'tribes' | 'pirates';

export interface Raid {
  /** game seconds - after the start, or after the event named in `after` was first counted */
  t: number;
  /** a tally key ('captured', 'built:…'): the clock for `t` starts when it first happens */
  after?: string;
  /** the rival the raiders belong to, default 1 */
  rival?: number;
  /** edge: on free land 28-36 from the target on the far side from the player's headquarters; rival: at the rival's headquarters; a spot: there (a designed map's) */
  from: 'edge' | 'rival' | Pt;
  /** level: veterans (+25% a level, the gold helm) */
  men: { sword: number; bow: number; hp?: number; level?: number };
  /** nearest-tower: the player's manned stronghold (not the headquarters) nearest the rival, else the headquarters; or the scripted pick */
  target: 'nearest-tower' | 'hq' | ((g: Game) => Building | undefined);
}

/**
 * What a scripted fleet does, and keeps doing whenever it runs out of things to do: `shell` the
 * player's coast, then his ships; `hunt` his ships, then his coast; `prey` on his ships only, back to
 * where it appeared between kills (pirates, who want cargo, not ruins); `guard` where it is.
 */
export type FleetOrder = 'hunt' | 'shell' | 'prey' | 'guard';

/** Who speaks a scripted line: the quaestor (your side) or Varro (his letters). */
export type Speaker = 'quaestor' | 'varro';

/** One thing a trigger does. */
export type Action =
  /** a line on screen with its speaker's seal, and its recording (`<mission>.<trigger>`) */
  | { a: 'say'; who: Speaker; title: string; text?: string }
  /** a band appears and marches (Raid without its clock); `band` names it, so a goal can ask whether it is broken */
  | { a: 'raid'; band?: string; raid: Omit<Raid, 't' | 'after'> }
  /** a rival sends men from its own garrisons at one of the player's strongholds */
  | { a: 'attack'; rival?: number; men: number; target: (g: Game) => Building | undefined }
  /** more men into one of the mission's forts (ms.forts[k]), if it is still the rival's */
  | { a: 'reinforce'; fort: number; men: { sword: number; bow: number; level?: number } }
  /** a rival's mind changes: a builder turns to war, or a dormant camp's garrisons wake */
  | { a: 'mode'; rival?: number; mode: 'ai' | 'builder' }
  /** the fog lifts round a spot */
  | { a: 'reveal'; at: Pt; r: number }
  /** a rival's priests cast a spell there (its mana topped up to pay for it) */
  | { a: 'cast'; rival?: number; spell: SpellId; at: (g: Game) => { x: number; z: number } | null }
  /** warships of a rival's appear near a spot on the sea (their band named `band`, else the trigger's id) and keep at their `order` (default shell); `hp` hardens them, `name` christens the first */
  | { a: 'fleet'; rival?: number; n: number; near: Pt; band?: string; order?: FleetOrder; hp?: number; name?: string }
  /** strongholds go over to another side, manned by it (a rebellion; buildings on land that turns foreign then burn) */
  | { a: 'flip'; to: number; pick: (g: Game) => Building[]; men: { sword: number; bow: number; level?: number } }
  /** soldiers join the player at the headquarters (allies won over) */
  | { a: 'join'; men: { sword: number; bow: number; level?: number } }
  /** goods into a player's headquarters */
  | { a: 'goods'; owner?: number; goods: Partial<Record<Good, number>> }
  /** anything else, in code */
  | { a: 'do'; run: (g: Game) => void };

/**
 * A turn of events in a mission, fired once when every condition given holds (checked every two
 * seconds): game seconds `t` (from the start, or from the first time the tally key `after` was
 * counted), a tally reached, a predicate.
 */
export interface Trigger {
  id: string;
  when: { t?: number; after?: string; tally?: [string, number]; test?: (g: Game) => boolean };
  do: Action[];
  /** a rival's doing: at peace with its people, the trigger passes over (its bands and fleets counted as sent, and none left) */
  by?: number;
}

export interface MissionRules {
  /** rivals[p - 1] for players 1..n-1; missing entries play as in free play */
  rivals?: RivalRule[];
  /** computer rivals launch no attack and no bombardment before this game second */
  truce?: number;
  /** computer rivals never yield: they are fought to the last stronghold */
  noYield?: boolean;
  /** the mission's script: turns of events as the game goes (the director) */
  script?: Trigger[];
  /** a mission can be lost as well as won: why, once it is (checked every two seconds), or null */
  fail?: (g: Game) => string | null;
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
  /** `recipe`: a designed map (recipes.ts) instead of the seed's own; `size` must be the recipe's */
  map: { size: number; seed: number; players: number; aiLevel: number; islands?: boolean; recipe?: string };
  /** the line over the title in the briefing and the objectives (default "Mission IV", the tutorial's numeral) */
  kicker?: string;
  /** every building and tool granted from the start (the campaign's regions) */
  open?: boolean;
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
  /** the game time each of those was first counted */
  at: Record<string, number>;
  /** the soldiers the raids sent, by id (the living ones are the raids not yet broken) */
  raiders?: number[];
  /** the script's triggers that have fired, by id */
  fired?: string[];
  /** the men of each named band a trigger sent (raids, fleets' ships), by id */
  bands?: Record<string, number[]>;
  /** how many ships the script's fleets have launched (for their names) */
  fleetN?: number;
  /** the fleets that keep at their order: band name -> order and where it appeared (a guarding fleet is not listed) */
  fleets?: Record<string, { order: Exclude<FleetOrder, 'guard'>; at: Pt }>;
  /** why the mission was lost, once it is */
  lost?: string;
}

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
export function numeralOf(i: number) { return ROMAN[i] ?? String(i + 1); }

// ------------------------------------------------------------------ lookups
export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id) ?? REGIONS.find((m) => m.id === id) ?? (id.startsWith('defence.') ? defenceMission(id) : undefined);
}
/** The line over a mission's title: "Mission IV" in the tutorial, the region's own in the campaign. */
export function missionLabel(m: Mission): string {
  return m.kicker ?? `Mission ${numeralOf(missionIndex(m.id))}`;
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
  if (!set && m.open) allowedCache.set(m.id, set = new Set(Object.keys(BUILDINGS) as BuildingType[]));
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
  if (!set && m.open) toolCache.set(m.id, set = new Set<Tool>(['geologist', 'pioneer', 'spells', 'warships']));
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
export function hqOf(g: Game, owner = g.local): Building { return g.buildings.get(g.players[owner].hq)!; }

/** Called by the Game constructor once the standard start stands: the mission's state, its rules and its setup. */
export function beginMission(g: Game) {
  const m = g.mission;
  if (!m) return;
  const w = g.world;
  g.ms = { forts: [], ships: [], home: w.region[hqOf(g).door], raid: 0, truceOver: false, won: false, tally: {}, at: {} };
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
  if (g.opts.carry) applyCarry(g, g.opts.carry);
  hardenRivals(g);
}

/** The campaign's difficulty and Varro's fortifying, on a region's rivals: their minds a level up or down, more men in their forts. */
function hardenRivals(g: Game) {
  const d = g.opts.difficulty, f = g.opts.fortified ?? 0;
  if (d !== undefined) for (const a of g.ai) { const rule = rivalRule(g.mission, a.p); if (rule?.level !== undefined) a.level = Math.max(0, Math.min(2, rule.level + d - 1)); }
  if (!f) return;
  for (const id of g.ms?.forts ?? []) {
    const b = g.buildings.get(id);
    if (!b || !b.def.military) continue;
    const room = b.def.military.capacity - b.garrison.length;
    const sword = Math.min(room, f), bow = Math.min(room - sword, Math.floor(f / 2));
    if (sword + bow > 0) garrison(g, b, { sword, bow });
  }
}

/** How much bigger a region's raids are for the campaign's difficulty and Varro's fortifying (1 in the tutorial). */
export function raidScale(g: Game) {
  const d = g.opts.difficulty;
  return (d === undefined ? 1 : [0.7, 1, 1.35][d]) * (1 + 0.25 * (g.opts.fortified ?? 0));
}

// ------------------------------------------------------------------ the column: what marches on between regions
/** What marches on from a won region into the next (CAMPAIGN.md): plain data, carried in the next game's opts. */
export interface Carry {
  /** the best of the soldiers who came through, each a level higher for it (to 3) */
  veterans: { job: 'swordsman' | 'bowman'; level: number }[];
  /** the wagons: a capped share of what was in store */
  goods: Partial<Record<Good, number>>;
  /** ships that sail with it (the boons of the sea regions), waiting off the new coast if it has one */
  ships?: { trade?: number; war?: number };
  /** the peoples won over (Collis, Litus): their raids and fleets no longer come */
  peace?: People[];
}
/** How many soldiers march on: what the headquarters holds. */
export const COLUMN_MEN = 12;
export const TOP_LEVEL = 3;
/** The most of each good the wagons take. */
export const WAGONS: Partial<Record<Good, number>> = {
  board: 30, stone: 30, log: 20, coal: 12, iron: 12, gold: 12, sword: 12, bow: 12, bread: 10, fish: 10, meat: 10,
  ...Object.fromEntries(TOOLS.map((t) => [t, 4])),
};

/** The column a won game sends on: its soldiers alive, the best first, each raised a level; and the wagons. Reads the game only. */
export function columnOf(g: Game): Carry {
  const men = [...g.settlers.values()]
    .filter((s) => s.owner === g.local && !s.dead && (s.job === 'swordsman' || s.job === 'bowman'))
    .sort((a, b) => b.level - a.level || b.hp / b.maxHp - a.hp / a.maxHp || a.id - b.id)
    .slice(0, COLUMN_MEN);
  const have = g.totalStock(g.local);
  const goods: Partial<Record<Good, number>> = {};
  for (const [k, cap] of Object.entries(WAGONS)) { const n = Math.min(cap ?? 0, have[k as Good] ?? 0); if (n > 0) goods[k as Good] = n; }
  return { veterans: men.map((s) => ({ job: s.job as 'swordsman' | 'bowman', level: Math.min(TOP_LEVEL, s.level + 1) })), goods };
}

/** The column joins the start: veterans take the places of the headquarters' recruits (and fill it), the wagons unload. */
export function applyCarry(g: Game, c: Carry) {
  const hq = hqOf(g);
  const cap = hq.def.military!.capacity;
  for (const v of [...c.veterans].sort((a, b) => b.level - a.level)) {
    const rookie = hq.garrison.map((id) => g.settlers.get(id)!).find((s) => s && s.job === v.job && s.level === 0);
    if (rookie) { rookie.level = v.level; continue; }
    if (hq.garrison.length >= cap) continue;
    garrison(g, hq, { sword: v.job === 'swordsman' ? 1 : 0, bow: v.job === 'bowman' ? 1 : 0 });
    const s = g.settlers.get(hq.garrison[hq.garrison.length - 1]);
    if (s) s.level = v.level;
  }
  hq.desiredSoldiers = cap;
  for (const [k, n] of Object.entries(c.goods)) hq.stock[k as Good] += n ?? 0;
  // (an inland region has no sea for them: they wait for the next coast)
  for (const kind of ['trade', 'war'] as const) {
    for (let k = 0; k < (c.ships?.[kind] ?? 0); k++) {
      try { ship(g, { kind, owner: g.local, x: hq.cx, z: hq.cz, r: 26, own: true }); } catch { break; }
    }
  }
}

/** Every event of the local player's doing goes on the tally the goals read. */
export function tallyEvent(g: Game, e: GameEvent) {
  const ms = g.ms;
  if (!ms) return;
  const bump = (k: string) => { if (!ms.tally[k]) ms.at[k] = g.time; ms.tally[k] = (ms.tally[k] ?? 0) + 1; };
  // a ship going down is counted by the ship, whoever sank it; a raid is the rival's doing but the player's concern
  if (e.type === 'sinking' && e.s) { bump(`sinking:${e.s}`); bump(`sunk:${e.owner}`); }
  if (e.type === 'raid') bump('raid');
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
  if (rules?.raids) {
    // in order; one that waits on an event holds the ones behind it
    while (ms.raid < rules.raids.length) {
      const r = rules.raids[ms.raid];
      const since = r.after ? ms.at[r.after] : 0;
      if (since === undefined || g.time < since + r.t) break;
      ms.raid++;
      ms.raiders = [...(ms.raiders ?? []), ...fireRaid(g, r).map((s) => s.id)];
    }
  }
  for (const tr of rules?.script ?? []) {
    if (ms.fired?.includes(tr.id) || !triggerDue(g, tr)) continue;
    (ms.fired ??= []).push(tr.id);
    if (tr.by !== undefined && atPeace(g, tr.by)) {
      for (const act of tr.do) if (act.a === 'fleet' || (act.a === 'raid' && act.band)) { const name = act.a === 'fleet' ? act.band ?? tr.id : act.band!; (ms.bands ??= {})[name] ??= []; }
      continue;
    }
    // (a spell its priests cannot cast yet - no priest in the temple - waits for the next check)
    for (const act of tr.do) if (runAction(g, m, tr, act) === false) { ms.fired = ms.fired!.filter((id) => id !== tr.id); break; }
  }
  if (ms.fleets) fleetStep(g);
  if (rules?.truce && !ms.truceOver && g.time >= rules.truce) {
    ms.truceOver = true;
    g.emit({ type: 'truceover', owner: g.local });
    g.message(g.local, 'The truce is over: the enemy may march at any time', undefined, undefined, 'bad');
  }
  if (!ms.won && !ms.lost && rules?.fail) {
    const why = rules.fail(g);
    if (why) { ms.lost = why; g.emit({ type: 'missionlost', owner: g.local, text: why }); }
  }
  if (!ms.won && !ms.lost && m.goals.every((goal) => goal.optional || goal.done(g))) {
    ms.won = true;
    g.emit({ type: 'missionwon', owner: g.local });
  }
}

function triggerDue(g: Game, tr: Trigger): boolean {
  const ms = g.ms!, w = tr.when;
  if (w.after !== undefined && ms.at[w.after] === undefined) return false;
  if (w.t !== undefined && g.time < (w.after !== undefined ? ms.at[w.after] : 0) + w.t) return false;
  if (w.tally && (ms.tally[w.tally[0]] ?? 0) < w.tally[1]) return false;
  if (w.test && !w.test(g)) return false;
  return true;
}

/** Does what a trigger says; false when it cannot be done yet (the trigger is then tried again). */
function runAction(g: Game, m: Mission, tr: Trigger, act: Action): boolean | void {
  const ms = g.ms!;
  const band = (name: string | undefined, ids: number[]) => { if (name) (ms.bands ??= {})[name] = [...(ms.bands?.[name] ?? []), ...ids]; };
  switch (act.a) {
    case 'say':
      g.emit({ type: 'say', owner: g.local, kind: act.who, text: act.title, detail: act.text, voice: `${m.id}.${tr.id}` });
      break;
    case 'raid':
      band(act.band, fireRaid(g, { ...act.raid, t: 0 }).map((s) => s.id));
      break;
    case 'attack': {
      const t = act.target(g);
      if (t) launchAttack(g, act.rival ?? 1, t, act.men);
      break;
    }
    case 'reinforce': {
      const b = g.buildings.get(ms.forts[act.fort] ?? 0);
      if (b && b.owner !== g.local && b.state === 'done') {
        const before = b.garrison.length, room = b.def.military!.capacity - before;
        const sword = Math.min(room, act.men.sword), bow = Math.min(room - sword, act.men.bow);
        if (sword + bow <= 0) break;
        garrison(g, b, { sword, bow });
        if (act.men.level) for (const id of b.garrison.slice(before)) { const s = g.settlers.get(id); if (s) s.level = act.men.level; }
      }
      break;
    }
    case 'mode':
      for (const a of g.ai) if (a.p === (act.rival ?? 1)) a.mode = act.mode;
      break;
    case 'reveal':
      revealAround(g, act.at[0], act.at[1], act.r);
      break;
    case 'cast': {
      const at = act.at(g), who = act.rival ?? 1;
      if (!at) break;
      const p = g.players[who];
      if (!p?.alive) break;
      const mana = p.mana, cd = p.spellCd;
      if (p.mana < SPELLS[act.spell].cost) p.mana = SPELLS[act.spell].cost;
      p.spellCd = 0;
      if (castError(g, who, act.spell, at.x, at.z) !== null) { p.mana = mana; p.spellCd = cd; return false; }
      castSpell(g, who, act.spell, at.x, at.z);
      break;
    }
    case 'fleet': {
      const who = act.rival ?? 1, ids: number[] = [], name = act.band ?? tr.id, order = act.order ?? 'shell';
      if (!g.players[who]?.alive) break;
      const k = raidScale(g), n = k === 1 ? act.n : Math.max(1, Math.round(act.n * k));
      for (let j = 0; j < n; j++) {
        try {
          const sh = ship(g, { kind: 'war', owner: who, x: act.near[0] + j * 2.5, z: act.near[1], r: 12, name: j === 0 && act.name ? act.name : FLEET_SHIPS[(ms.fleetN = (ms.fleetN ?? 0) + 1) % FLEET_SHIPS.length] });
          if (act.hp) sh.hp = sh.maxHp = act.hp;
          ids.push(sh.id);
        } catch { break; }
      }
      band(name, ids);
      if (order !== 'guard' && ids.length) {
        const sh = g.ships.get(ids[0])!;
        (ms.fleets ??= {})[name] = { order, at: [sh.x, sh.z] };
        fleetOrders(g, name);
      }
      if (ids.length) {
        const sh = g.ships.get(ids[0])!;
        g.emit({ type: 'fleet', owner: who, x: sh.x, z: sh.z, s: sh.id, n: ids.length, kind: order });
      }
      break;
    }
    case 'flip':
      for (const b of act.pick(g)) turnCoat(g, b, act.to, act.men);
      break;
    case 'join': {
      const hq = hqOf(g), before = hq.garrison.length;
      garrison(g, hq, act.men);
      if (act.men.level) for (const id of hq.garrison.slice(before)) { const s = g.settlers.get(id); if (s) s.level = act.men.level; }
      hq.desiredSoldiers = hq.def.military!.capacity;
      break;
    }
    case 'goods': {
      const st = hqOf(g, act.owner ?? g.local).stock;
      for (const [k, v] of Object.entries(act.goods)) st[k as Good] += v ?? 0;
      break;
    }
    case 'do':
      act.run(g);
      break;
  }
}

/** The player's stronghold on the coast nearest a ship that its stones can reach, for a fleet to bombard. */
function coastalStronghold(g: Game, from: Ship): Building | undefined {
  let best: Building | undefined, bd = Infinity;
  for (const b of g.buildings.values()) {
    if (b.owner !== g.local || !b.def.military || b.state !== 'done') continue;
    const d = sq(b.cx - from.x) + sq(b.cz - from.z);
    if (d >= bd || !bombardSpot(g, from, b)) continue;
    bd = d;
    best = b;
  }
  return best;
}
/** A player's ship afloat nearest a spot (on one sea, if given), for a hunting fleet. */
export function nearestShipOf(g: Game, owner: number, x: number, z: number, sea = 0): Ship | undefined {
  let best: Ship | undefined, bd = Infinity;
  for (const sh of g.ships.values()) {
    if (sh.owner !== owner || !afloat(sh) || (sea && seaOf(g, sh) !== sea)) continue;
    const d = sq(sh.x - x) + sq(sh.z - z);
    if (d < bd) { bd = d; best = sh; }
  }
  return best;
}

/** A fleet's ships that stand idle (on guard with nothing in sight) take up its order again: the player's ships, or his coast. */
function fleetOrders(g: Game, name: string) {
  const f = g.ms?.fleets?.[name];
  if (!f) return;
  for (const id of g.ms!.bands?.[name] ?? []) {
    const sh = g.ships.get(id);
    if (!sh || !afloat(sh) || sh.state !== 'guard' || sh.target) continue;
    const prey = () => { const t = nearestShipOf(g, g.local, sh.x, sh.z, seaOf(g, sh)); return !!t && orderShipAttack(g, sh.owner, [sh.id], t) > 0; };
    const coast = () => { const b = coastalStronghold(g, sh); return !!b && orderShipBombard(g, sh.owner, [sh.id], b) > 0; };
    if (f.order === 'hunt') { if (!prey()) coast(); }
    else if (f.order === 'shell') { if (!coast()) prey(); }
    else if (!prey() && !sh.route && hypot(sh.x - f.at[0], sh.z - f.at[1]) > 4) orderShipMove(g, sh.owner, [sh.id], f.at[0], f.at[1]);
  }
}

/** Once a step: every fleet that keeps at its order; a fleet with no ship afloat is struck off. */
function fleetStep(g: Game) {
  const ms = g.ms!;
  for (const name of Object.keys(ms.fleets ?? {})) {
    if (fleetLeft(g, name).afloat === 0) { delete ms.fleets![name]; continue; }
    fleetOrders(g, name);
  }
}
/** The ships of a named band still afloat (and whether it has sailed at all). */
export function fleetLeft(g: Game, name: string): { sent: boolean; afloat: number } {
  const ids = g.ms?.bands?.[name];
  if (!ids) return { sent: false, afloat: 0 };
  return { sent: true, afloat: ids.filter((id) => { const sh = g.ships.get(id); return !!sh && sh.hp > 0 && sh.state !== 'sinking'; }).length };
}

/** The men of a named band still alive (and whether it has marched at all). */
export function bandLeft(g: Game, name: string): { sent: boolean; alive: number } {
  const ids = g.ms?.bands?.[name];
  if (!ids) return { sent: false, alive: 0 };
  return { sent: true, alive: ids.filter((id) => { const s = g.settlers.get(id); return !!s && !s.dead; }).length };
}

/** Whether the campaign has made peace with a rival's people (it holds their region): their raids and fleets stay home. */
export function atPeace(g: Game, rival: number): boolean {
  const people = rivalRule(g.mission, rival)?.people;
  return !!people && !!g.opts.carry?.peace?.includes(people);
}

/** Whether a computer rival is truced: no attack, no bombardment yet. */
export function truced(g: Game) {
  const t = g.mission?.rules?.truce;
  return !!t && g.time < t;
}

export function allRivalsDefeated(g: Game) { return g.players.every((p) => p.id === g.local || !p.alive); }
/** Every raid has marched and not one of its men is left alive (in the field or in a tower he took). */
export function raidsBroken(g: Game) {
  const n = g.mission?.rules?.raids?.length ?? 0;
  return !!g.ms && g.ms.raid >= n && (g.ms.raiders ?? []).every((id) => { const s = g.settlers.get(id); return !s || s.dead; });
}
/** Raiders of this mission still alive. */
export function raidersLeft(g: Game) {
  return (g.ms?.raiders ?? []).filter((id) => { const s = g.settlers.get(id); return !!s && !s.dead; }).length;
}

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

/** A rival's manned stronghold on free land at a designed spot (a campaign region's fort), within rMax of it. */
export function fortAt(g: Game, type: FortOpts['type'], owner: number, x: number, z: number, rMax: number, men: FortOpts['garrison']): Building {
  const a = placeNear(g, owner, type, x, z, rMax, true);
  if (!a) throw new Error(`campaign: no room for a ${type} of player ${owner} near ${x},${z}`);
  const b = g.addBuilding(type, owner, a.x, a.y, true);
  garrison(g, b, men);
  g.ms?.forts.push(b.id);
  return b;
}

const REBEL_SHIPS = ['Corvus', 'Aquila', 'Ursa', 'Draco', 'Lupa'];
/** A scripted fleet's ships, unless the script names one (the Corvus and the Aquila are the story's own). */
const FLEET_SHIPS = ['Murena', 'Scylla', 'Vipera', 'Tigris', 'Harpyia', 'Nox', 'Praedo', 'Hydra', 'Lamia', 'Charybdis', 'Mustela', 'Scorpio'];

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

/**
 * A ship at sea near a spot: a trade ship waits there, a warship stands guard. A rival's goes on the
 * mission's list (`ms.ships`) under a rebel's name; the player's own (`own`, the column's) under one
 * of his yard's.
 */
export function ship(g: Game, o: { kind: ShipKind; owner: number; x: number; z: number; r?: number; name?: string; own?: boolean }): Ship {
  const w = g.world;
  const i = seaNear(g, o.x, o.z, o.r ?? 30);
  if (i < 0) throw new Error(`campaign: no sea near ${o.x.toFixed(0)},${o.z.toFixed(0)} for a ship`);
  const x = w.nx(i), z = w.ny(i);
  const names = o.kind === 'war' ? WARSHIP_NAMES : SHIP_NAMES;
  const sh: Ship = {
    id: g.id(), owner: o.owner, name: o.name ?? (o.own ? names[(g.ships.size * 7 + 3) % names.length] : REBEL_SHIPS[g.ships.size % REBEL_SHIPS.length]),
    x, z, heading: 0, speed: 0,
    route: null, routeS: 0, routeLen: 0, state: o.kind === 'war' ? 'guard' : 'idle', at: 0, from: 0, to: 0, timer: 0,
    cargo: emptyStock(), lots: [], passengers: [], expedition: 0, berth: 0, born: g.time, wait: 0,
    ...shipFields(o.kind),
  };
  if (o.kind === 'war') { sh.postX = x; sh.postZ = z; }
  g.ships.set(sh.id, sh);
  if (!o.own) g.ms?.ships.push(sh.id);
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

/** A walkable node near a spot (a designed map's). */
function spotNear(g: Game, x: number, z: number): number {
  const w = g.world;
  let best = -1, bd = Infinity;
  w.forRadius(x, z, 8, (i, _x, _y, d2) => { if (d2 < bd && w.walkable(i)) { bd = d2; best = i; } });
  return best >= 0 ? best : hqOf(g, 1).door;
}

/** A band of a rival's soldiers appears and marches on the player. */
export function fireRaid(g: Game, r: Raid): Settler[] {
  const w = g.world;
  const rival = r.rival ?? 1;
  if (!g.players[rival]?.alive || atPeace(g, rival)) return [];
  const rhq = hqOf(g, rival);
  const target = typeof r.target === 'function' ? r.target(g) ?? nearestTower(g, rhq.cx, rhq.cz) : r.target === 'hq' ? hqOf(g) : nearestTower(g, rhq.cx, rhq.cz);
  const at = Array.isArray(r.from) ? spotNear(g, r.from[0], r.from[1]) : r.from === 'rival' ? rhq.door : edgeSpot(g, target, 28, 36);
  const men: Settler[] = [];
  const add = (job: Job, n: number) => {
    for (let k = 0; k < n; k++) {
      // each man on his own node near the spot
      let node = at;
      w.forRadius(w.nx(at), w.ny(at), 2.5, (i) => { if (node === at && i !== at && w.walkable(i) && !men.some((m) => m.node === i)) node = i; });
      const s = g.addSettler(rival, job, men.length ? node : at);
      g.syncPos(s);
      if (r.men.hp) s.hp = s.maxHp = r.men.hp;
      if (r.men.level) s.level = r.men.level;
      men.push(s);
    }
  };
  const k = raidScale(g);
  add('swordsman', k === 1 ? r.men.sword : Math.max(1, Math.round(r.men.sword * k)));
  add('bowman', k === 1 ? r.men.bow : Math.round(r.men.bow * k));
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
/** The middle of the mountain by the start: the rock nearest the headquarters and what lies around it (not every crag within sight). */
export function mountainCentre(g: Game): { x: number; z: number; r?: number } | null {
  const w = g.world, hq = hqOf(g);
  let n0 = -1, bd = Infinity;
  w.forRadius(hq.cx, hq.cz, 34, (i, _x, _y, d2) => { if (d2 >= sq(8) && d2 < bd && w.isMountain(i)) { bd = d2; n0 = i; } });
  if (n0 < 0) return null;
  let sx = 0, sz = 0, n = 0;
  w.forRadius(w.nx(n0), w.ny(n0), 9, (i, x, y) => { if (w.isMountain(i)) { sx += x; sz += y; n++; } });
  return { x: sx / n, z: sz / n, r: 6 };
}
/** A point on the player's border on the way to a spot. */
export function borderToward(g: Game, to: { x: number; z: number } | null, dist = 13): { x: number; z: number; r?: number } | null {
  if (!to) return null;
  const hq = hqOf(g);
  const dx = to.x - hq.cx, dz = to.z - hq.cz, l = hypot(dx, dz) || 1;
  return { x: hq.cx + (dx / l) * dist, z: hq.cz + (dz / l) * dist, r: 3 };
}

/** The nearest water to the headquarters (a waterworks wants it within its reach). */
export function nearestWater(g: Game): { x: number; z: number; r?: number } | null {
  const w = g.world, hq = hqOf(g);
  let best = -1, bd = Infinity;
  w.forRadius(hq.cx, hq.cz, 24, (i, _x, _y, d2) => { if (w.isWater(i) && d2 < bd) { bd = d2; best = i; } });
  return best < 0 ? null : { x: w.nx(best), z: w.ny(best), r: 3 };
}

/** Soldiers moved from one stronghold's garrison into another's (the headquarters' reserve manning a tower). */
export function moveGarrison(g: Game, from: Building, to: Building, n: number) {
  for (let k = 0; k < n; k++) {
    const id = from.garrison.pop();
    if (id === undefined) break;
    const s = g.settlers.get(id)!;
    s.inside = to.id;
    s.home = to.id;
    to.garrison.push(id);
  }
  to.occupied = to.garrison.length > 0;
  to.desiredSoldiers = Math.max(1, to.garrison.length);
  g.territoryDirty = true;
}

/** More carriers at the headquarters' door. */
export function addCarriers(g: Game, n: number, owner = g.local) {
  const hq = hqOf(g, owner);
  for (let k = 0; k < n; k++) g.syncPos(g.addSettler(owner, 'carrier', hq.door));
}

/** The richest placeable site for a mine on the player's own mountain (around `near`, else the headquarters), with the ore it would reach; null if none. */
export function bestMineSite(g: Game, type: 'coalmine' | 'ironmine' | 'goldmine' | 'stonemine', owner = g.local, r = 34, near?: { x: number; z: number }): { x: number; y: number; ore: number } | null {
  const w = g.world, hq = hqOf(g, owner), def = BUILDINGS[type];
  const kind = MINE_ORE[def.mine!];
  const reach = (def.radius ?? 3) + 0.5;
  let best: { x: number; y: number; ore: number } | null = null;
  w.forRadius(near?.x ?? hq.cx, near?.z ?? hq.cz, r, (i, x, y) => {
    if (w.owner[i] !== owner || !w.isMountain(i)) return;
    const a = g.anchorFor(type, x, y);
    if (g.placeError(type, owner, a.x, a.y) !== null) return;
    const cx = a.x + (def.size - 1) / 2, cz = a.y + (def.size - 1) / 2;
    let ore = 0;
    w.forRadius(cx, cz, reach, (j) => { if (w.ore[j] === kind) ore += w.oreAmt[j]; });
    if (!best || ore > best.ore) best = { x: a.x, y: a.y, ore };
  });
  return best;
}

/** How many nodes around a farm's centre a farmer could sow: the player's own grass, meadow, forest floor or dirt with nothing on it. */
export function plantableNear(g: Game, x: number, z: number, r: number, owner = g.local) {
  const w = g.world;
  let n = 0;
  w.forRadius(x, z, r, (i) => {
    if (w.owner[i] !== owner || w.isWater(i) || w.building[i] || w.tree[i] || w.stone[i] || w.blocked[i] || w.reserve[i] || w.field[i]) return;
    const t = w.terrain[i];
    if (t === T_GRASS || t === T_MEADOW || t === T_DIRT || t === T_FOREST) n++;
  });
  return n;
}

/** A stronghold changes hands without a fight (the headless check's shortcut for a capture). */
export function handOver(g: Game, b: Building, owner: number) {
  for (const id of b.garrison) { const s = g.settlers.get(id); if (s) g.removeSettler(s); }
  b.garrison = [];
  b.owner = owner;
  garrison(g, b, { sword: 1, bow: 0 });
  g.emit({ type: 'captured', b: b.id, owner, x: b.cx, z: b.cz });
}

/** The island nearest the headquarters. */
export function nearestIsle(g: Game): { x: number; y: number; r: number } | null {
  const hq = hqOf(g);
  let best: { x: number; y: number; r: number } | null = null, bd = Infinity;
  for (const isle of g.isles) { const d = sq(isle.x - hq.cx) + sq(isle.y - hq.cz); if (d < bd) { bd = d; best = isle; } }
  return best;
}

/** A harbour site on an island's coast that ships from the player's own coast can reach: anchor and landing, or null. */
export function colonySpot(g: Game, isle = nearestIsle(g)): { x: number; y: number; dock: number } | null {
  if (!isle) return null;
  const w = g.world, home = g.ms?.home ?? w.region[hqOf(g).door];
  const shore = seaNear(g, hqOf(g).cx, hqOf(g).cz, 24);
  const sea = shore >= 0 ? w.sea[shore] : 0;
  const size = BUILDINGS.harbour.size;
  let best: { x: number; y: number; dock: number } | null = null, bd = Infinity;
  for (let t = 0; t < 24; t++) {
    const px = isle.x + cos((t / 24) * Math.PI * 2) * (isle.r + 1), pz = isle.y + sin((t / 24) * Math.PI * 2) * (isle.r + 1);
    w.forRadius(px, pz, 5, (_i, x, y, d2) => {
      if (d2 >= bd) return;
      const a = g.anchorFor('harbour', x, y);
      if (g.placeError('harbour', g.local, a.x, a.y, true) !== null) return;
      if (w.region[g.doorOf(size, a.x, a.y)] === home) return;
      const dock = findDock(g, size, a.x, a.y);
      if (dock < 0 || (sea && w.sea[dock] !== sea)) return;
      bd = d2;
      best = { x: a.x, y: a.y, dock };
    });
  }
  return best;
}

// ------------------------------------------------------------------ predicates the missions share
// (function declarations, not consts: missions.ts names these in its data while this module is still loading)
export function has(g: Game, t: BuildingType, n = 1) { return g.countBuildings(g.local, t, false) >= n; }
export function mine(g: Game) { return [...g.buildings.values()].filter((b) => b.owner === g.local && b.state !== 'burning'); }
export function me(g: Game) { return g.players[g.local]; }
export function stock(g: Game) { return g.totalStock(g.local); }
export function pop(g: Game) { return g.population(g.local); }
export function tally(g: Game, k: string) { return g.ms?.tally[k] ?? 0; }
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
export function knowsCoalAndIron(g: Game) { return knownOreNodes(g, ORE_COAL) > 0 && knownOreNodes(g, ORE_IRON) > 0; }
