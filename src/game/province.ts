// The province of Terra Nova as the campaign sees it (CAMPAIGN.md): twelve regions, the roads between
// them, who holds each, what holding it gives, and Varro's turn between seasons. Pure rules on plain
// data: the run itself (what is held, the column, the season) is kept by the interface
// (ui/provinceStore.ts), and a headless script can play a whole campaign through these functions.
import type { Carry, People } from './campaign';
import type { Good } from './defs';
import { RNG } from '../core/rng';

export type RegionId =
  | 'castra' | 'silva' | 'saltus' | 'aestuarium' | 'vallis' | 'metalla'
  | 'collis' | 'insulae' | 'litus' | 'ara' | 'castellum' | 'novaostia';

/** Who a region belongs to at the start of the campaign. */
export type Holder = 'you' | 'varro' | 'tribes';

export interface RegionInfo {
  id: RegionId;
  name: string;
  /** what the place is, in two or three words */
  kind: string;
  /** on the province's map (1000 × 600) */
  at: [number, number];
  /** its line on the map */
  line: string;
  /** the roads out of it */
  roads: RegionId[];
  holder: Holder;
  /** what holding it gives every later mission */
  boon: { text: string; goods?: Partial<Record<Good, number>>; men?: { sword: number; bow: number; level: number }; ships?: { trade?: number; war?: number }; peace?: People };
  /** the mission that wins it (regions.ts), once it has been drawn */
  mission?: string;
}

