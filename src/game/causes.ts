// Why a building has stopped, followed upstream: a weaponsmith waiting for iron → the iron smelter
// waiting for coal → the coal mine waiting for food → both fishers finding no fish in range. The walk
// starts from `b.stall` and goes to whatever makes what is missing: if nothing does, that's the cause;
// if the makers are stuck too, it follows them (grouping those stuck for the same reason); goods
// already in store or on their way end it. Read-only — no random numbers, nothing changed — so the
// building panel, the ⚠ tooltip, the alerts and the headless balance runs can all ask.
import { BUILDINGS, GOOD_NAMES, type BuildingType, type Good } from './defs';
import type { Game } from './game';
import { availableAt } from './economy';
import { stallText, stalledBuildings } from './status';
import type { Building } from './types';

export interface Cause {
  /** the kind of building at this step; null for a step that isn't one ("12 in store") */
  type: BuildingType | null;
  /** the buildings at this step, the one stuck longest first; none for a building that isn't there */
  ids: number[];
  /** what is the matter there, lower case: "waiting for coal", "no fish in range", "none built" */
  text: string;
  /** what the player could do about it, where the chain ends */
  hint?: string;
  /** false for a step that will sort itself out: goods on their way, a maker at work */
  bad: boolean;
  /** what it waits on in turn */
  next: Cause[];
}

/** Steps followed at most, and branches shown per step. */
const MAX_DEPTH = 6;
const MAX_BRANCHES = 4;

