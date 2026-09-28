// Alerts for the failures that used to be silent: a mine that has worked out its deposit, a building
// that no settler is free to take on, a workshop whose worker has no tool, a toolsmith with no iron or
// coal. Each is raised once per stall, when it has lasted past the grace time (the same moment its
// badge appears), and a kind that keeps coming up is held back for a while so a burst of new
// buildings brings one alert, not ten. The HUD turns them into toasts. Read-only, like the badges.
import { GOOD_NAMES, ORE_NAMES, MINE_ORE, type BuildingType } from './defs';
import type { Game } from './game';
import { chainText, causeOf, rootCauses, type Cause } from './causes';
import { stalledBuildings } from './status';
import type { Building } from './types';

export type AlertKind = 'exhausted' | 'settlers' | 'tool' | 'toolsmith';

export interface Alert {
  kind: AlertKind;
  /** the building it is about: the toast jumps there */
  b: Building;
  /** how many of the player's buildings are stuck the same way right now (settlers: all of them) */
  count: number;
  title: string;
  /** why, followed upstream */
  detail: string;
  /** what to do about it */
  hint: string;
  cause: Cause | null;
  /** a building the chain found missing, to offer to build */
  build: BuildingType | null;
}

/** Game seconds a kind of alert is held back after it was raised (the badges and the ⚠ list still show every stall). */
const HOLD: Record<AlertKind, number> = { exhausted: 0, settlers: 90, tool: 60, toolsmith: 120 };

function kindOf(b: Building): AlertKind | null {
  const st = b.stall;
  if (!st) return null;
  if (st.kind === 'exhausted') return 'exhausted';
  if (st.kind === 'settlers') return 'settlers';
  if (st.kind === 'tool') return 'tool';
  if (st.kind === 'input' && b.type === 'toolsmith') return 'toolsmith';
  return null;
}

const tool = (gd: string) => GOOD_NAMES[gd as keyof typeof GOOD_NAMES].replace(/s$/, '').toLowerCase();

export class StallWatch {
  /** the stall (by its start time) each building was last alerted for */
  private seen = new Map<number, number>();
  private last = new Map<AlertKind, number>();
  private primed = false;

  constructor(private owner: number) {}

  /** New alerts since the last call. The first call only takes note of what is already stuck (a loaded game doesn't open with a burst). */
  poll(g: Game): Alert[] {
    const list = stalledBuildings(g, this.owner);
    const fresh = new Map<AlertKind, Building[]>();
    const keep = new Set<number>();
    for (const b of list) {
      keep.add(b.id);
      if (this.seen.get(b.id) === b.stallT) continue;
      this.seen.set(b.id, b.stallT);
      const k = kindOf(b);
      if (!k || !this.primed) continue;
      const arr = fresh.get(k) ?? [];
      arr.push(b);
      fresh.set(k, arr);
    }
    for (const id of this.seen.keys()) if (!keep.has(id)) this.seen.delete(id);
    this.primed = true;
    const out: Alert[] = [];
    for (const [kind, bs] of fresh) {
      const hold = HOLD[kind];
      if (hold && g.time - (this.last.get(kind) ?? -Infinity) < hold) continue;
      // one alert per kind, except worked-out mines: each is its own news
      for (const b of kind === 'exhausted' ? bs : bs.slice(0, 1)) {
        this.last.set(kind, g.time);
        out.push(this.alert(g, kind, b, list.filter((o) => kindOf(o) === kind).length));
      }
    }
    return out;
  }

  private alert(g: Game, kind: AlertKind, b: Building, count: number): Alert {
    const cause = causeOf(g, b);
    const roots = cause ? rootCauses(cause) : [];
    const name = b.def.name;
    const st = b.stall!;
    // what it waits on, followed upstream ("Iron Smelter: waiting for coal → No Coal Mine"), and what to do about the first real cause
    const chain = cause?.next.length ? cause.next.map(chainText).join(' · ') : '';
    const hint = roots.find((r) => r.hint)?.hint;
    let title = '', detail = chain, advice = hint ?? '';
    switch (kind) {
      case 'exhausted':
        title = `${name}: the ${ORE_NAMES[MINE_ORE[b.def.mine!]]} is worked out`;
        advice = 'Send a geologist to find more, then build a new mine there';
        break;
      case 'settlers':
        title = count > 1 ? `${count} buildings have no free settler to take the work` : `${name}: no free settler to take the work`;
        detail = 'Every settler has a job';
        advice = 'Build a residence for more';
        break;
      case 'tool':
        title = count > 1 ? `${count} workers have no tool — ${name}: no ${tool(st.kind === 'tool' ? st.good : 'hammer')}` : `${name}: no ${tool(st.kind === 'tool' ? st.good : 'hammer')} for its worker`;
        if (!chain) detail = 'The toolsmith will forge one';
        break;
      case 'toolsmith':
        title = `Toolsmith: no ${GOOD_NAMES[st.kind === 'input' ? st.goods[0] : 'iron'].toLowerCase()} — no new tools`;
        if (!chain) detail = 'Workers that need a tool will wait for it';
        break;
    }
    return { kind, b, count, title, detail, hint: advice, cause, build: roots.find((r) => r.type && !r.ids.length)?.type ?? null };
  }
}
