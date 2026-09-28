// Static game definitions: goods, jobs, buildings.

export const GOODS = [
  'log', 'board', 'stone', 'grain', 'flour', 'bread', 'fish', 'meat', 'pig', 'water',
  'coal', 'ironore', 'goldore', 'iron', 'gold',
  'sword', 'bow', 'wine',
  'axe', 'pickaxe', 'saw', 'hammer', 'shovel', 'scythe', 'rod',
] as const;
export type Good = (typeof GOODS)[number];

export const GOOD_NAMES: Record<Good, string> = {
  log: 'Logs', board: 'Boards', stone: 'Stone', grain: 'Grain', flour: 'Flour', bread: 'Bread',
  fish: 'Fish', meat: 'Meat', pig: 'Pigs', water: 'Water', coal: 'Coal', ironore: 'Iron Ore',
  goldore: 'Gold Ore', iron: 'Iron', gold: 'Gold', sword: 'Swords', bow: 'Bows', wine: 'Wine', axe: 'Axes',
  pickaxe: 'Pickaxes', saw: 'Saws', hammer: 'Hammers', shovel: 'Shovels', scythe: 'Scythes', rod: 'Fishing Rods',
};

export const TOOLS: Good[] = ['axe', 'pickaxe', 'saw', 'hammer', 'shovel', 'scythe', 'rod'];
export const WEAPONS: Good[] = ['sword', 'bow'];
export const FOODS: Good[] = ['bread', 'fish', 'meat'];

export function emptyStock(): Record<Good, number> {
  const r = {} as Record<Good, number>;
  for (const g of GOODS) r[g] = 0;
  return r;
}

export type Job =
  | 'carrier' | 'builder' | 'digger'
  | 'woodcutter' | 'forester' | 'stonecutter' | 'sawyer'
  | 'fisher' | 'hunter' | 'farmer' | 'miller' | 'baker' | 'butcher' | 'pigfarmer' | 'waterman'
  | 'miner' | 'smelter' | 'toolsmith' | 'weaponsmith'
  | 'vintner' | 'priest' | 'shipwright' | 'geologist'
  | 'swordsman' | 'bowman';

export const JOB_NAMES: Record<Job, string> = {
  carrier: 'Carrier', builder: 'Builder', digger: 'Digger', woodcutter: 'Woodcutter', forester: 'Forester',
  stonecutter: 'Stonecutter', sawyer: 'Sawyer', fisher: 'Fisher', hunter: 'Hunter', farmer: 'Farmer',
  miller: 'Miller', baker: 'Baker', butcher: 'Butcher', pigfarmer: 'Pig Farmer', waterman: 'Water Carrier',
  miner: 'Miner', smelter: 'Smelter', toolsmith: 'Toolsmith', weaponsmith: 'Weaponsmith',
  vintner: 'Vintner', priest: 'Priest', shipwright: 'Shipwright', geologist: 'Geologist', swordsman: 'Swordsman', bowman: 'Bowman',
};

export const JOB_TOOL: Partial<Record<Job, Good>> = {
  builder: 'hammer', digger: 'shovel', woodcutter: 'axe', stonecutter: 'pickaxe', sawyer: 'saw',
  fisher: 'rod', hunter: 'bow', farmer: 'scythe', miner: 'pickaxe', weaponsmith: 'hammer', shipwright: 'hammer',
};

export type BuildingType =
  | 'hq' | 'woodcutter' | 'forester' | 'stonecutter' | 'sawmill' | 'storehouse'
  | 'residence_s' | 'residence_m' | 'residence_l'
  | 'fisher' | 'hunter' | 'farm' | 'mill' | 'bakery' | 'waterworks' | 'pigfarm' | 'slaughter'
  | 'coalmine' | 'ironmine' | 'goldmine' | 'stonemine'
  | 'ironsmelter' | 'goldsmelter' | 'toolsmith' | 'weaponsmith'
  | 'vineyard' | 'temple' | 'greattemple'
  | 'harbour' | 'shipyard'
  | 'barracks' | 'tower_s' | 'tower_l' | 'castle';

export type Category = 'basic' | 'food' | 'industry' | 'military' | 'faith' | 'sea';

