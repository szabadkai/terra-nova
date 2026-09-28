// What a building is doing, and when it has stopped, why — as data, so the view can show the missing
// good over the roof and count the stalls without reading the panel text. `b.status` stays the text
// for the panel (the AI and the pig pen still read it); `b.stall` is set only while it is stuck.
import { GOOD_NAMES, type Good } from './defs';
import type { Game } from './game';
import type { Building } from './types';

/** What a gatherer finds nothing of within its radius. */
export type Lack = 'trees' | 'rocks' | 'fish' | 'game' | 'water' | 'space';

export type Stall =
  /** waiting for an input; several goods = any of them (food for a mine, weapons for the barracks) */
  | { kind: 'input'; goods: Good[] }
  /** its worker needs a tool and there is none in store */
  | { kind: 'tool'; good: Good }
  /** no free settler to take the job (or to recruit) */
  | { kind: 'settlers' }
  /** the output pile is full: carriers aren't taking it away */
  | { kind: 'full' }
  /** nothing to work within its radius */
  | { kind: 'range'; lack: Lack }
  /** a mine whose deposit is worked out */
  | { kind: 'exhausted' }
  /** a donkey ranch with no market to breed for */
  | { kind: 'market' };

/** A stall must last this long (game seconds) before it counts as a warning: a smelter waiting a moment between deliveries isn't stuck. */
export const STALL_GRACE = 20;

const lower = (gd: Good) => GOOD_NAMES[gd].toLowerCase();

export function stallText(st: Stall): string {
  switch (st.kind) {
    case 'input': return `Waiting for ${st.goods.length === 1 ? lower(st.goods[0]) : st.goods.includes('sword') ? 'weapons' : 'food'}`;
    case 'tool': return `Missing tool: ${GOOD_NAMES[st.good].replace(/s$/, '').toLowerCase()}`;
    case 'settlers': return 'No free settlers';
    case 'full': return 'Output storage full';
    case 'range': return st.lack === 'space' ? 'No space to work' : `No ${st.lack} in range`;
    case 'exhausted': return 'Deposit exhausted';
    case 'market': return 'Waiting for a market place to work for';
  }
}

const sameStall = (a: Stall | null, b: Stall) => {
  if (!a || a.kind !== b.kind) return false;
  switch (b.kind) {
    case 'input': return (a as typeof b).goods.join() === b.goods.join();
    case 'tool': return (a as typeof b).good === b.good;
    case 'range': return (a as typeof b).lack === b.lack;
    default: return true;
  }
};

/** The building is stuck: say why (`text` for the panel when it words it differently). The clock keeps running while the reason stays the same. */
export function setStall(g: Game, b: Building, why: Stall, text = stallText(why)) {
  if (!sameStall(b.stall, why)) { b.stall = why; b.stallT = g.time; }
  b.status = text;
}

/** The building is doing something, or waiting for nothing in particular. */
export function setStatus(b: Building, text: string) {
  b.stall = null;
  b.status = text;
}

/** Is it stuck, and has been for long enough to warn about? */
export function stalled(g: Game, b: Building): boolean {
  return !!b.stall && b.state === 'done' && g.time - b.stallT >= STALL_GRACE;
}

/** The player's stuck buildings, in a stable order (by id) for cycling through them. */
export function stalledBuildings(g: Game, owner: number): Building[] {
  const out: Building[] = [];
  for (const b of g.buildings.values()) if (b.owner === owner && stalled(g, b)) out.push(b);
  return out.sort((a, b) => a.id - b.id);
}

/** The goods a stall is about, for the badge: the missing input, the tool, the pile that is full, the ore that ran out. */
export function stallGoods(b: Building): Good[] {
  const st = b.stall;
  if (!st) return [];
  switch (st.kind) {
    case 'input': return st.goods;
    case 'tool': return [st.good];
    case 'full':
    case 'exhausted': return b.def.outputs?.slice(0, 1) ?? [];
    case 'range': return st.lack === 'rocks' ? ['stone'] : st.lack === 'fish' ? ['fish'] : st.lack === 'water' ? ['water'] : []; // trees, game, space: the badge draws them
    default: return [];
  }
}
