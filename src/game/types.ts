import type { BuildingDef, BuildingType, Good, Job } from './defs';
import type { Stall } from './status';

export type TreeState = 'grow' | 'mature' | 'falling' | 'fallen';

export interface Tree {
  id: number;
  node: number;
  species: number; // 0 oak, 1 pine, 2 birch, 3 palm, 4 fruit tree
  growth: number; // 0..1
  state: TreeState;
  timer: number;
  reserved: boolean;
  fallDir: number;
  rot: number;
  scale: number;
}

export interface Stone {
  id: number;
  node: number;
  amount: number;
  max: number;
  reserved: number;
  variant: number;
  rot: number;
}

export interface Field {
  id: number;
  node: number;
  owner: number;
  farm: number;
  kind: 'grain' | 'vine';
  growth: number;
  reserved: boolean;
}

export type Anim =
  | 'idle' | 'walk' | 'chop' | 'hammer' | 'dig' | 'pick' | 'plant' | 'fish' | 'shoot'
  | 'harvest' | 'fight' | 'die' | 'cheer' | 'fill';

export type Action =
  | { k: 'walk'; to: number; adj: boolean; started?: boolean; tries?: number }
  | { k: 'anim'; anim: Anim; dur: number; face?: number; t?: number; tick?: (t: number) => void }
  | { k: 'do'; fn: () => boolean | void }
  | { k: 'wait'; dur: number; t?: number };

export type SoldierState = 'garrison' | 'idle' | 'moving' | 'attack' | 'defend' | 'fight' | 'return' | 'ship' | 'hold';

export interface Settler {
  id: number;
  owner: number;
  job: Job;
  // position/movement
  node: number;
  next: number;
  t: number;
  stepDur: number;
  path: number[] | null;
  pathI: number;
  x: number; // world (smoothed render) position
  z: number;
  heading: number;
  hidden: boolean;
  inside: number; // building id the settler is inside, 0 if outside
  // visuals
  anim: Anim;
  animT: number;
  carrying: Good | null;
  // behaviour
  actions: Action[];
  onAbort: (() => void) | null;
  idle: boolean;
  home: number; // workplace building id
  task: string; // debug / status
  // soldiers
  hp: number;
  maxHp: number;
  level: number;
  sstate: SoldierState;
  target: number; // settler or building id depending on state
  targetB: number; // building target for attack
  engaged: number; // settler id fighting with
  cooldown: number;
  scanT: number;
  dead: boolean;
  deadT: number;
  wanderT: number;
  seed: number;
  blessUntil: number; // game time until which a Healing Light blessing lasts
  // seafaring
  voyage: number; // destination harbour id (or -expedition id) while travelling by sea, 0 otherwise
  voyageFrom: number; // harbour the settler waits at for a ship
  aboard: number; // ship id while on board, 0 otherwise
  // standing orders (pioneers)
  order: number; // node the settler was sent to work around, -1 none
  fails: number; // consecutive failed attempts at the current order
  // donkeys carry a second good beside `carrying`; `target` holds the market they are bound for
  pack: Good | null;
  // drill (soldiers and catapults): the formation the man forms up in, whether he stands firm
  // instead of charging foes that come near his post, the way he faces there, and how much slower
  // than his own pace he marches so that his group arrives together
  drill: Formation;
  firm: boolean;
  face: number | null;
  pace: number;
}

/** How a group of soldiers forms up: a wide line, a square block, a wedge or a ring facing out. */
export type Formation = 'line' | 'block' | 'wedge' | 'ring';

export type BState = 'leveling' | 'building' | 'done' | 'burning';

export interface Building {
  id: number;
  type: BuildingType;
  def: BuildingDef;
  owner: number;
  x: number; // anchor node (top-left)
  y: number;
  size: number;
  door: number;
  cx: number; // world center
  cz: number;
  state: BState;
  created: number;
  targetH: number;
  levelWork: number;
  levelTotal: number;
  buildWork: number; // units done
  buildTotal: number;
  delivered: { board: number; stone: number };
  used: number;
  diggers: number[];
  builders: number[];
  stock: Record<Good, number>;
  incoming: Record<Good, number>;
  outgoing: Record<Good, number>;
  worker: number;
  workerIncoming: number;
  working: boolean;
  workT: number;
  paused: boolean;
  /** what it is doing, for the panel */
  status: string;
  /** why it has stopped, while it is stuck (see status.ts), and since when (game time) */
  stall: Stall | null;
  stallT: number;
  // military
  garrison: number[];
  soldiersIncoming: number;
  desiredSoldiers: number;
  occupied: boolean;
  // residence
  spawned: number;
  spawnT: number;
  // misc
  burnT: number;
  shootT: number;
  prodCount: number;
  lastProd: number;
  toolChoice: Good | 'auto';
  weaponRatio: number; // fraction of swords for weaponsmith, barracks
  underAttackT: number;
  // seafaring
  dock: number; // navigable water node where ships moor (harbours, shipyards), -1 otherwise
  colony: boolean; // an expedition's harbour site: claims land around itself until manned
  shipProgress: number; // shipyard: 0..1 of the hull on the slipway
  seaWant: Record<Good, number> | null; // harbour or market: goods to gather here for ships or donkeys to carry away
  // overland trade
  tradeTo: number; // market: the market its donkeys deliver to (chosen by the player), 0 none
  /** The player's one prioritised building: its needs come first and construction crews go there before anywhere else. */
  priority: boolean;
  /** stronghold: catapult stones taken while empty (heals slowly in peace); the walls fall at `def.military.siege` */
  damage: number;
  /** shipyard: what goes on the slipway next */
  shipKind: ShipKind;
  /** harbour: ships keep this landmass supplied from, and bring what it lacks from, the other harbours by themselves */
  seaAuto: boolean;
}