/** Which buildings make each good (the first is the one to suggest building). */
const MAKERS: Record<Good, BuildingType[]> = (() => {
  const m = {} as Record<Good, BuildingType[]>;
  for (const d of Object.values(BUILDINGS)) {
    if (d.buildable === false || d.storage) continue;
    for (const gd of d.outputs ?? []) (m[gd] ??= []).push(d.type);
  }
  return m;
})();

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const goodWord = (gd: Good) => GOOD_NAMES[gd].toLowerCase();
const goodsWord = (goods: Good[]) => goods.length === 1 ? goodWord(goods[0]) : goods.includes('sword') ? 'weapons' : 'food';
const region = (g: Game, b: Building) => g.world.region[b.door];
/** "a Sawmill", "an Iron Smelter" */
export const aName = (name: string) => `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;

const HINT_RANGE: Record<string, string> = {
  trees: 'Build a forester nearby, or a woodcutter by other woods',
  rocks: 'Build a stonecutter by other rocks, or a stone mine',
  fish: 'Build fishers by other waters',
  game: 'Build a hunter by other woods, a forester to grow new ones, or a pig farm and a slaughterhouse',
  water: 'Build the waterworks by a lake or a river',
  space: 'Clear room around it, or build it elsewhere',
};

function idleCarriers(g: Game, owner: number, r: number): number {
  let n = 0;
  for (const s of g.settlers.values()) if (s.owner === owner && s.job === 'carrier' && s.idle && !s.dead && g.world.region[s.node] === r) n++;
  return n;
}

/** The chain behind a stalled building, or null if it isn't stalled. */
export function causeOf(g: Game, b: Building): Cause | null {
  if (!b.stall) return null;
  return explain(g, [b], new Set(), 0);
}

/** One step: a group of buildings of one type stuck for the same reason, and what that reason waits on. */
function explain(g: Game, group: Building[], path: Set<BuildingType>, depth: number): Cause {
  const b = group[0];
  const st = b.stall!;
  const node: Cause = { type: b.type, ids: group.map((x) => x.id), text: lowerFirst(b.status || stallText(st)), bad: true, next: [] };
  const on = new Set(path).add(b.type);
  switch (st.kind) {
    case 'input':
      if (depth < MAX_DEPTH) node.next = supply(g, b, st.goods, on, depth + 1);
      break;
    case 'tool':
      if (depth < MAX_DEPTH) node.next = supply(g, b, [st.good], on, depth + 1);
      break;
    case 'settlers':
      node.hint = 'Build a residence: every settler has work';
      break;
    case 'full': {
      // carriers take a pile to the store once three of a good lie there; a workshop making several goods can fill up before that
      const r = region(g, b);
      if (!idleCarriers(g, b.owner, r)) node.next = [{ type: null, ids: [], text: 'no free carrier to take it away', hint: 'Build a residence for more carriers', bad: true, next: [] }];
      else if (!g.nearestStorage(b.owner, b.cx, b.cz, r)) node.next = [{ type: 'storehouse', ids: [], text: 'none on this land', hint: 'Build a Storehouse', bad: true, next: [] }];
      else if ((b.def.outputs ?? []).every((gd) => b.stock[gd] < 3)) node.next = [{ type: null, ids: [], text: 'nobody needs them yet: they go as soon as someone does', bad: false, next: [] }];
      else node.next = [{ type: null, ids: [], text: 'carriers on their way to take it away', bad: false, next: [] }];
      break;
    }
    case 'range':
      node.hint = HINT_RANGE[st.lack];
      break;
    case 'exhausted':
      node.hint = 'Send a geologist to find more, and build a new mine there';
      break;
    case 'market':
      node.hint = 'Build a Market Place';
      break;
  }
  return node;
}

/** Where `goods` (any one of them) would come from for `b`, and why they don't. */
function supply(g: Game, b: Building, goods: Good[], path: Set<BuildingType>, depth: number): Cause[] {
  const word = goodsWord(goods);
  if (goods.some((gd) => b.incoming[gd] > 0)) return [{ type: null, ids: [], text: `${word} on the way`, bad: false, next: [] }];
  const r = region(g, b);
  // lying in a store or at a maker's door, but nobody brings it
  let lying = 0;
  for (const o of g.buildings.values()) {
    if (o.owner !== b.owner || o === b || region(g, o) !== r) continue;
    for (const gd of goods) lying += Math.max(0, availableAt(o, gd));
  }
  if (lying > 0) {
    return [idleCarriers(g, b.owner, r)
      ? { type: null, ids: [], text: `${lying} ${word} in store, to be brought`, bad: false, next: [] }
      : { type: null, ids: [], text: `${lying} ${word} in store, but no free carrier to bring it`, hint: 'Build a residence for more carriers', bad: true, next: [] }];
  }
  // what makes it, by what each maker is doing
  const groups = new Map<string, { kind: 'stuck' | 'work' | 'site' | 'paused'; list: Building[] }>();
  const missing: Good[] = [];
  let elsewhere = false;
  for (const gd of goods) {
    const types = MAKERS[gd] ?? [];
    let any = false;
    for (const o of g.buildings.values()) {
      if (o.owner !== b.owner || !types.includes(o.type) || o.state === 'burning') continue;
      if (region(g, o) !== r) { elsewhere = true; continue; }
      any = true;
      const kind = o.state !== 'done' ? 'site' : o.paused ? 'paused' : o.stall ? 'stuck' : 'work';
      const key = `${o.type}|${kind}|${kind === 'stuck' ? o.status : ''}`;
      const grp = groups.get(key) ?? { kind, list: [] };
      if (!grp.list.includes(o)) grp.list.push(o);
      groups.set(key, grp);
    }
    if (!any && types.length) missing.push(gd);
  }
  const out: Cause[] = [];
  for (const { kind, list } of groups.values()) {
    const d = BUILDINGS[list[0].type];
    if (kind === 'stuck') {
      list.sort((x, y) => x.stallT - y.stallT || x.id - y.id);
      if (path.has(d.type)) {
        // it waits on a building further down this very chain: neither can start
        out.push({ type: d.type, ids: list.map((x) => x.id), text: 'again — a deadlock', hint: 'Break it by hand: bring in what is missing from elsewhere, or demolish another building to free its worker', bad: true, next: [] });
      } else out.push(explain(g, list, path, depth));
    } else if (kind === 'paused') out.push({ type: d.type, ids: list.map((x) => x.id), text: 'paused', hint: 'Resume it', bad: true, next: [] });
    else if (kind === 'site') out.push({ type: d.type, ids: list.map((x) => x.id), text: 'still being built', bad: false, next: [] });
    else out.push({ type: d.type, ids: list.map((x) => x.id), text: 'at work, but it can\'t keep up', hint: `Build another ${d.name}`, bad: false, next: [] });
  }
  for (const gd of missing) {
    const t = MAKERS[gd][0];
    out.push({ type: t, ids: [], text: elsewhere ? 'none on this land' : 'none built', hint: `Build ${aName(BUILDINGS[t].name)}`, bad: true, next: [] });
  }
  // the real causes first, then the biggest groups
  out.sort((x, y) => Number(y.bad) - Number(x.bad) || y.ids.length - x.ids.length);
  return out.slice(0, MAX_BRANCHES);
}

/** A step as a line: "Fisher's Hut ×2: no fish in range", "No Bakery", "12 iron in store, to be brought". */
export function causeLine(c: Cause): string {
  if (!c.type) return c.text.charAt(0).toUpperCase() + c.text.slice(1);
  const name = BUILDINGS[c.type].name;
  if (!c.ids.length) return c.text === 'none built' ? `No ${name}` : `No ${name} ${c.text.replace(/^none /, '')}`;
  return `${name}${c.ids.length > 1 ? ` ×${c.ids.length}` : ''}${c.text.startsWith('again') ? ' ' : ': '}${c.text}`;
}

/** The whole chain on one line: "Toolsmith: waiting for iron → Iron Smelter: waiting for coal → …", branches split by " · ". */
export function chainText(c: Cause): string {
  const tail = c.next.map(chainText);
  return causeLine(c) + (tail.length ? ` → ${tail.length > 1 ? `(${tail.join(' · ')})` : tail[0]}` : '');
}

/** Where the chain ends: the steps with nothing further upstream — the real causes if there are any, else all of them. */
export function rootCauses(c: Cause): Cause[] {
  const leaves: Cause[] = [];
  const walk = (x: Cause) => { if (!x.next.length) leaves.push(x); else x.next.forEach(walk); };
  walk(c);
  const bad = leaves.filter((x) => x.bad);
  return bad.length ? bad : leaves;
}

/** The steps below the building itself, flattened with their depth, for the panel. */
export function causeSteps(c: Cause): { c: Cause; depth: number }[] {
  const out: { c: Cause; depth: number }[] = [];
  const walk = (x: Cause, d: number) => { for (const n of x.next) { out.push({ c: n, depth: d }); walk(n, d + 1); } };
  walk(c, 0);
  return out;
}

/** How much a kind of stall matters on its own: a building with no worker, tool or ore is lost to the economy; a full pile sorts itself out. */
const KIND_WEIGHT: Record<string, number> = { settlers: 4, tool: 4, exhausted: 4, input: 3, market: 2, range: 1, full: 0 };

/**
 * The stalls that matter most, at most `n`, each about something different: a building counts
 * itself and every other stalled building whose chain runs through it (a bakery with no water that
 * starves the mines outranks five hunters with no game); then whether its chain ends in a real cause
 * rather than goods already on their way; then the kind of stall and how long it has lasted.
 * `list` defaults to all the player's stalled buildings.
 */
export function topStalls(g: Game, owner: number, n: number, list = stalledBuildings(g, owner)): Building[] {
  const impact = new Map<number, number>(), real = new Set<number>();
  for (const b of list) impact.set(b.id, 1);
  for (const b of list) {
    const c = causeOf(g, b);
    if (!c) continue;
    if (rootCauses(c).some((r) => r.bad)) real.add(b.id);
    const upstream = new Set<number>();
    for (const { c: step } of causeSteps(c)) for (const id of step.ids) if (id !== b.id) upstream.add(id);
    for (const id of upstream) if (impact.has(id)) impact.set(id, impact.get(id)! + 1);
  }
  const score = (b: Building) => impact.get(b.id)! * 10 + (real.has(b.id) ? 4 : 0) + (KIND_WEIGHT[b.stall!.kind] ?? 0) + Math.min(2, (g.time - b.stallT) / 300);
  const ranked = [...list].sort((a, b) => score(b) - score(a) || a.id - b.id);
  // one badge per thing missing first; the same again only if there is room left
  const out: Building[] = [], reasons = new Set<string>();
  for (const b of ranked) if (out.length < n && !reasons.has(b.status)) { reasons.add(b.status); out.push(b); }
  for (const b of ranked) if (out.length < n && !out.includes(b)) out.push(b);
  return out;
}