export const REGION_INFO: Record<RegionId, RegionInfo> = {
  castra: { id: 'castra', name: 'Castra', kind: 'The legate’s coast', at: [205, 330], line: 'Where the tutorial’s camp became a town. Home.', roads: ['silva', 'saltus', 'aestuarium'], holder: 'you',
    boon: { text: 'The capital: the column rests here between seasons', goods: { board: 20, stone: 20 } } },
  silva: { id: 'silva', name: 'Silva', kind: 'The forest', at: [285, 175], line: 'Old woods, an older grove, and the Ninth hiding in them.', roads: ['castra', 'saltus', 'collis'], holder: 'varro', mission: 'silva',
    boon: { text: '40 boards and 20 logs to every start; the Ninth’s veterans', goods: { board: 40, log: 20 }, men: { sword: 2, bow: 1, level: 1 } } },
  saltus: { id: 'saltus', name: 'Saltus', kind: 'The pass', at: [420, 300], line: 'A wall of mountains, one road through it, and a fort on the far side.', roads: ['castra', 'silva', 'vallis', 'metalla'], holder: 'varro', mission: 'saltus',
    boon: { text: '12 iron and 12 coal to every start: the pass’s mines', goods: { iron: 12, coal: 12 } } },
  aestuarium: { id: 'aestuarium', name: 'Aestuarium', kind: 'The estuary', at: [245, 470], line: 'A harbour up a long water, and pirates on the tide.', roads: ['castra', 'insulae', 'litus'], holder: 'varro', mission: 'aestuarium',
    boon: { text: '20 fish to every start, and a trade ship off every coast', goods: { fish: 20 }, ships: { trade: 1 } } },
  vallis: { id: 'vallis', name: 'Vallis', kind: 'The valley', at: [565, 335], line: 'The province’s farmland, between two walls of mountains.', roads: ['saltus', 'metalla', 'ara', 'castellum'], holder: 'varro', mission: 'vallis',
    boon: { text: '30 bread and 10 meat to every start', goods: { bread: 30, meat: 10 } } },
  metalla: { id: 'metalla', name: 'Metalla', kind: 'The gold plateau', at: [590, 160], line: 'Gold under a high plateau, and one path up.', roads: ['saltus', 'vallis', 'collis'], holder: 'varro', mission: 'aurum',
    boon: { text: '10 gold to every start: morale from the first minute', goods: { gold: 10 } } },
  collis: { id: 'collis', name: 'Collis', kind: 'The tribes’ upland', at: [430, 85], line: 'Three hill forts of the tribes, who owe nobody anything.', roads: ['silva', 'metalla'], holder: 'tribes', mission: 'collis',
    boon: { text: 'The tribes’ war band in every fight, four veterans, and no tribal raids anywhere', men: { sword: 2, bow: 2, level: 2 }, peace: 'tribes' } },
  insulae: { id: 'insulae', name: 'Insulae', kind: 'The archipelago', at: [95, 520], line: 'Islands, colonies to found, and Varro’s fleet among them.', roads: ['aestuarium', 'litus'], holder: 'varro', mission: 'insulae',
    boon: { text: 'The islands’ gold and iron: 8 of each', goods: { gold: 8, iron: 8 } } },
  litus: { id: 'litus', name: 'Litus', kind: 'The pirate coast', at: [440, 535], line: 'Where the pirates Varro hired keep the ships he paid for.', roads: ['aestuarium', 'insulae', 'ara'], holder: 'varro', mission: 'litus',
    boon: { text: 'The pirates’ swords, 8 swords and 4 bows, two of their warships off every coast, and no pirate sails anywhere', goods: { sword: 8, bow: 4 }, ships: { war: 2 }, peace: 'pirates' } },
  ara: { id: 'ara', name: 'Ara', kind: 'The sacred hill', at: [700, 460], line: 'A great temple on a hill, and Varro’s priests in it.', roads: ['vallis', 'litus', 'castellum'], holder: 'varro', mission: 'ara',
    boon: { text: 'Wine for the priests: 20 wine to every start', goods: { wine: 20 } } },
  castellum: { id: 'castellum', name: 'Castellum', kind: 'Varro’s fortress', at: [770, 285], line: 'A ring of castles round a hill: the road to Nova Ostia.', roads: ['vallis', 'ara', 'novaostia'], holder: 'varro', mission: 'castellum',
    boon: { text: 'Varro fortifies no further and strikes at half the weight; 30 stone to every start from its quarries', goods: { stone: 30 } } },
  novaostia: { id: 'novaostia', name: 'Nova Ostia', kind: 'Varro’s seat', at: [905, 365], line: 'The governor’s capital, his fleet, and the Senate’s ship on the horizon.', roads: ['castellum'], holder: 'varro', mission: 'novaostia',
    boon: { text: 'The province' } },
};
export const REGION_IDS = Object.keys(REGION_INFO) as RegionId[];
/** How many regions must be held (the capital counts) before Nova Ostia can be marched on. */
export const TO_THE_FINALE = 8;

export type Difficulty = 0 | 1 | 2;

/** What the province stands at, between two seasons: plain data, kept by the interface. */
export interface ProvinceState {
  /** chooses Varro's moves; a new campaign draws a new one */
  seed: number;
  /** from 1; a season passes with every region won or defended */
  season: number;
  difficulty: Difficulty;
  /** the regions that are the legate's */
  held: RegionId[];
  /** how many times Varro has fortified each of his regions */
  fortified: Partial<Record<RegionId, number>>;
  /** a region of ours Varro is marching on: to be defended before any other campaign (or given up) */
  strike: RegionId | null;
  /** the quaestor's dispatches, newest last */
  log: { season: number; text: string; who: 'quaestor' | 'varro' }[];
  column: Carry | null;
  /** 'won': Nova Ostia has fallen; 'recalled': Castra fell and the Senate called the legate home */
  end?: 'won' | 'recalled';
  /** the quaestor's count: regions won, strikes beaten off, regions lost */
  ledger?: { won: number; held: number; lost: number };
}

export function newProvince(seed: number, difficulty: Difficulty = 1): ProvinceState {
  return { seed, season: 1, difficulty, held: ['castra'], fortified: {}, strike: null, log: [{ season: 1, who: 'varro', text: 'The Senate has appointed me governor of Terra Nova. You will hand over the coast, the camp and the men at Castra, and return to Rome to account for them.' }], column: null, ledger: { won: 0, held: 0, lost: 0 } };
}