export interface InputSpec {
  goods: Good[]; // any of these satisfies the slot
  cap: number;
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  size: 1 | 2 | 3 | 4; // footprint side length in nodes (1 small hut ... 4 large)
  category: Category;
  cost: { board: number; stone: number };
  worker?: Job;
  inputs?: InputSpec[];
  outputs?: Good[];
  cycle?: number; // production seconds
  radius?: number; // work radius
  mine?: 'coal' | 'iron' | 'gold' | 'stone';
  military?: { capacity: number; radius: number };
  residence?: number; // number of carriers spawned
  storage?: boolean;
  mana?: number; // mana gained per production cycle (temples)
  coastal?: boolean; // needs deep, navigable sea water beside it (harbours, shipyards)
  desc: string;
  buildable?: boolean;
}

const D = (d: BuildingDef) => d;

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  hq: D({ type: 'hq', name: 'Headquarters', size: 4, category: 'military', cost: { board: 0, stone: 0 },
    storage: true, military: { capacity: 12, radius: 15 }, desc: 'Your seat of power. Stores goods and houses reserve soldiers.', buildable: false }),
  woodcutter: D({ type: 'woodcutter', name: "Woodcutter's Hut", size: 2, category: 'basic', cost: { board: 2, stone: 1 },
    worker: 'woodcutter', outputs: ['log'], radius: 11, desc: 'Fells mature trees and produces logs.' }),
  forester: D({ type: 'forester', name: "Forester's Hut", size: 2, category: 'basic', cost: { board: 2, stone: 1 },
    worker: 'forester', radius: 7, desc: 'Plants new trees in the surrounding area.' }),
  stonecutter: D({ type: 'stonecutter', name: "Stonecutter's Hut", size: 2, category: 'basic', cost: { board: 2, stone: 0 },
    worker: 'stonecutter', outputs: ['stone'], radius: 11, desc: 'Cuts stone blocks out of nearby rocks.' }),
  sawmill: D({ type: 'sawmill', name: 'Sawmill', size: 3, category: 'basic', cost: { board: 3, stone: 2 },
    worker: 'sawyer', inputs: [{ goods: ['log'], cap: 6 }], outputs: ['board'], cycle: 6, desc: 'Saws logs into boards.' }),
  storehouse: D({ type: 'storehouse', name: 'Storehouse', size: 3, category: 'basic', cost: { board: 4, stone: 4 },
    storage: true, desc: 'Stores goods closer to where they are needed.' }),
  residence_s: D({ type: 'residence_s', name: 'Small Residence', size: 2, category: 'basic', cost: { board: 3, stone: 2 },
    residence: 8, desc: 'Home for 8 new carriers.' }),
  residence_m: D({ type: 'residence_m', name: 'Medium Residence', size: 3, category: 'basic', cost: { board: 5, stone: 4 },
    residence: 18, desc: 'Home for 18 new carriers.' }),
  residence_l: D({ type: 'residence_l', name: 'Large Residence', size: 4, category: 'basic', cost: { board: 8, stone: 7 },
    residence: 32, desc: 'Home for 32 new carriers.' }),

  fisher: D({ type: 'fisher', name: "Fisher's Hut", size: 2, category: 'food', cost: { board: 2, stone: 0 },
    worker: 'fisher', outputs: ['fish'], radius: 9, desc: 'Catches fish in nearby waters.' }),
  hunter: D({ type: 'hunter', name: "Hunter's Hut", size: 2, category: 'food', cost: { board: 2, stone: 0 },
    worker: 'hunter', outputs: ['meat'], radius: 16, desc: 'Hunts deer for meat.' }),
  farm: D({ type: 'farm', name: 'Grain Farm', size: 4, category: 'food', cost: { board: 4, stone: 2 },
    worker: 'farmer', outputs: ['grain'], radius: 5, desc: 'Sows and harvests fields of grain.' }),
  mill: D({ type: 'mill', name: 'Windmill', size: 3, category: 'food', cost: { board: 3, stone: 3 },
    worker: 'miller', inputs: [{ goods: ['grain'], cap: 6 }], outputs: ['flour'], cycle: 6, desc: 'Grinds grain into flour.' }),
  bakery: D({ type: 'bakery', name: 'Bakery', size: 3, category: 'food', cost: { board: 3, stone: 2 },
    worker: 'baker', inputs: [{ goods: ['flour'], cap: 6 }, { goods: ['water'], cap: 6 }], outputs: ['bread'], cycle: 7, desc: 'Bakes bread from flour and water.' }),
  waterworks: D({ type: 'waterworks', name: 'Waterworks', size: 2, category: 'food', cost: { board: 2, stone: 1 },
    worker: 'waterman', outputs: ['water'], radius: 8, desc: 'Draws water from a nearby lake or river.' }),
  pigfarm: D({ type: 'pigfarm', name: 'Pig Farm', size: 4, category: 'food', cost: { board: 4, stone: 2 },
    worker: 'pigfarmer', inputs: [{ goods: ['grain'], cap: 6 }, { goods: ['water'], cap: 6 }], outputs: ['pig'], cycle: 12, desc: 'Raises pigs fed with grain and water.' }),
  slaughter: D({ type: 'slaughter', name: 'Slaughterhouse', size: 3, category: 'food', cost: { board: 3, stone: 2 },
    worker: 'butcher', inputs: [{ goods: ['pig'], cap: 4 }], outputs: ['meat'], cycle: 6, desc: 'Turns pigs into meat.' }),

  coalmine: D({ type: 'coalmine', name: 'Coal Mine', size: 3, category: 'industry', cost: { board: 3, stone: 1 },
    worker: 'miner', inputs: [{ goods: ['bread', 'fish', 'meat'], cap: 6 }], outputs: ['coal'], cycle: 8, mine: 'coal', radius: 3, desc: 'Mines coal. Needs food. Build on mountains where a geologist found coal.' }),
  ironmine: D({ type: 'ironmine', name: 'Iron Mine', size: 3, category: 'industry', cost: { board: 3, stone: 1 },
    worker: 'miner', inputs: [{ goods: ['bread', 'fish', 'meat'], cap: 6 }], outputs: ['ironore'], cycle: 9, mine: 'iron', radius: 3, desc: 'Mines iron ore. Needs food. Build where a geologist found iron.' }),
  goldmine: D({ type: 'goldmine', name: 'Gold Mine', size: 3, category: 'industry', cost: { board: 3, stone: 1 },
    worker: 'miner', inputs: [{ goods: ['bread', 'fish', 'meat'], cap: 6 }], outputs: ['goldore'], cycle: 10, mine: 'gold', radius: 3, desc: 'Mines gold ore. Needs food. Build where a geologist found gold.' }),
  stonemine: D({ type: 'stonemine', name: 'Stone Mine', size: 3, category: 'industry', cost: { board: 3, stone: 0 },
    worker: 'miner', inputs: [{ goods: ['bread', 'fish', 'meat'], cap: 6 }], outputs: ['stone'], cycle: 7, mine: 'stone', radius: 3, desc: 'Quarries stone inside a mountain. Needs food.' }),
  ironsmelter: D({ type: 'ironsmelter', name: 'Iron Smelter', size: 3, category: 'industry', cost: { board: 3, stone: 4 },
    worker: 'smelter', inputs: [{ goods: ['ironore'], cap: 6 }, { goods: ['coal'], cap: 6 }], outputs: ['iron'], cycle: 8, desc: 'Smelts iron ore with coal into iron bars.' }),
  goldsmelter: D({ type: 'goldsmelter', name: 'Gold Smelter', size: 3, category: 'industry', cost: { board: 3, stone: 4 },
    worker: 'smelter', inputs: [{ goods: ['goldore'], cap: 6 }, { goods: ['coal'], cap: 6 }], outputs: ['gold'], cycle: 8, desc: 'Smelts gold. Gold raises the morale of your soldiers.' }),
  toolsmith: D({ type: 'toolsmith', name: 'Toolsmith', size: 3, category: 'industry', cost: { board: 4, stone: 3 },
    worker: 'toolsmith', inputs: [{ goods: ['iron'], cap: 6 }, { goods: ['coal'], cap: 6 }], outputs: ['axe', 'pickaxe', 'saw', 'hammer', 'shovel', 'scythe', 'rod'], cycle: 10, desc: 'Forges the tools your specialists need.' }),
  weaponsmith: D({ type: 'weaponsmith', name: 'Weaponsmith', size: 3, category: 'industry', cost: { board: 4, stone: 3 },
    worker: 'weaponsmith', inputs: [{ goods: ['iron'], cap: 6 }, { goods: ['coal'], cap: 6 }], outputs: ['sword', 'bow'], cycle: 10, desc: 'Forges swords and bows.' }),

  vineyard: D({ type: 'vineyard', name: 'Vineyard', size: 3, category: 'faith', cost: { board: 3, stone: 2 },
    worker: 'vintner', outputs: ['wine'], radius: 5, desc: 'Tends rows of vines and presses the grapes into wine.' }),
  temple: D({ type: 'temple', name: 'Temple', size: 3, category: 'faith', cost: { board: 4, stone: 6 },
    worker: 'priest', inputs: [{ goods: ['wine'], cap: 6 }], cycle: 9, mana: 3, desc: 'A priest offers wine to the gods, earning mana for divine spells.' }),
  greattemple: D({ type: 'greattemple', name: 'Great Temple', size: 4, category: 'faith', cost: { board: 8, stone: 14 },
    worker: 'priest', inputs: [{ goods: ['wine'], cap: 8 }], cycle: 8, mana: 6, desc: 'A domed sanctuary. Earns more mana and unlocks the mightiest spells.' }),

  harbour: D({ type: 'harbour', name: 'Harbour', size: 3, category: 'sea', cost: { board: 6, stone: 5 },
    storage: true, coastal: true, military: { capacity: 2, radius: 8 },
    desc: 'A coastal storehouse where ships dock. Ships carry goods and settlers between your harbours and sail expeditions to found colonies overseas.' }),
  shipyard: D({ type: 'shipyard', name: 'Shipyard', size: 3, category: 'sea', cost: { board: 4, stone: 2 },
    worker: 'shipwright', coastal: true, inputs: [{ goods: ['board'], cap: 8 }],
    desc: 'A shipwright builds sailing ships on the slipway, plank by plank.' }),

  barracks: D({ type: 'barracks', name: 'Barracks', size: 3, category: 'military', cost: { board: 4, stone: 4 },
    inputs: [{ goods: ['sword'], cap: 4 }, { goods: ['bow'], cap: 4 }], cycle: 6, desc: 'Trains carriers into soldiers using weapons.' }),
  tower_s: D({ type: 'tower_s', name: 'Guard Tower', size: 2, category: 'military', cost: { board: 3, stone: 2 },
    military: { capacity: 2, radius: 9 }, desc: 'Small tower that extends your territory.' }),
  tower_l: D({ type: 'tower_l', name: 'Watchtower', size: 3, category: 'military', cost: { board: 5, stone: 6 },
    military: { capacity: 5, radius: 13 }, desc: 'Large tower with a strong garrison.' }),
  castle: D({ type: 'castle', name: 'Castle', size: 4, category: 'military', cost: { board: 8, stone: 12 },
    military: { capacity: 10, radius: 17 }, desc: 'Mighty fortress, claims a wide area.' }),
};

