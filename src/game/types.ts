import type { BuildingDef, BuildingType, Good, Job } from './defs';

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

export type SoldierState = 'garrison' | 'idle' | 'moving' | 'attack' | 'defend' | 'fight' | 'return' | 'ship';

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
}

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
  status: string;
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
  seaWant: Record<Good, number> | null; // harbour: goods to gather here for shipping out
}

export interface Animal {
  id: number;
  kind: 'deer';
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
}

export type ShipState = 'idle' | 'toLoad' | 'loading' | 'toUnload' | 'unloading' | 'expedition' | 'scouting';

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
}

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
}

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

export interface Projectile {
  id: number;
  owner: number;
  sx: number; sy: number; sz: number;
  tx: number; ty: number; tz: number;
  t: number;
  dur: number;
  target: number; // settler id, or -animal id
  damage: number;
  kind: 'arrow';
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
}