export const holds = (s: ProvinceState, r: RegionId) => s.held.includes(r);

/** The regions a campaign can go to this season: Varro's or the tribes', on a road from one we hold, with a mission drawn for it. */
export function frontier(s: ProvinceState, drawn: (id: string) => boolean): RegionId[] {
  if (s.end || s.strike) return [];
  const out = new Set<RegionId>();
  for (const h of s.held) for (const r of REGION_INFO[h].roads) {
    if (holds(s, r)) continue;
    if (r === 'novaostia' && s.held.length < TO_THE_FINALE) continue;
    const m = REGION_INFO[r].mission;
    if (m && drawn(m)) out.add(r);
  }
  return REGION_IDS.filter((r) => out.has(r));
}

/** Regions on a road from ours that are still to be drawn (the map shows them, sealed). */
export function beyond(s: ProvinceState, drawn: (id: string) => boolean): RegionId[] {
  const out = new Set<RegionId>();
  for (const h of s.held) for (const r of REGION_INFO[h].roads) if (!holds(s, r) && !(REGION_INFO[r].mission && drawn(REGION_INFO[r].mission!))) out.add(r);
  return REGION_IDS.filter((r) => out.has(r));
}

/** What the held regions give a start, on top of the column. */
export function boonsOf(s: ProvinceState): Carry {
  const goods: Partial<Record<Good, number>> = {};
  const veterans: Carry['veterans'] = [];
  let trade = 0, war = 0;
  const peace: People[] = [];
  for (const r of s.held) {
    const b = REGION_INFO[r].boon;
    for (const [k, n] of Object.entries(b.goods ?? {})) goods[k as Good] = (goods[k as Good] ?? 0) + (n ?? 0);
    if (b.men) {
      for (let k = 0; k < b.men.sword; k++) veterans.push({ job: 'swordsman', level: b.men.level });
      for (let k = 0; k < b.men.bow; k++) veterans.push({ job: 'bowman', level: b.men.level });
    }
    trade += b.ships?.trade ?? 0;
    war += b.ships?.war ?? 0;
    if (b.peace) peace.push(b.peace);
  }
  return { veterans, goods, ...(trade || war ? { ships: { trade, war } } : {}), ...(peace.length ? { peace } : {}) };
}

/** The column and the boons as one start. */
export function startOf(s: ProvinceState): Carry | undefined {
  const b = boonsOf(s), c = s.column;
  if (!c && !b.veterans.length && !Object.keys(b.goods).length && !b.ships && !b.peace) return undefined;
  const goods: Partial<Record<Good, number>> = { ...(c?.goods ?? {}) };
  for (const [k, n] of Object.entries(b.goods)) goods[k as Good] = (goods[k as Good] ?? 0) + (n ?? 0);
  return { veterans: [...(c?.veterans ?? []), ...b.veterans], goods, ...(b.ships ? { ships: b.ships } : {}), ...(b.peace ? { peace: b.peace } : {}) };
}

/**
 * Varro's move at the turn of a season: he strikes one of our regions (not the capital, while we are
 * strong) every other season from the third, harder on Hard; otherwise he fortifies one of his own on
 * our border. Deterministic in the run's seed and the season.
 */
