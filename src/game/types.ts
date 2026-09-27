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

export type SoldierState = 'garrison' | 'idle' | 'moving' | 'attack' | 'defend' | 'fight' | 'return';

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