export interface Animal {
  id: number;
  kind: 'deer' | 'hare';
  node: number;
  next: number;
  t: number;
  stepDur: number;
  path: number[] | null;
  pathI: number;
  x: number;
  z: number;
  heading: number;
  reserved: boolean;
  alive: boolean;
  deadT: number;
  wanderT: number;
  herd: number;
  /** where it lives: it keeps within a few steps of here (see wildlife.ts) */
  home: number;
  /** game time it slipped away into its burrow, gone for good a moment later; 0 while it stays */
  leave: number;
}

export type ShipState =
  | 'idle' | 'toLoad' | 'loading' | 'toUnload' | 'unloading' | 'expedition' | 'scouting'
  // warships: stand guard at `post`, chase ship `target`, shell stronghold `target`; any ship can sink
  | 'guard' | 'hunt' | 'bombard' | 'sinking';
export type ShipKind = 'trade' | 'war';

export interface Ship {
  id: number;
  owner: number;
  name: string;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Polyline being sailed (world x/z pairs) and distance travelled along it. */
  route: number[] | null;
  routeS: number;
  routeLen: number;
  state: ShipState;
  at: number; // harbour/shipyard id the ship is moored at, 0 at sea
  from: number; // harbour to load at
  to: number; // harbour to unload at
  timer: number;
  cargo: Record<Good, number>;
  /** Cargo per sea order id so deliveries can be credited. */
  lots: { order: number; good: Good; n: number }[];
  passengers: number[];
  expedition: number;
  berth: number; // slot offset when several ships share a dock
  born: number;
  wait: number; // loading: steps without anything to take on board
  // naval combat
  kind: ShipKind;
  hp: number;
  maxHp: number;
  /** warship: the ship it hunts or the stronghold it shells (by state) */
  target: number;
  /** warship: where it stands guard (-1 none) */
  postX: number;
  postZ: number;
  /** seconds until the deck catapult is wound again */
  reload: number;
  /** game time of the last shot, and its bearing (world angle), for the catapult's swing */
  fired: number;
  aim: number;
  /** game time it last took damage (it mends once the fighting has stopped) */
  hitT: number;
  /** seconds since it started going down */
  sinkT: number;
  /** warship: seconds until it looks around again / may plot a new course */
  scanT: number;
  routeT: number;
}

/** A lot of goods to move from one harbour to another by ship, or between two markets by donkey. */
export interface SeaOrder {
  id: number;
  owner: number;
  from: number; // source harbour
  to: number; // destination harbour
  good: Good;
  n: number;
  loaded: number; // in transit
  delivered: number;
  t: number; // last progress
  /** placed by the player in the harbour panel: the sea planner never trims or forgets it */
  manual?: boolean;
}
export type TradeOrder = SeaOrder;

export interface Expedition {
  id: number;
  owner: number;
  from: number; // harbour it sets out from
  x: number; // anchor of the colony harbour
  y: number;
  landing: number; // water node the ship sails to
  shore: number; // land node where the party goes ashore
  state: 'gathering' | 'sailing' | 'landed' | 'failed';
  ship: number;
  goods: { board: number; stone: number };
  people: { builder: number; digger: number; soldier: number; carrier: number };
  t: number;
}

/** A geologist's marker: what he found beneath one spot of a mountain. */
export interface Sign {
  id: number;
  node: number;
  owner: number;
  ore: number; // 0 nothing, else ORE_*
  amt: number; // richness at the spot
  t: number; // game time placed
}

export interface Projectile {
  id: number;
  owner: number;
  sx: number; sy: number; sz: number;
  tx: number; ty: number; tz: number;
  t: number;
  dur: number;
  target: number; // settler id, or -animal id; 0 for a stone
  damage: number; // a stone: 1 when it will land on the building, 0 when it falls short or wide
  kind: 'arrow' | 'stone';
  building?: number; // the stronghold a catapult stone is aimed at
  ship?: number; // the ship an arrow or stone is aimed at
  by?: number; // the warship that loosed a stone
}

export interface GameEvent {
  type: string;
  x?: number;
  z?: number;
  b?: number;
  s?: number;
  owner?: number;
  text?: string;
  good?: Good;
  kind?: string;
  /** the answer to a player's command (commands.ts): its sequence number and how it went */
  seq?: number;
  ok?: boolean;
  n?: number;
  ids?: number[];
}