export function varrosTurn(s: ProvinceState): { kind: 'strike' | 'fortify'; region: RegionId } | null {
  if (s.end) return null;
  const rng = new RNG((s.seed * 7919 + s.season * 104729) >>> 0);
  const strikeEvery = s.difficulty === 2 ? 2 : s.difficulty === 1 ? 2 : 3;
  const ours = s.held.filter((r) => r !== 'castra');
  // late and weak: he comes for the capital itself
  if (s.season >= 8 && s.held.length < 4) return { kind: 'strike', region: 'castra' };
  // (with Castellum ours he has nothing left to fortify from, and strikes only)
  if (s.season >= 3 && (s.season - 3) % strikeEvery === 0 && ours.length) {
    // the one of ours nearest his own land
    const near = ours.filter((r) => REGION_INFO[r].roads.some((x) => !holds(s, x) && REGION_INFO[x].holder === 'varro'));
    const pool = near.length ? near : ours;
    return { kind: 'strike', region: pool[rng.int(0, pool.length)] };
  }
  // fortify a region of his that borders ours
  if (holds(s, 'castellum')) return null;
  const border = REGION_IDS.filter((r) => !holds(s, r) && REGION_INFO[r].holder === 'varro' && REGION_INFO[r].roads.some((x) => holds(s, x)));
  if (!border.length) return null;
  return { kind: 'fortify', region: border[rng.int(0, border.length)] };
}

const say = (s: ProvinceState, who: 'quaestor' | 'varro', text: string) => s.log.push({ season: s.season, who, text });
const count = (s: ProvinceState, k: 'won' | 'held' | 'lost') => { (s.ledger ??= { won: 0, held: 0, lost: 0 })[k]++; };

/** How hard his strike on one of our regions comes (the defence's `fortified`): harder as the war goes on, half as hard once Castellum is ours. */
export function strikeWeight(s: ProvinceState): number {
  const w = Math.floor((s.season - 1) / 2);
  return holds(s, 'castellum') ? Math.floor(w / 2) : w;
}

/** The turn of the season after a region is won (or a defence held): Varro moves, and it is said. */
function nextSeason(s: ProvinceState) {
  s.season++;
  const t = varrosTurn(s);
  if (!t) return;
  const name = REGION_INFO[t.region].name;
  if (t.kind === 'fortify') {
    s.fortified[t.region] = (s.fortified[t.region] ?? 0) + 1;
    say(s, 'quaestor', `Varro has fortified ${name}: more men in its towers, and more of them on the roads out of it. It will cost more to take.`);
  } else {
    s.strike = t.region;
    say(s, 'varro', t.region === 'castra'
      ? 'The Senate’s patience is at an end, and so is mine. I am coming to Castra for the men who built it.'
      : `${name} was never yours to hold. My legion is on the road to it.`);
  }
}

/** A region won: it is ours, its column marches on, and the season turns. */
export function regionWon(s: ProvinceState, r: RegionId, column: Carry) {
  if (!holds(s, r)) s.held.push(r);
  s.column = column;
  delete s.fortified[r];
  count(s, 'won');
  if (r === 'novaostia') { s.end = 'won'; say(s, 'quaestor', 'Nova Ostia has opened its gates. The Senate’s ship came in on the same tide, with a new appointment for the governor of Terra Nova. It is addressed to you.'); return; }
  say(s, 'quaestor', `${REGION_INFO[r].name} is ours. ${REGION_INFO[r].boon.text}.`);
  nextSeason(s);
}

/** A strike beaten off: the region stays ours, the column marches on, and the season turns. */
export function strikeHeld(s: ProvinceState, column: Carry) {
  const r = s.strike;
  if (!r) return;
  s.strike = null;
  s.column = column;
  count(s, 'held');
  say(s, 'quaestor', `${REGION_INFO[r].name} held. His legion went home lighter than it came.`);
  nextSeason(s);
}

/** A strike lost (or the region given up): it is his again; the capital lost ends the campaign. */
export function strikeLost(s: ProvinceState) {
  const r = s.strike;
  if (!r) return;
  s.strike = null;
  count(s, 'lost');
  if (r === 'castra') { s.end = 'recalled'; say(s, 'varro', 'Castra is the Senate’s. The legate is recalled to Rome, where I am sure his accounts will be found in order.'); return; }
  s.held = s.held.filter((x) => x !== r);
  say(s, 'quaestor', `${REGION_INFO[r].name} is lost. We will have to take it again, and he will have fortified it.`);
  s.fortified[r] = (s.fortified[r] ?? 0) + 1;
  nextSeason(s);
}