export const BUILD_ORDER: Record<Category, BuildingType[]> = {
  basic: ['woodcutter', 'forester', 'sawmill', 'stonecutter', 'residence_s', 'residence_m', 'residence_l', 'storehouse'],
  food: ['fisher', 'hunter', 'farm', 'waterworks', 'mill', 'bakery', 'pigfarm', 'slaughter'],
  industry: ['coalmine', 'ironmine', 'goldmine', 'stonemine', 'ironsmelter', 'goldsmelter', 'toolsmith', 'weaponsmith'],
  military: ['tower_s', 'tower_l', 'castle', 'barracks'],
  faith: ['vineyard', 'temple', 'greattemple'],
  sea: ['harbour', 'shipyard'],
};

export const CATEGORY_NAMES: Record<Category, string> = {
  basic: 'Basic', food: 'Food', industry: 'Industry', military: 'Military', faith: 'Faith', sea: 'Sea',
};

/** Boards a shipwright hammers into one ship. */
export const SHIP_BOARDS = 10;
export const SHIP_CARGO = 20;
export const SHIP_PASSENGERS = 12;
export const MAX_SHIPS = 8;

export const PLAYER_COLORS = [0xc8342a, 0x2f6fd0, 0xe0b020, 0x8a3fd0];
export const PLAYER_NAMES = ['Red Kingdom', 'Blue Empire', 'Golden Realm', 'Violet Dynasty'];

// Terrain materials (splat channels)
export const T_GRASS = 0, T_MEADOW = 1, T_FOREST = 2, T_DIRT = 3, T_SAND = 4, T_ROCK = 5, T_SNOW = 6, T_SWAMP = 7;

export const ORE_COAL = 1, ORE_IRON = 2, ORE_GOLD = 3, ORE_STONE = 4;
export const ORE_NAMES = ['nothing', 'coal', 'iron ore', 'gold', 'granite'];
export const MINE_ORE: Record<string, number> = { coal: ORE_COAL, iron: ORE_IRON, gold: ORE_GOLD, stone: ORE_STONE };
